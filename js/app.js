// Amorcage : catalogue -> detail -> partie, plus les panneaux regles/reglages.
// Mono-fenetre : on ne fait qu'echanger la classe .is-active.

import { CONFIG, gameAssetUrl, setDistBase, distBaseIsForced } from './config.js';
import { locateDist, expandCandidates, DIST_ROOTS } from './dist-locator.js';
import { initLocales, setLocale, applyTranslations, availableLocales, getLocale, t, pickLocalized } from './i18n.js';
import { detectTier } from './device.js';
import { CatalogView } from './catalog-view.js';
import { filterGames } from './catalog.js';
import { GameSession, loadRules, winnerLabel } from './game.js';

const $ = (sel) => document.querySelector(sel);
const state = { catalog: null, tier: 'phone', showAll: false, entry: null, session: null };

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

function openDetail(entry) {
    state.entry = entry;
    const locale = getLocale();
    $('#detail-title').textContent = pickLocalized(entry.title, locale);
    $('#detail-summary').textContent = pickLocalized(entry.summary, locale);
    const thumb = $('#detail-thumb');
    if (entry.thumbnail) thumb.src = gameAssetUrl(entry.module, entry.thumbnail);
    else thumb.removeAttribute('src');

    fillSelect(
        $('#sel-skin'),
        entry.skins.map((s) => ({ value: s.name, label: s.title + (s.is3d ? ' · 3D' : '') })),
        (pref('view.' + entry.name, {}) || {}).skin || entry.defaultSkin
    );
    fillSelect(
        $('#sel-level'),
        entry.levels.map((l) => ({ value: l, label: l })),
        pref('level.' + entry.name, null)
    );
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
    showScreen('screen-game');

    setPref('view.' + entry.name, Object.assign(pref('view.' + entry.name, {}) || {}, { skin: $('#sel-skin').value }));
    if ($('#sel-level').value) setPref('level.' + entry.name, $('#sel-level').value);

    const session = new GameSession(board, entry, {
        onTurn: (player, isHuman) => {
            $('#status').textContent = isHuman ? t('Your turn') : t('Thinking…');
        },
        onProgress: (p) => {
            const bar = $('#progress');
            bar.classList.toggle('is-visible', p !== null && p !== undefined);
            bar.firstElementChild.style.width = (p || 0) + '%';
        },
        onFinished: (result, Jocly) => {
            $('#status').textContent = winnerLabel(result, Jocly);
        },
        onError: (err) => {
            console.error(err);
            $('#status').textContent = t('The game engine could not be loaded.');
        },
    });
    state.session = session;
    try {
        await session.start({ side: $('#sel-side').value });
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
    const viewAsRow = $('#row-view-as');
    viewAsRow.hidden = !session.entry.switchable;
    if (!viewAsRow.hidden) {
        $('#opt-view-as').value = vo.viewAs === session.Jocly.PLAYER_B ? 'b' : 'a';
    }
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
        if (!state.session) return;
        closePanels();
        $('#status').textContent = t('Loading…');
        await state.session.restart();
    });
}

async function leaveMatch() {
    if (state.session) {
        await state.session.stop();
        state.session = null;
    }
    $('#board').textContent = '';
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

    const view = new CatalogView($('#catalog'), { onSelect: openDetail });
    view.setTier(state.tier);
    view.setShowAll(state.showAll);
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

    $('#btn-play').addEventListener('click', startMatch);
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

    wireGameOptions();

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
        if (state.entry) openDetail(state.entry);
    });

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
