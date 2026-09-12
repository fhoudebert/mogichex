// Amorcage : catalogue -> detail -> partie, plus les panneaux regles/reglages.
// Mono-fenetre : on ne fait qu'echanger la classe .is-active.

import { CONFIG, gameAssetUrl, setDistBase, distBaseIsForced, setRelayUrl, relayUrlIsForced, allowedMode } from './config.js';
import { locateDist, expandCandidates, DIST_ROOTS } from './dist-locator.js';
import { initLocales, setLocale, applyTranslations, availableLocales, getLocale, t, pickLocalized, translateLevelLabel } from './i18n.js';
import { detectTier } from './device.js';
import { CatalogView } from './catalog-view.js';
import { filterGames } from './catalog.js';
import { GameSession, loadRules, winnerLabel, fallbackNotice } from './game.js';
import { newMatchId, buildInviteLink, parseInviteLink, buildEnvelope, makeId } from './remote/invite.js';
import { RelayChannel } from './remote/relay-channel.js';
import { locateRelay, RELAY_ROOTS } from './remote/relay-locator.js';
import { PeerChannel } from './remote/peer-channel.js';
import { FAV_KEY, sanitizeFavorites, toggleFavorite } from './favorites.js';
import { CLOCK_PRESETS, presetById, formatClock, Clock } from './clock.js';
import { moveRows, canRollback } from './history.js';
import { ChatChannel } from './remote/chat-channel.js';
import { KIND, PRESENCE, countUnread } from './remote/chat-protocol.js';

const $ = (sel) => document.querySelector(sel);
const state = {
    catalog: null,
    tier: 'phone',
    showAll: false,
    entry: null,
    session: null,
    favorites: [],
    clock: null,
    clockTimer: null,
    chat: null,
    chatSeenId: null,
    chatUnread: 0,
};

function pref(key, def) {
    try {
        const v = localStorage.getItem(CONFIG.storagePrefix + key);
        return v === null ? def : JSON.parse(v);
    } catch {
        return def;
    }
}
function setPref(key, value) {
    try {
        localStorage.setItem(CONFIG.storagePrefix + key, JSON.stringify(value));
    } catch {
        /* stockage indisponible : on continue sans memoriser */
    }
}

function showScreen(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('is-active', s.id === id);
}

function openPanel(id) {
    const p = $(id);
    p.classList.add('is-open');
    p.setAttribute('aria-hidden', 'false');
}
function closePanels() {
    for (const p of document.querySelectorAll('.panel')) {
        p.classList.remove('is-open');
        p.setAttribute('aria-hidden', 'true');
    }
}

function updateCount() {
    const n = filterGames(state.catalog.games, {
        query: $('#search').value,
        tier: state.tier,
        showAll: state.showAll,
        locale: getLocale(),
    }).length;
    $('#game-count').textContent = `${n} ${t('games')}`;
}

// ---------------------------------------------------------------- detail

function fillSelect(select, options, selected) {
    select.textContent = '';
    for (const o of options) {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === selected) opt.selected = true;
        select.appendChild(opt);
    }
}

/**
 * Affiche ou masque les lignes qui n'ont de sens que dans un mode donne :
 * le camp et le niveau ne concernent que le jeu contre l'ordinateur.
 */
function syncModeRows() {
    const mode = $('#sel-mode').value;
    const ai = mode === 'ai';
    $('#row-side').hidden = !ai;
    $('#row-level').hidden = !ai || !state.entry || state.entry.levels.length === 0;
    // La cadence disparait en partie a distance : les deux appareils ne voient
    // pas le meme instant, et une pendule approximative est pire qu'une
    // pendule absente (voir l'en-tete de js/clock.js).
    $('#row-clock').hidden = mode === 'remote';
}

function openDetail(entry) {
    state.entry = entry;
    const locale = getLocale();
    $('#detail-title').textContent = pickLocalized(entry.title, locale);
    $('#detail-summary').textContent = pickLocalized(entry.summary, locale);
    const thumb = $('#detail-thumb');
    if (entry.thumbnail) thumb.src = gameAssetUrl(entry.module, entry.thumbnail);
    else thumb.removeAttribute('src');

    const view = pref('view.' + entry.name, {}) || {};

    fillSelect(
        $('#sel-skin'),
        entry.skins.map((sk) => ({ value: sk.name, label: sk.title + (sk.is3d ? ' \u00b7 3D' : '') })),
        view.skin || entry.defaultSkin
    );

    // Niveaux indexes par POSITION : 28 jeux declarent des niveaux sans nom.
    // On affiche leur `label` et on preselectionne celui marque isDefault.
    const storedLevel = pref('level.' + entry.name, null);
    const defaultLevel = entry.levels.findIndex((l) => l.isDefault);
    fillSelect(
        $('#sel-level'),
        entry.levels.map((l, i) => ({ value: String(i), label: translateLevelLabel(l.label) })),
        String(typeof storedLevel === 'number' ? storedLevel : defaultLevel >= 0 ? defaultLevel : 0)
    );

    $('#sel-mode').value = allowedMode(pref('mode', 'ai'));
    $('#sel-side').value = pref('side.' + entry.name, 'a');
    // La cadence est memorisee GLOBALEMENT et non par jeu : qui joue au blitz
    // y joue a tous les jeux, et retrouver « pas d'horloge » sur chaque
    // nouveau jeu serait un reglage a refaire 127 fois.
    fillSelect(
        $('#sel-clock'),
        CLOCK_PRESETS.map((p) => ({ value: p.id, label: t(p.label) })),
        presetById(pref('clock', 'none')).id
    );
    syncModeRows();

    // Sons et notation : affiches par defaut. Tant qu'on n'a pas attache une
    // partie, on ignore si le jeu les gere — on l'apprend a la premiere
    // partie (getViewOptions) et on masque alors la ligne inutile, plutot
    // que de la cacher d'emblee a des jeux qui la geraient tres bien
    // (mesure : les jeux sondes les gerent tous).
    const support = pref('support.' + entry.name, null);
    $('#row-start-sounds').hidden = !!support && !support.sounds;
    $('#row-start-notation').hidden = !!support && !support.notation;
    $('#start-sounds').checked = view.sounds !== false;
    $('#start-notation').checked = view.notation === true;

    $('#btn-rules').disabled = !entry.rules;
    showScreen('screen-detail');
}

// ---------------------------------------------------------------- partie

async function startMatch() {
    const entry = state.entry;
    if (state.distMissing) {
        showScreen('screen-game');
        $('#game-title').textContent = pickLocalized(entry.title, getLocale());
        $('#status').textContent = t('The game engine could not be found.');
        return;
    }
    const board = $('#board');
    board.textContent = '';
    $('#game-title').textContent = pickLocalized(entry.title, getLocale());
    $('#status').textContent = t('Loading…');
    $('#notice').hidden = true;
    $('#notice').textContent = '';
    showScreen('screen-game');

    const mode = $('#sel-mode').value;
    setPref('mode', mode);
    setPref('side.' + entry.name, $('#sel-side').value);
    if ($('#sel-level').value !== '') setPref('level.' + entry.name, parseInt($('#sel-level').value, 10));
    if (!state.remote) setPref('clock', $('#sel-clock').value);
    setPref(
        'view.' + entry.name,
        Object.assign(pref('view.' + entry.name, {}) || {}, {
            skin: $('#sel-skin').value,
            sounds: $('#start-sounds').checked,
            notation: $('#start-notation').checked,
        })
    );

    startClock();

    const session = new GameSession(board, entry, {
        onTurn: (player, isHuman) => {
            clockSwitch(player);
            $('#status').textContent = isHuman
                ? session.isTwoHumans
                    ? t(player === session.Jocly.PLAYER_A ? 'Player A to move' : 'Player B to move')
                    : t('Your turn')
                : session.mode === 'remote'
                  ? t('Waiting for the other player…')
                  : t('Thinking…');
            syncTakeBack();
        },
        onProgress: (p) => {
            const bar = $('#progress');
            bar.classList.toggle('is-visible', p !== null && p !== undefined);
            bar.firstElementChild.style.width = (p || 0) + '%';
        },
        onFinished: (result, Jocly) => {
            $('#status').textContent = winnerLabel(result, Jocly);
            clockPause();
            syncTakeBack();
        },
        onFallback: (fb) => {
            // Source AUTORITAIRE : c'est jocly qui dit que « Expert » n'a pas
            // pu demarrer, pas une deduction de notre part.
            const notice = fallbackNotice({ fairyFallback: fb }, t);
            const el = $('#notice');
            el.textContent = notice;
            el.hidden = false;
            console.warn('fairy-stockfish indisponible :', fb.reason);
        },
        onError: (err) => {
            console.error(err);
            $('#status').textContent = t('The game engine could not be loaded.');
        },
    });
    state.session = session;
    try {
        await session.start({
            side: state.remote ? state.remote.side : $('#sel-side').value,
            mode: state.remote ? 'remote' : mode,
        });
        if (state.remote) attachRelay(session, state.remote);
        // Ce que le jeu gere vraiment : appris ici, utilise au prochain
        // passage sur l'ecran de demarrage.
        const vo = session.viewOptions || {};
        setPref('support.' + entry.name, {
            sounds: vo.sounds !== undefined,
            notation: vo.notation !== undefined,
        });
        syncTakeBack();
        syncBarButtons();
    } catch (err) {
        console.error(err);
        $('#status').textContent = t('The game engine could not be loaded.');
    }
}

/**
 * Renseigne le panneau d'options a partir de ce que le jeu declare vraiment.
 * getViewOptions() ne rend que les options gerees : une ligne dont l'option
 * est absente reste masquee, plutot que d'offrir une case sans effet.
 */
function fillGameOptions(session) {
    const vo = session.viewOptions || {};
    const rows = [
        ['#row-sounds', '#opt-sounds', 'sounds'],
        ['#row-notation', '#opt-notation', 'notation'],
        ['#row-show-moves', '#opt-show-moves', 'showMoves'],
        ['#row-autocomplete', '#opt-autocomplete', 'autoComplete'],
    ];
    for (const [rowSel, inputSel, key] of rows) {
        const supported = vo[key] !== undefined;
        $(rowSel).hidden = !supported;
        if (supported) $(inputSel).checked = !!vo[key];
    }

    const skinRow = $('#row-opt-skin');
    skinRow.hidden = session.entry.skins.length < 2;
    if (!skinRow.hidden) {
        fillSelect(
            $('#opt-skin'),
            session.entry.skins.map((sk) => ({ value: sk.name, label: sk.title + (sk.is3d ? ' · 3D' : '') })),
            vo.skin || session.entry.defaultSkin
        );
    }

    // « Voir en tant que » n'a de sens que pour un jeu switchable : jocly
    // ignore viewAs ailleurs.
    // « Recommencer » disparait des qu'un camp est distant, pour la meme
    // raison que « reprendre le coup » : rejouer depuis le debut de son cote
    // seulement desynchroniserait les deux plateaux. C'etait la derniere
    // commande de position encore accessible en jeu a distance.
    $('#btn-restart').hidden = !!state.remote;

    const viewAsRow = $('#row-view-as');
    viewAsRow.hidden = !session.entry.switchable;
    if (!viewAsRow.hidden) {
        $('#opt-view-as').value = vo.viewAs === session.Jocly.PLAYER_B ? 'b' : 'a';
    }
}

/**
 * Le bouton « reprendre le coup » n'apparait que quand il a un sens :
 * il y a un coup a reprendre, c'est au tour d'un humain, et AUCUN camp n'est
 * tenu par un joueur distant — reprendre un coup deja parti chez l'adversaire
 * desynchroniserait les deux plateaux (lecon Tabulon).
 *
 * Le niveau « expert » (fairy-stockfish) n'est PAS une exception : le moteur
 * recoit une FEN complete a chaque recherche, sans historique de coups.
 */
async function syncTakeBack() {
    const btn = $('#btn-take-back');
    const s = state.session;
    if (!s || !s.match || state.remote) {
        btn.hidden = true;
        return;
    }
    try {
        const moves = await s.match.getPlayedMoves();
        btn.hidden = !(moves.length > 0 && s.isHuman(await s.match.getTurn()));
    } catch {
        btn.hidden = true;
    }
}

/**
 * Qui occupe la quatrieme icone de la barre.
 *
 * Historique et discussion ne coexistent jamais : a 390 px, une cinquieme
 * icone mange le titre du jeu. Le partage est net — le retour arriere n'a de
 * sens qu'en partie locale, la discussion n'existe qu'en partie a distance.
 * En distant, la liste des coups reste atteignable depuis les options.
 */
function syncBarButtons() {
    const playing = !!(state.session && state.session.match);
    $('#btn-history').hidden = !playing || !!state.remote;
    $('#btn-chat').hidden = !(playing && state.remote && state.chat);
    $('#btn-open-history').hidden = !(playing && state.remote);
}

// ---------------------------------------------------------------- horloge

/**
 * Arme la pendule si une cadence est choisie, et seulement en partie locale.
 * L'affichage est rafraichi par un intervalle court : c'est la seule boucle
 * de l'application qui tourne en continu, d'ou l'arret systematique en
 * quittant la partie.
 */
function startClock() {
    stopClock();
    if (state.remote) return;
    const preset = presetById($('#sel-clock').value);
    if (!preset.initial) return;
    state.clock = new Clock({ initial: preset.initial, increment: preset.increment });
    $('#clock').hidden = false;
    $('#clock').setAttribute('aria-hidden', 'false');
    // 200 ms : assez pour que les dixiemes de la derniere minute defilent sans
    // saccade visible, assez peu pour ne pas reveiller l'appareil sans cesse.
    state.clockTimer = setInterval(renderClock, 200);
    renderClock();
}

function stopClock() {
    if (state.clockTimer) clearInterval(state.clockTimer);
    state.clockTimer = null;
    state.clock = null;
    state.flagged = false;
    $('#clock').hidden = true;
    $('#clock').setAttribute('aria-hidden', 'true');
}

function clockSwitch(player) {
    if (state.clock) state.clock.switchTo(player);
}

function clockPause() {
    if (state.clock) state.clock.pause();
}

function renderClock() {
    const c = state.clock;
    if (!c) return;
    const now = Date.now();
    const Jocly = state.session && state.session.Jocly;
    for (const [side, box, time] of [
        [1, '#clock-a', '#clock-a-time'],
        [-1, '#clock-b', '#clock-b-time'],
    ]) {
        const left = c.remaining(side, now);
        $(time).textContent = formatClock(left);
        $(box).classList.toggle('is-running', c.running === side);
        $(box).classList.toggle('is-low', left < 30000);
    }
    const flag = c.flagOf(now);
    if (flag !== null && !state.flagged) {
        state.flagged = true;
        c.pause(now);
        // On ANNONCE la chute, on ne l'impose pas a jocly : le moteur ignore
        // tout de l'horloge, et lui faire croire a une fin de partie casserait
        // la sauvegarde et la reprise. Le tour en cours est simplement
        // interrompu pour que le plateau cesse d'accepter des coups.
        $('#status').textContent = t(flag === (Jocly ? Jocly.PLAYER_A : 1)
            ? 'Player A ran out of time'
            : 'Player B ran out of time');
        if (state.session && state.session.match) {
            state.session.aborting = true;
            Promise.resolve(state.session.match.abortUserTurn()).catch(() => {});
        }
    }
}

// ---------------------------------------------------------------- historique

/**
 * Remplit le panneau des coups.
 *
 * Le retour arriere est interdit des qu'un camp est distant — rejouer une
 * position que l'adversaire a deja depassee desynchroniserait les deux
 * plateaux. On le dit plutot que de laisser des boutons inertes.
 */
async function fillHistory() {
    const list = $('#history-list');
    const hint = $('#history-hint');
    list.textContent = '';
    const s = state.session;
    if (!s || !s.match) {
        hint.textContent = '';
        return;
    }
    const moves = await s.playedMoveStrings();
    const allowed = canRollback({ remote: !!state.remote, moves: moves.length });
    $('#btn-take-back').hidden = !allowed;
    hint.textContent = !moves.length
        ? t('No move played yet.')
        : allowed
          ? t('Tap a move to go back to that position.')
          : t('Going back is unavailable in an online game.');

    for (const row of moveRows(moves)) {
        const li = document.createElement('li');
        for (const cell of row.cells) li.appendChild(moveButton(cell, moves.length, allowed));
        if (row.cells.length === 1) {
            const filler = document.createElement('span');
            filler.className = 'move-spacer';
            li.appendChild(filler);
        }
        list.appendChild(li);
    }
}

function moveButton(cell, total, allowed) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'move-btn' + (cell.n === total ? ' is-current' : '');
    btn.innerHTML = '<span class="move-n"></span><span class="move-text"></span>';
    btn.querySelector('.move-n').textContent = String(cell.n);
    btn.querySelector('.move-text').textContent = cell.text;
    // Le dernier coup est la position courante : il n'y a rien a defaire, et
    // un bouton qui ne fait rien est pire qu'un bouton absent.
    btn.disabled = !allowed || cell.n === total;
    btn.addEventListener('click', async () => {
        if (!state.session) return;
        closePanels();
        await state.session.rollbackTo(cell.n);
        syncTakeBack();
    });
    return btn;
}

function wireGameOptions() {
    const apply = (key, read) => async () => {
        if (!state.session) return;
        try {
            await state.session.applyViewOptions({ [key]: read() });
        } catch (err) {
            console.error('option de vue refusee', key, err);
        }
    };
    $('#opt-sounds').addEventListener('change', apply('sounds', () => $('#opt-sounds').checked));
    $('#opt-notation').addEventListener('change', apply('notation', () => $('#opt-notation').checked));
    $('#opt-show-moves').addEventListener('change', apply('showMoves', () => $('#opt-show-moves').checked));
    $('#opt-autocomplete').addEventListener(
        'change',
        apply('autoComplete', () => $('#opt-autocomplete').checked)
    );
    $('#opt-skin').addEventListener('change', apply('skin', () => $('#opt-skin').value));
    $('#opt-view-as').addEventListener(
        'change',
        apply('viewAs', () =>
            $('#opt-view-as').value === 'b' ? state.session.Jocly.PLAYER_B : state.session.Jocly.PLAYER_A
        )
    );
    $('#btn-game-options').addEventListener('click', () => {
        if (state.session) fillGameOptions(state.session);
        openPanel('#panel-game-options');
    });
    $('#btn-restart').addEventListener('click', async () => {
        if (!state.session || state.remote) return;
        closePanels();
        $('#status').textContent = t('Loading…');
        // Une nouvelle partie sur une pendule deja entamee n'aurait aucun sens.
        if (state.clock) state.clock.reset();
        state.flagged = false;
        await state.session.restart();
        syncTakeBack();
    });
    $('#btn-open-history').addEventListener('click', async () => {
        closePanels();
        openPanel('#panel-history');
        await fillHistory();
    });
}

// ---------------------------------------------------------------- a distance

/**
 * Prepare une partie a distance : un identifiant, un lien a partager, et
 * l'attente de l'adversaire. Le lien est au format joclymatch (voir
 * js/remote/invite.js) : il reste lisible par joclymatch et par Tabulon.
 */
/**
 * Trouve le relai, une seule fois, au moment ou on en a besoin. Quelqu'un qui
 * ne joue que contre l'ordinateur ne paie jamais cette requete.
 */
async function ensureRelay() {
    // Desactive : pas une seule requete sortante. C'est ce qui rend
    // l'application reellement hors ligne, pas seulement silencieuse.
    if (!CONFIG.remotePlay) return null;
    if (CONFIG.relayUrl || relayUrlIsForced()) return CONFIG.relayUrl;
    const remembered = pref('relayUrl', null);
    const roots = (CONFIG.relayRoots || []).concat(RELAY_ROOTS);
    const found = await locateRelay({ remembered, roots });
    if (found.base) {
        setRelayUrl(found.base);
        if (found.base !== remembered) setPref('relayUrl', found.base);
    } else {
        console.warn(
            'relai introuvable. Emplacements essayes (relatifs a cette page) :\n  ' +
                found.tried.join('\n  ') +
                "\nDeposer deploy/signal.php et deploy/match.php a cote de index.html," +
                ' ou imposer window.MOGICHEX_CONFIG = { relayUrl: "…" }.'
        );
    }
    return CONFIG.relayUrl;
}

async function openInvite(entry) {
    $('#invite-error').textContent = '';
    $('#invite-link').value = '';
    $('#btn-start-remote').disabled = true;
    openPanel('#panel-invite');
    await ensureRelay();
    if (!CONFIG.relayUrl) {
        $('#invite-error').textContent = t('Remote play needs a relay. None is configured.');
        $('#invite-link').value = '';
        $('#btn-start-remote').disabled = true;
    } else {
        $('#invite-error').textContent = '';
        $('#btn-start-remote').disabled = false;
        state.pending = { matchId: newMatchId(), side: 'a' };
        // L'invite recoit le camp OPPOSE au notre.
        const link = buildInviteLink({
            game: entry.name,
            matchId: state.pending.matchId,
            side: 'b',
            locale: getLocale(),
            base: location.href.split('?')[0],
        });
        $('#invite-link').value = link;
    }
}

/**
 * Branche le relai sur la session. La boucle d'ecoute tourne EN PERMANENCE,
 * pas seulement pendant le tour de l'adversaire : c'est ce qui permet de
 * rattraper une partie rechargee ou reprise sur un autre appareil.
 */
function attachRelay(session, { matchId, side }) {
    const selfKey = makeId(8);
    const channel = new RelayChannel({
        relayUrl: CONFIG.relayUrl,
        matchId,
        selfKey,
        gameName: session.entry.name,
        onEnvelope: async (env) => {
            try {
                await session.applyRemoteState(env.matchdata);
            } catch (err) {
                console.error('etat distant refuse', err);
            }
        },
        onError: () => {
            $('#status').textContent = t('Connection lost, retrying…');
        },
    });
    state.channel = channel;

    // Canal pair-a-pair, en PLUS du relai et jamais a sa place. Tant qu'il est
    // ouvert, on suspend l'attente longue : chaque joueur en attente
    // immobilisait sinon un processus PHP pendant 20 s, en boucle.
    const peer = new PeerChannel({
        relayUrl: CONFIG.relayUrl,
        matchId,
        side,
        onEnvelope: async (env) => {
            // Meme filtre que par le relai : une enveloppe recue deux fois, ou
            // la sienne, ne doit pas etre rejouee.
            if (env && env.key === selfKey) return;
            try {
                await session.applyRemoteState(env.matchdata);
                channel.lastTurns = Math.max(channel.lastTurns, (env.matchDetails || {}).nbTurns || 0);
            } catch (err) {
                console.error('etat pair refuse', err);
            }
        },
        onStateChange: (st) => {
            channel.setLongPolling(st !== 'open');
            // La discussion suit la meme regle, et c'est ce qui empeche un
            // joueur en attente d'immobiliser DEUX processus PHP au lieu d'un.
            if (state.chat) state.chat.setLongPolling(st !== 'open');
            console.info('canal pair-a-pair :', st);
        },
    });
    state.peer = peer;

    attachChat(session, { matchId, side, peer });

    session.hooks.onLocalMove = async () => {
        const { matchdata, nbTurns } = await session.exportState();
        const env = buildEnvelope({
            matchDetails: { matchId, gameName: session.entry.name, nbTurns, side },
            matchdata,
            key: selfKey,
        });
        // Le pair d'abord (immediat), le relai ensuite (reference durable :
        // c'est lui qui permet de recharger la page ou de reprendre plus tard).
        peer.publish(env);
        await channel.publish(env);
    };
    channel.start();
    peer.start().catch((err) => console.warn('negociation pair-a-pair abandonnee', err));
}

// ---------------------------------------------------------------- discussion

/**
 * Ouvre le fil de la partie.
 *
 * Le fil vit ICI, dans la page, et non dans le panneau : le panneau peut etre
 * ferme et rouvert sans que la partie s'en apercoive, et les messages recus
 * pendant qu'il est ferme doivent quand meme faire monter la pastille.
 */
function attachChat(session, { matchId, side, peer }) {
    const Jocly = session.Jocly;
    const chat = new ChatChannel({
        relayUrl: CONFIG.relayUrl,
        matchId,
        side: side === 'b' ? Jocly.PLAYER_B : Jocly.PLAYER_A,
        peer,
        onConversation: (conv) => {
            state.chatUnread = countUnread(conv, state.chatSeenId, chat.side);
            updateChatBadge();
            if ($('#panel-chat').classList.contains('is-open')) renderChat(conv);
        },
        onError: (err) => console.warn('discussion :', err.message || err),
    });
    state.chat = chat;
    state.chatSeenId = null;
    state.chatUnread = 0;
    chat.start().catch((err) => console.warn('discussion indisponible :', err.message || err));
    syncBarButtons();
}

function updateChatBadge() {
    const btn = $('#btn-chat');
    btn.classList.toggle('has-unread', state.chatUnread > 0);
    btn.dataset.unread = state.chatUnread > 9 ? '9+' : String(state.chatUnread || '');
}

/**
 * Le texte d'un message.
 *
 * Un message rapide voyage comme IDENTIFIANT et se traduit ICI : c'est ce qui
 * permet a deux joueurs sans langue commune de se comprendre. Un message
 * verrouille reste VISIBLE — un trou silencieux dans une conversation est pire
 * qu'un cadenas.
 */
const QUICK_LABEL = {
    wellPlayed: 'Well played',
    yourTurn: 'Your turn!',
    backSoon: 'Back in a few minutes',
    rematch: 'Another game?',
    unreadable: 'Unreadable — change key!',
};
const PRESENCE_LABEL = {
    thinking: 'is thinking',
    paused: 'stepped away',
    back: 'is back',
    leaving: 'is done for today',
};

function messageText(m) {
    if (m.locked) return t('A message you cannot read.');
    if (m.quick) return t(QUICK_LABEL[m.quick] || m.quick);
    return m.body || '';
}

function renderChat(conversation) {
    const box = $('#chat-thread');
    box.textContent = '';
    $('#chat-empty').hidden = conversation.length > 0;
    for (const m of conversation) {
        const mine = state.chat && m.side === state.chat.side;
        const line = document.createElement('div');
        if (m.kind === KIND.PRESENCE) {
            line.className = 'chat-line is-presence';
            line.textContent =
                t(mine ? 'You' : 'Your opponent') + ' ' + t(PRESENCE_LABEL[m.state] || m.state);
        } else if (m.kind === KIND.NUDGE) {
            line.className = 'chat-line is-presence';
            line.textContent = t(mine ? 'You nudged' : 'Your opponent nudged you');
        } else {
            line.className = 'chat-line' + (mine ? ' is-mine' : '') + (m.locked ? ' locked' : '');
            line.textContent = messageText(m);
            const when = document.createElement('span');
            when.className = 'chat-when';
            when.textContent = new Date(m.at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
            });
            line.appendChild(when);
        }
        box.appendChild(line);
    }
    box.scrollTop = box.scrollHeight;
    // Tout ce qui est a l'ecran est lu. Le signaler ici et non a la reception
    // est la seule verite disponible : un message arrive panneau ferme n'a ete
    // vu par personne.
    if (conversation.length) state.chatSeenId = conversation[conversation.length - 1].id;
    state.chatUnread = 0;
    updateChatBadge();
}

async function sendChat(payload) {
    if (!state.chat) return;
    try {
        await state.chat.send(payload);
    } catch (err) {
        console.warn('message non envoye :', err.message || err);
    }
}

function wireChat() {
    $('#btn-chat').addEventListener('click', () => {
        openPanel('#panel-chat');
        renderChat(state.chat ? state.chat.conversation : []);
    });
    for (const btn of document.querySelectorAll('#chat-quick [data-quick]')) {
        btn.addEventListener('click', () => sendChat({ kind: KIND.CHAT, quick: btn.dataset.quick }));
    }
    for (const btn of document.querySelectorAll('#chat-presence [data-presence]')) {
        btn.addEventListener('click', () =>
            sendChat({ kind: KIND.PRESENCE, state: PRESENCE[btn.dataset.presence.toUpperCase()] })
        );
    }
}

async function leaveMatch() {
    $('#btn-take-back').hidden = true;
    stopClock();
    if (state.chat) {
        state.chat.stop();
        state.chat = null;
        state.chatUnread = 0;
        updateChatBadge();
    }
    if (state.peer) {
        state.peer.stop();
        state.peer = null;
    }
    if (state.channel) {
        state.channel.stop();
        state.channel = null;
    }
    state.remote = false;
    if (state.session) {
        await state.session.stop();
        state.session = null;
    }
    $('#board').textContent = '';
    syncBarButtons();
}

// ---------------------------------------------------------------- demarrage

async function main() {
    await initLocales({
        stored: pref('locale', null),
        navigatorLanguages: navigator.languages || [navigator.language],
    });
    applyTranslations();

    state.tier = detectTier();
    state.showAll = pref('showAll', false);
    $('#show-all').checked = state.showAll;

    // Le dist doit etre localise AVANT le premier rendu : les vignettes de la
    // liste en viennent, pas seulement le moteur.
    if (!distBaseIsForced()) {
        const remembered = pref('distBase', null);
        const roots = (CONFIG.distRoots || []).concat(DIST_ROOTS);
        const found = await locateDist({ remembered, candidates: expandCandidates(roots) });
        if (found.base) {
            setDistBase(found.base);
            if (found.base !== remembered) setPref('distBase', found.base);
        } else {
            // Sans dist, la liste reste consultable (elle lit catalog.json) :
            // on n'arrete pas l'application, on le dit au moment de jouer.
            console.warn(
                'dist jocly introuvable. Emplacements essayes (relatifs a cette page) :\n  ' +
                    found.tried.join('\n  ') +
                    "\nAjouter la bonne racine via window.MOGICHEX_CONFIG = { distRoots: ['…'] }," +
                    ' ou imposer directement { distBase: "…/" }.'
            );
            state.distMissing = true;
        }
    }

    const res = await fetch(CONFIG.catalogUrl);
    state.catalog = await res.json();

    state.favorites = sanitizeFavorites(pref(FAV_KEY, []));
    const view = new CatalogView($('#catalog'), {
        onSelect: openDetail,
        onToggleFavorite: (name) => {
            state.favorites = toggleFavorite(state.favorites, name);
            setPref(FAV_KEY, state.favorites);
            view.setFavorites(state.favorites);
        },
    });
    view.setTier(state.tier);
    view.setShowAll(state.showAll);
    view.setFavorites(state.favorites);
    view.setGames(state.catalog.games);
    updateCount();

    $('#search').addEventListener('input', (e) => {
        view.setQuery(e.target.value);
        updateCount();
    });
    $('#show-all').addEventListener('change', (e) => {
        state.showAll = e.target.checked;
        setPref('showAll', state.showAll);
        view.setShowAll(state.showAll);
        updateCount();
    });

    // La classe d'appareil change avec la rotation ou le redimensionnement.
    window.addEventListener('resize', () => {
        const tier = detectTier();
        if (tier !== state.tier) {
            state.tier = tier;
            view.setTier(tier);
            updateCount();
        }
    });

    $('#btn-play').addEventListener('click', () => {
        if (CONFIG.remotePlay && $('#sel-mode').value === 'remote') return openInvite(state.entry);
        state.remote = null;
        startMatch();
    });

    $('#btn-copy-invite').addEventListener('click', async () => {
        const input = $('#invite-link');
        input.select();
        try {
            await navigator.clipboard.writeText(input.value);
            $('#invite-error').textContent = t('Copied');
        } catch {
            // Le presse-papiers est refuse hors contexte securise : le champ
            // est deja selectionne, la copie manuelle reste possible.
        }
    });

    $('#btn-start-remote').addEventListener('click', () => {
        state.remote = state.pending;
        closePanels();
        startMatch();
    });
    $('#btn-rules').addEventListener('click', () => {
        openPanel('#panel-rules');
        loadRules($('#rules'), state.entry);
    });
    $('#btn-rules-game').addEventListener('click', () => {
        openPanel('#panel-rules');
        loadRules($('#rules'), state.entry);
    });
    for (const b of document.querySelectorAll('[data-close-panel]')) b.addEventListener('click', closePanels);
    for (const b of document.querySelectorAll('[data-back]')) {
        b.addEventListener('click', async () => {
            closePanels();
            if ($('#screen-game').classList.contains('is-active')) {
                await leaveMatch();
                showScreen('screen-detail');
            } else showScreen('screen-catalog');
        });
    }

    // Jeu a distance desactive : l'option disparait de la liste plutot que
    // d'y rester grisee — une option qu'on ne peut pas choisir n'apprend rien.
    if (!CONFIG.remotePlay) {
        const opt = $('#sel-mode').querySelector('option[value="remote"]');
        if (opt) opt.remove();
    }

    wireGameOptions();

    $('#sel-mode').addEventListener('change', syncModeRows);
    $('#btn-history').addEventListener('click', async () => {
        openPanel('#panel-history');
        await fillHistory();
    });
    $('#btn-take-back').addEventListener('click', async () => {
        const s = state.session;
        if (!s) return;
        $('#btn-take-back').disabled = true;
        try {
            await s.takeBack();
        } finally {
            $('#btn-take-back').disabled = false;
            syncTakeBack();
            closePanels();
        }
    });
    wireChat();

    $('#btn-settings').addEventListener('click', () => openPanel('#panel-settings'));
    fillSelect(
        $('#sel-lang'),
        availableLocales().map((l) => ({ value: l.code, label: l.label })),
        getLocale()
    );
    $('#sel-lang').addEventListener('change', async (e) => {
        await setLocale(e.target.value);
        setPref('locale', e.target.value);
        applyTranslations();
        view.render();
        updateCount();
        // Re-rendre le detail SEULEMENT s'il est a l'ecran : openDetail()
        // bascule d'ecran, et changer de langue depuis le catalogue faisait
        // donc atterrir sur la fiche d'un jeu qu'on n'avait pas demande.
        // Une fiche ouverte plus tard sera de toute facon rendue a neuf.
        if (state.entry && $('#screen-detail').classList.contains('is-active')) {
            openDetail(state.entry);
        }
    });

    // Lien d'invitation ouvert par l'adversaire : on lance directement la
    // partie a distance, sur le bon jeu et le bon camp. Un lien joclymatch
    // fonctionne ici aussi (memes parametres).
    const invite = parseInviteLink(location.search);
    if (invite) {
        const entry = state.catalog.games.find((g) => g.name === invite.game);
        if (entry) {
            openDetail(entry);
            if (invite.side && CONFIG.remotePlay) {
                await ensureRelay();
                if (CONFIG.relayUrl) {
                    state.remote = { matchId: invite.matchId, side: invite.side };
                    $('#sel-mode').value = 'remote';
                    syncModeRows();
                    startMatch();
                } else {
                    $('#invite-error').textContent = t(
                        'Remote play needs a relay. None is configured.'
                    );
                    openPanel('#panel-invite');
                }
            }
        }
    }

    const src = state.catalog.source || {};
    $('#about').textContent = `${state.catalog.counts.games} ${t('games')} · jocly ${(src.commit || '').slice(0, 7)}`;

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch((err) => console.warn('service worker', err));
    }
}

main().catch((err) => {
    console.error(err);
    document.body.insertAdjacentHTML('afterbegin', `<pre class="fatal">${String(err)}</pre>`);
});
