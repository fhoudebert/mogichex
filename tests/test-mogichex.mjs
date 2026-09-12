// Tests unitaires — Node pur, aucune dependance, aucun navigateur.
//   node --test tests/
//
// Ce qui est testable ici : la logique de construction du catalogue, la
// reduction des champs localises, le filtrage/groupement, la detection
// d'appareil. Ce qui ne l'est PAS et doit etre verifie sur appareil reel :
// le tactile, l'installation PWA, l'eviction de stockage iOS, WebRTC entre
// deux reseaux. C'est dit dans le README, pas masque par des tests factices.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCatalog, buildEntry, normalizeLocalized, pick2dSkin } from '../tools/lib/catalog.mjs';
import { keepFile, citedVisuals, summarize } from '../tools/lib/dist-trim.mjs';
import { pickLocalized, preferredLocale, configure, t, translateLevelLabel } from '../js/i18n.js';
import { filterGames, groupByModule, initialCollapsed, normalize, searchableText } from '../js/catalog.js';
import { classify } from '../js/device.js';
import { CONFIG, allowedMode } from '../js/config.js';
import { isAbortError, takeBackTarget, GameSession, fallbackNotice } from '../js/game.js';
import {
    shouldApplyEnvelope,
    envelopeTurns,
    nextSince,
    backoffDelay,
    sidesFor,
} from '../js/remote/protocol.js';
import { RelayChannel } from '../js/remote/relay-channel.js';
import {
    isOfferer,
    boxesFor,
    orderSignals,
    shouldLongPoll,
    signalMessage,
    ICE_SERVERS,
} from '../js/remote/signalling.js';
import { PeerChannel } from '../js/remote/peer-channel.js';
import {
    orderedRelays,
    locateRelay,
    looksLikeRelay,
    normalizeRelay,
    RELAY_ROOTS,
} from '../js/remote/relay-locator.js';
import {
    makeId,
    newMatchId,
    otherSide,
    buildInviteLink,
    parseInviteLink,
    buildEnvelope,
    isUsableEnvelope,
    MATCH_ID_RE,
} from '../js/remote/invite.js';
import {
    orderedCandidates,
    locateDist,
    looksLikeJocly,
    normalizeBase,
    expandCandidates,
    DIST_CANDIDATES,
} from '../js/dist-locator.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const raw = (name, over = {}) => ({
    name,
    config: {
        model: Object.assign(
            { 'title-en': name, module: 'chessbase', summary: 'S ' + name, rules: 'r.html' },
            over.model
        ),
        view: Object.assign({ skins: [{ name: 'skin2d' }] }, over.view),
    },
});

// ---------------------------------------------------------------- localisation

test('normalizeLocalized : chaine nue = anglais, objet filtre, vide = null', () => {
    assert.deepEqual(normalizeLocalized('Chess'), { en: 'Chess' });
    assert.deepEqual(normalizeLocalized({ en: 'Chess', fr: 'Échecs' }), { en: 'Chess', fr: 'Échecs' });
    assert.deepEqual(normalizeLocalized({ en: 'Chess', fr: '' }), { en: 'Chess' });
    assert.equal(normalizeLocalized(''), null);
    assert.equal(normalizeLocalized(undefined), null);
});

test('pickLocalized : locale exacte, puis langue, puis anglais, puis n\'importe laquelle', () => {
    assert.equal(pickLocalized({ 'fr-CA': 'A', fr: 'B', en: 'C' }, 'fr-CA'), 'A');
    assert.equal(pickLocalized({ fr: 'B', en: 'C' }, 'fr-CA'), 'B'); // fr-CA -> fr
    assert.equal(pickLocalized({ en: 'C' }, 'de'), 'C');
    assert.equal(pickLocalized({ es: 'D' }, 'de'), 'D'); // ni de ni en : plutot que rien
    assert.equal(pickLocalized(null, 'fr'), '');
    // Toujours une chaine : un objet qui fuit casse les filtres (.toLowerCase()).
    assert.equal(typeof pickLocalized({ zz: 'x' }, 'fr'), 'string');
    assert.equal(pickLocalized('deja une chaine', 'fr'), 'deja une chaine');
});

test('preferredLocale : choix memorise > langue du navigateur > anglais', () => {
    configure({ locales: [{ code: 'en' }, { code: 'fr' }] });
    assert.equal(preferredLocale('fr', ['de']), 'fr');
    assert.equal(preferredLocale(null, ['fr-CA', 'en']), 'fr'); // fr-CA reduit a fr
    assert.equal(preferredLocale(null, ['de', 'it']), 'en');
    assert.equal(preferredLocale('zz', ['de']), 'en'); // memorise mais inconnu
});

test('t : cle absente = texte anglais affiche, pas un identifiant technique', () => {
    configure({ translations: { Play: 'Jouer' }, locale: 'fr' });
    assert.equal(t('Play'), 'Jouer');
    assert.equal(t('Not translated yet'), 'Not translated yet');
    configure({ translations: {}, locale: 'en' });
});

// ---------------------------------------------------------------- niveaux

test('translateLevelLabel : traduction directe quand elle existe', () => {
    const tr = (x) => ({ Easy: 'Facile', Strong: 'Fort' }[x] || x);
    assert.equal(translateLevelLabel('Easy', tr), 'Facile');
    assert.equal(translateLevelLabel('Strong', tr), 'Fort');
    // Libelle sans traduction : on rend l'anglais, jamais une chaine vide.
    assert.equal(translateLevelLabel('Padawan', tr), 'Padawan');
    assert.equal(translateLevelLabel('', tr), '');
    assert.equal(translateLevelLabel(null, tr), '');
});

test('translateLevelLabel : les durees se traduisent par MOTIF', () => {
    // Cinq libelles du catalogue portent une duree, en crochets OU en
    // parentheses. Les traiter par motif plutot que par table fait que
    // « Fast [5sec] », le jour ou jocly en ajoute une, ne restera pas en
    // anglais sans qu'on s'en apercoive.
    const tr = (x) => ({ Fast: 'Rapide', Slow: 'Lent', sec: 's' }[x] || x);
    assert.equal(translateLevelLabel('Fast [1sec]', tr), 'Rapide [1 s]');
    assert.equal(translateLevelLabel('Fast (1sec)', tr), 'Rapide [1 s]');
    assert.equal(translateLevelLabel('Slow (10sec)', tr), 'Lent [10 s]');
    assert.equal(translateLevelLabel('Fast [3sec]', tr), 'Rapide [3 s]');
    // Duree inedite : traduite quand meme.
    assert.equal(translateLevelLabel('Fast [5sec]', tr), 'Rapide [5 s]');
});

test('translateLevelLabel : « Level N » est aussi un motif', () => {
    // C'est le libelle que le catalogue fabrique pour les niveaux que jocly
    // ne nomme pas.
    const tr = (x) => ({ 'Level {n}': 'Niveau {n}' }[x] || x);
    assert.equal(translateLevelLabel('Level 3', tr), 'Niveau 3');
    assert.equal(translateLevelLabel('Level 12', tr), 'Niveau 12');
});

test('translateLevelLabel : sans traducteur, rend le libelle inchange', () => {
    const identity = (x) => x;
    assert.equal(translateLevelLabel('Expert', identity), 'Expert');
    assert.equal(translateLevelLabel('Fast [1sec]', identity), 'Fast [1 sec]');
});

// ---------------------------------------------------------------- skins

test('pick2dSkin : le drapeau 3d prime sur le nom du skin', () => {
    // Des skins 2D s'appellent alquerque2d, draughts2d... : se fier au prefixe
    // « skin2d » les manquerait tous.
    assert.deepEqual(pick2dSkin([{ name: 'skin3d', '3d': true }, { name: 'alquerque2d' }]), {
        name: 'alquerque2d',
        is2d: true,
        fallback: false,
    });
    assert.deepEqual(pick2dSkin([{ name: 'a', '3d': true }]), { name: 'a', is2d: false, fallback: true });
    assert.deepEqual(pick2dSkin([]), { name: null, is2d: false, fallback: true });
});

// ---------------------------------------------------------------- catalogue

test('buildCatalog : tier, tri, comptes', () => {
    const { catalog } = buildCatalog(
        [{ module: 'chessbase', games: [raw('zeta'), raw('alpha'), raw('huge')] }],
        { ineligible: ['huge'] }
    );
    assert.equal(catalog.counts.games, 3);
    assert.equal(catalog.counts.phone, 2);
    assert.equal(catalog.counts.tablet, 1);
    assert.deepEqual(catalog.games.map((g) => g.name), ['alpha', 'huge', 'zeta']);
    assert.equal(catalog.games.find((g) => g.name === 'huge').tier, 'tablet');
});

test('buildCatalog : un nom inconnu dans la liste d\'ineligibilite fait ECHOUER le build', () => {
    // Sans ce garde-fou, « terachess » au lieu de « tera-chess » n'exclurait
    // rien et le jeu apparaitrait sur telephone sans qu'on s'en apercoive.
    assert.throws(
        () => buildCatalog([{ module: 'm', games: [raw('a')] }], { ineligible: ['faute-de-frappe'] }),
        /faute-de-frappe/
    );
});

test('buildCatalog : signale les jeux sans skin 2D et sans regles', () => {
    const { warnings } = buildCatalog(
        [{ module: 'm', games: [raw('only3d', { view: { skins: [{ name: 's', '3d': true }] }, model: { rules: undefined } })] }],
        { ineligible: [] }
    );
    assert.ok(warnings.some((w) => /aucun skin 2D pour only3d/.test(w)));
    assert.ok(warnings.some((w) => /aucune regle pour only3d/.test(w)));
});

test('buildCatalog : switchable est retenu (viewAs n\'a de sens que la)', () => {
    const { catalog } = buildCatalog(
        [{ module: 'm', games: [raw('a', { view: { switchable: true, skins: [{ name: 's2d' }] } }), raw('b')] }],
        { ineligible: [] }
    );
    assert.equal(catalog.games.find((g) => g.name === 'a').switchable, true);
    assert.equal(catalog.games.find((g) => g.name === 'b').switchable, false);
});

test('buildEntry : entree invalide rendue null plutot que partielle', () => {
    assert.equal(buildEntry(null, { ineligible: new Set() }), null);
    assert.equal(buildEntry({ name: 'x' }, { ineligible: new Set() }), null);
});

// ---------------------------------------------------------------- filtrage

const games = [
    { name: 'classic-chess', module: 'chessbase', title: { en: 'Chess', fr: 'Échecs' }, summary: { en: 'Orthodox' }, tier: 'phone', obsolete: false },
    { name: 'sweet16-chess', module: 'chessbase', title: { en: 'Sweet 16' }, summary: { en: 'Big board' }, tier: 'tablet', obsolete: false },
    { name: 'basic-chess', module: 'chessbase', title: { en: 'Basic' }, summary: {}, tier: 'phone', obsolete: true },
    { name: 'go', module: 'margo', title: { en: 'Margo' }, summary: { en: 'Spheres' }, tier: 'phone', obsolete: false },
];

test('filterGames : le telephone masque les jeux tablette, sauf « afficher tous »', () => {
    assert.deepEqual(filterGames(games, { tier: 'phone' }).map((g) => g.name), ['classic-chess', 'go']);
    assert.deepEqual(filterGames(games, { tier: 'phone', showAll: true }).map((g) => g.name), [
        'classic-chess',
        'sweet16-chess',
        'go',
    ]);
    // Sur tablette rien n'est masque, meme sans « afficher tous ».
    assert.equal(filterGames(games, { tier: 'tablet' }).length, 3);
});

test('filterGames : recherche insensible a la casse ET aux accents', () => {
    assert.deepEqual(filterGames(games, { tier: 'phone', query: 'echecs', locale: 'fr' }).map((g) => g.name), [
        'classic-chess',
    ]);
    assert.deepEqual(filterGames(games, { tier: 'phone', query: 'ÉCHECS', locale: 'fr' }).map((g) => g.name), [
        'classic-chess',
    ]);
    // La recherche porte aussi sur le resume et sur le nom technique.
    assert.deepEqual(filterGames(games, { tier: 'phone', query: 'spheres' }).map((g) => g.name), ['go']);
});

test("filterGames : la recherche trouve dans TOUTES les langues, pas seulement l'affichee", () => {
    // Constate a la sonde navigateur : interface en anglais, « echecs » ne
    // renvoyait rien alors que le jeu porte bien un titre francais.
    assert.deepEqual(filterGames(games, { tier: 'phone', query: 'echecs', locale: 'en' }).map((g) => g.name), [
        'classic-chess',
    ]);
    assert.deepEqual(filterGames(games, { tier: 'phone', query: 'chess', locale: 'fr' }).map((g) => g.name), [
        'classic-chess',
    ]);
});

test('filterGames : les jeux obsoletes sont masques par defaut', () => {
    assert.ok(!filterGames(games, { tier: 'phone' }).some((g) => g.name === 'basic-chess'));
    assert.ok(filterGames(games, { tier: 'phone', showObsolete: true }).some((g) => g.name === 'basic-chess'));
});

test('searchableText rend une chaine meme si un champ manque', () => {
    assert.equal(typeof searchableText({ name: 'x', title: {}, summary: null }), 'string');
    assert.equal(normalize('Échecs'), 'echecs');
});

test('groupByModule : modules tries, jeux tries par titre LOCALISE', () => {
    const g = groupByModule(games, 'fr');
    assert.deepEqual(g.map((x) => x.module), ['chessbase', 'margo']);
    // En francais « Échecs » se classe apres « Basic »/« Sweet 16 » : le tri
    // suit la langue affichee, pas l'anglais.
    assert.deepEqual(g[0].games.map((x) => x.title.fr || x.title.en), ['Basic', 'Échecs', 'Sweet 16']);
});

test('initialCollapsed : TOUS les modules replies, mais tout deroule en recherche', () => {
    // 12 modules et jusqu'a 116 jeux : deroulee, la liste enterre checkers,
    // tafl ou margo sous chessbase. Repliee, elle donne la carte des familles.
    const groups = [
        { module: 'chessbase', games: new Array(80).fill({}) },
        { module: 'checkers', games: new Array(11).fill({}) },
        { module: 'tafl', games: new Array(6).fill({}) },
    ];
    assert.deepEqual([...initialCollapsed(groups)].sort(), ['checkers', 'chessbase', 'tafl']);
    // Afficher des sections fermees sur des resultats qu'on vient de demander
    // n'aurait pas de sens.
    assert.equal(initialCollapsed(groups, { searching: true }).size, 0);
    assert.equal(initialCollapsed([]).size, 0);
});

// ---------------------------------------------------------------- appareil

test('classify : pointeur fin = tablette quelle que soit la taille', () => {
    assert.equal(classify({ shortSide: 360, coarsePointer: false }), 'tablet');
    assert.equal(classify({ shortSide: 360, coarsePointer: true }), 'phone');
    assert.equal(classify({ shortSide: 768, coarsePointer: true }), 'tablet');
    assert.equal(classify({ shortSide: 599, coarsePointer: true }), 'phone');
    assert.equal(classify({ shortSide: 600, coarsePointer: true }), 'tablet');
});

// ---------------------------------------------------------------- interruptions

test("isAbortError : l'interruption voulue d'un tour n'est pas une panne", () => {
    // abortUserTurn() fait REJETER le userTurn() en cours. Sans cette
    // distinction, changer une option de vue affichait « le moteur de jeu
    // n'a pas pu etre charge » (constate a la sonde).
    assert.ok(isAbortError(new Error('User input aborted')));
    assert.ok(isAbortError(new Error('aborted')));
    assert.ok(!isAbortError(new Error('Failed to load script: dist/jocly.js')));
    assert.ok(!isAbortError(null));
    assert.ok(!isAbortError({}));
});

// ---------------------------------------------------------------- reprise

test('takeBackTarget : un coup a deux humains, deux contre l\'ordinateur', () => {
    // A deux humains, on defait le dernier coup joue.
    assert.equal(takeBackTarget(5, 2), 4);
    assert.equal(takeBackTarget(1, 2), 0);
    // Contre l'ordinateur, on defait sa reponse ET son propre coup.
    assert.equal(takeBackTarget(4, 1), 2);
    assert.equal(takeBackTarget(2, 1), 0);
    // Un seul coup joue : on revient au debut plutot que de refuser.
    assert.equal(takeBackTarget(1, 1), 0);
    // Rien a reprendre.
    assert.equal(takeBackTarget(0, 1), null);
    assert.equal(takeBackTarget(0, 2), null);
});

test('buildCatalog : les niveaux sont indexes par position, avec leur libelle', () => {
    // 28 jeux sur 128 declarent des niveaux SANS champ `name` (seulement
    // `label`) : indexer par nom donnait des entrees nulles et des lignes
    // vides dans la liste deroulante.
    const { catalog } = buildCatalog(
        [
            {
                module: 'm',
                games: [
                    raw('a', {
                        model: {
                            levels: [
                                { label: 'Fast', ai: 'uct', isDefault: true },
                                { label: 'Expert', ai: 'fairy-stockfish' },
                                { name: 'sansLabel', ai: 'uct' },
                                { ai: 'uct' },
                            ],
                        },
                    }),
                ],
            },
        ],
        { ineligible: [] }
    );
    const levels = catalog.games[0].levels;
    assert.deepEqual(levels.map((l) => l.label), ['Fast', 'Expert', 'sansLabel', 'Level 4']);
    assert.equal(levels[0].isDefault, true);
    assert.equal(levels[1].ai, 'fairy-stockfish');
    // Aucun libelle vide, quelle que soit la declaration du jeu.
    assert.ok(levels.every((l) => typeof l.label === 'string' && l.label.length > 0));
});

// ---------------------------------------------------------------- jeu a distance desactivable

test('allowedMode : « remote » est refuse quand le jeu a distance est coupe', () => {
    // Une preference memorisee peut valoir « remote » alors que la
    // fonctionnalite vient d'etre retiree : sans ce garde-fou, l'application
    // chercherait un relai qui n'existe pas et l'ecran resterait bloque.
    const avant = CONFIG.remotePlay;
    try {
        CONFIG.remotePlay = true;
        assert.equal(allowedMode('remote'), 'remote');
        assert.equal(allowedMode('human'), 'human');
        assert.equal(allowedMode('ai'), 'ai');

        CONFIG.remotePlay = false;
        assert.equal(allowedMode('remote'), 'ai', 'retombe sur l\'ordinateur');
        // Les deux autres adversaires ne sont pas concernes.
        assert.equal(allowedMode('human'), 'human');
        assert.equal(allowedMode('ai'), 'ai');
    } finally {
        CONFIG.remotePlay = avant;
    }
});

test('allowedMode : une valeur inconnue retombe sur l\'ordinateur', () => {
    assert.equal(allowedMode('n\'importe quoi'), 'ai');
    assert.equal(allowedMode(undefined), 'ai');
    assert.equal(allowedMode(null), 'ai');
});

test('remotePlay est actif par defaut', () => {
    // Retirer le jeu a distance doit rester un choix EXPLICITE : personne ne
    // doit perdre la fonctionnalite par accident de configuration.
    assert.equal(CONFIG.remotePlay, true);
});

// ---------------------------------------------------------------- dist

const JOCLY_BODY = 'var Jocly=function(){global.BrowserScriptLoader={};}();';
const SPA_FALLBACK = '<!doctype html><html><body><div id="app"></div></body></html>';

function fakeFetch(map) {
    return async (url) => {
        if (!(url in map)) return { ok: false, status: 404, text: async () => '' };
        return { ok: true, status: 200, text: async () => map[url] };
    };
}

test('normalizeBase : une seule barre finale, quelle que soit l\'entree', () => {
    assert.equal(normalizeBase('dist'), 'dist/');
    assert.equal(normalizeBase('dist/'), 'dist/');
    assert.equal(normalizeBase('../jocly/dist//'), '../jocly/dist/');
});

test('orderedCandidates : l\'emplacement memorise passe en tete, sans doublon', () => {
    assert.deepEqual(orderedCandidates(null, ['dist', '../dist']), ['dist/', '../dist/']);
    assert.deepEqual(orderedCandidates('../dist', ['dist', '../dist']), ['../dist/', 'dist/']);
    // Un emplacement memorise hors liste reste essaye en premier.
    assert.deepEqual(orderedCandidates('x/y', ['dist']), ['x/y/', 'dist/']);
});

test('expandCandidates : chaque racine est essayee nue PUIS suivie de browser/', () => {
    assert.deepEqual(expandCandidates(['dist', '../jocly/dist']), [
        'dist/',
        'dist/browser/',
        '../jocly/dist/',
        '../jocly/dist/browser/',
    ]);
    // Les deux formes d'une meme racine se suivent : si la racine existe,
    // c'est la qu'est le dist.
    assert.equal(DIST_CANDIDATES.length, 8);
    assert.ok(DIST_CANDIDATES.includes('../jocly/dist/browser/'));
});

test('locateDist : disposition reelle variantes/ — le moteur est sous dist/browser', async () => {
    // Cas qui a mis le manque en evidence :
    //   variantes/jocly/dist/browser  <- jocly.js est ICI
    //   variantes/joclymatch
    //   variantes/mogichex
    // La liste sans le niveau « browser » echouait sur les quatre candidats.
    const r = await locateDist({
        fetchImpl: fakeFetch({ '../jocly/dist/browser/jocly.js': JOCLY_BODY }),
    });
    assert.equal(r.base, '../jocly/dist/browser/');
});

test('locateDist : trouve un dist frere quand il n\'est pas dans mogichex', async () => {
    const r = await locateDist({
        fetchImpl: fakeFetch({ '../dist/jocly.js': JOCLY_BODY }),
        candidates: ['dist', '../dist', 'jocly/dist'],
    });
    assert.equal(r.base, '../dist/');
});

test('locateDist : un 200 qui rend la page de repli ne compte PAS', async () => {
    // Le .htaccess livre renvoie index.html pour toute URL sans fichier
    // correspondant : sans verification du contenu, le premier candidat
    // gagnerait toujours et le vrai dist ne serait jamais trouve.
    const r = await locateDist({
        fetchImpl: fakeFetch({ 'dist/jocly.js': SPA_FALLBACK, '../jocly/dist/jocly.js': JOCLY_BODY }),
        candidates: ['dist', '../jocly/dist'],
    });
    assert.equal(r.base, '../jocly/dist/');
    assert.ok(r.tried.some((t) => /contenu non reconnu/.test(t)));
});

test('locateDist : un emplacement memorise devenu invalide ne bloque pas', async () => {
    const r = await locateDist({
        remembered: '../dist',
        fetchImpl: fakeFetch({ 'dist/jocly.js': JOCLY_BODY }),
        candidates: ['dist', '../dist'],
    });
    assert.equal(r.base, 'dist/');
});

test('locateDist : aucun dist => base nulle et liste de ce qui a ete essaye', async () => {
    const r = await locateDist({ fetchImpl: fakeFetch({}), candidates: ['dist', '../dist'] });
    assert.equal(r.base, null);
    assert.equal(r.tried.length, 2);
});

test('locateDist : une erreur reseau sur un candidat n\'interrompt pas la recherche', async () => {
    const r = await locateDist({
        fetchImpl: async (url) => {
            if (url.startsWith('dist/')) throw new Error('reseau coupe');
            return { ok: true, status: 200, text: async () => JOCLY_BODY };
        },
        candidates: ['dist', '../dist'],
    });
    assert.equal(r.base, '../dist/');
});

test('looksLikeJocly distingue le moteur de la page de repli', () => {
    assert.ok(looksLikeJocly(JOCLY_BODY));
    assert.ok(!looksLikeJocly(SPA_FALLBACK));
    assert.ok(!looksLikeJocly(''));
    assert.ok(!looksLikeJocly(undefined));
});

// ---------------------------------------------------------------- invitations

test('newMatchId : format joclymatch <horodatage>-<14 caracteres>', () => {
    const id = newMatchId(1754035200000);
    assert.match(id, /^1754035200000-[A-Za-z0-9]{14}$/);
    assert.ok(MATCH_ID_RE.test(id));
});

test('makeId : tirage uniforme, pas de biais de modulo', () => {
    // 256 n'est pas multiple de 62 : un modulo brut favoriserait les 8
    // premiers caracteres. On rejette les octets >= 248.
    const bytes = [];
    for (let i = 0; i < 256; i++) bytes.push(i);
    let cursor = 0;
    const gen = (k) => {
        const out = new Uint8Array(k);
        for (let i = 0; i < k; i++) out[i] = bytes[cursor++ % 256];
        return out;
    };
    const id = makeId(200, gen);
    assert.equal(id.length, 200);
    // Aucun caractere hors alphabet.
    assert.match(id, /^[A-Za-z0-9]+$/);
});

test('buildInviteLink / parseInviteLink : aller-retour', () => {
    const link = buildInviteLink({
        game: 'classic-chess',
        matchId: '1754035200000-AbCdEfGhIjKlMn',
        side: 'a',
        locale: 'fr',
    });
    const parsed = parseInviteLink(link);
    assert.equal(parsed.game, 'classic-chess');
    assert.equal(parsed.matchId, '1754035200000-AbCdEfGhIjKlMn');
    assert.equal(parsed.side, 'a');
    assert.equal(parsed.locale, 'fr');
    assert.equal(parsed.origin, 'mogichex');
});

test("parseInviteLink : un lien joclymatch est lisible tel quel", () => {
    // C'est tout l'interet de reprendre le format : coller un lien
    // joclymatch dans mogichex donne le bon jeu, la bonne partie, le bon camp.
    const p = parseInviteLink(
        'https://exemple.fr/joclymatch/index.php?game=classic-chess&mid=1754035200000-AbCdEfGhIjKlMn&player=b'
    );
    assert.equal(p.game, 'classic-chess');
    assert.equal(p.side, 'b');
    assert.equal(p.origin, 'joclymatch');
});

test('parseInviteLink : un lien tronque ou invalide rend null', () => {
    // Un copier-coller incomplet ne doit PAS lancer une partie sur des
    // valeurs partielles.
    assert.equal(parseInviteLink('index.html?game=classic-chess'), null);
    assert.equal(parseInviteLink('index.html?mid=1754035200000-AbCdEfGhIjKlMn'), null);
    assert.equal(parseInviteLink('index.html?game=chess&mid=court'), null);
    assert.equal(parseInviteLink('index.html?game=../evil&mid=1754035200000-AbCdEfGhIjKlMn'), null);
    assert.equal(parseInviteLink(''), null);
    assert.equal(parseInviteLink(null), null);
});

test('parseInviteLink : le camp est facultatif', () => {
    const p = parseInviteLink('index.html?game=classic-chess&mid=1754035200000-AbCdEfGhIjKlMn');
    assert.equal(p.side, null);
    assert.equal(p.game, 'classic-chess');
});

test('otherSide', () => {
    assert.equal(otherSide('a'), 'b');
    assert.equal(otherSide('b'), 'a');
    assert.equal(otherSide('z'), null);
});

test("buildEnvelope / isUsableEnvelope : format joclymatch, debris rejetes", () => {
    const env = buildEnvelope({
        matchDetails: { matchId: 'x', gameName: 'classic-chess' },
        matchdata: { moves: [] },
        now: 42,
        key: 'k',
    });
    assert.deepEqual(Object.keys(env).sort(), ['key', 'matchDetails', 'matchdata', 'time']);
    assert.equal(env.time, 42);
    assert.ok(isUsableEnvelope(env));
    // match.php rend {} pour une partie jamais sauvegardee : le client ne
    // doit pas le prendre pour un etat jouable.
    assert.ok(!isUsableEnvelope({}));
    assert.ok(!isUsableEnvelope(null));
    assert.ok(!isUsableEnvelope({ matchDetails: {} }));
});

// ---------------------------------------------------------------- boucle de jeu

const J = { PLAYER_A: 1, PLAYER_B: -1 };

/**
 * Faux match : juste ce que la boucle appelle. Il permet de tester l'ordre
 * des operations sans jocly, sans DOM et sans reseau.
 * `maxTurns` borne la partie pour qu'un test qui tourne mal ne parte pas en
 * boucle infinie (ce qui est arrive en ecrivant ces tests).
 */
function fakeMatch(o = {}) {
    return {
        finished: o.finished || false,
        turn: o.turn === undefined ? J.PLAYER_A : o.turn,
        armed: 0,
        searched: 0,
        moves: 0,
        maxTurns: o.maxTurns === undefined ? 2 : o.maxTurns,
        getTurn() {
            return Promise.resolve(this.turn);
        },
        userTurn() {
            this.armed++;
            if (o.userTurnHangs) return new Promise(() => {});
            this.moves++;
            if (this.moves >= this.maxTurns) this.finished = true;
            return Promise.resolve();
        },
        getFinished() {
            return Promise.resolve({ finished: this.finished, winner: J.PLAYER_B });
        },
        machineSearch() {
            this.searched++;
            return Promise.resolve({ move: 'm' });
        },
        playMove() {
            this.moves++;
            if (this.moves >= this.maxTurns) this.finished = true;
            return Promise.resolve();
        },
    };
}

function session(match, opts = {}, hooks = {}) {
    const s = new GameSession({}, { name: 'g', levels: [] }, hooks);
    s.Jocly = J;
    s.match = match;
    s.humanSides = opts.humanSides || [J.PLAYER_A];
    s.mode = opts.mode || 'ai';
    s.remoteSide = opts.remoteSide || null;
    return s;
}

const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- repli Expert

test("fallbackNotice : silencieuse tant que jocly ne signale rien", () => {
    assert.equal(fallbackNotice(null), null);
    assert.equal(fallbackNotice({}), null);
    assert.equal(fallbackNotice({ move: 'e4' }), null);
    assert.equal(fallbackNotice({ fairyFallback: null }), null);
});

test('fallbackNotice : nomme le niveau reellement joue', () => {
    const msg = fallbackNotice({
        fairyFallback: { engine: 'fairy-stockfish', reason: 'SharedArrayBuffer…', level: 'Strong' },
    });
    assert.match(msg, /Strong/);
    assert.match(msg, /Expert/);
    assert.ok(!/\{level\}/.test(msg), 'le gabarit doit etre remplace');
});

test('fallbackNotice : passe par la traduction fournie', () => {
    const msg = fallbackNotice(
        { fairyFallback: { level: 'Fort' } },
        () => 'Niveau reel : {level}'
    );
    assert.equal(msg, 'Niveau reel : Fort');
});

test("le repli n'est annonce QU'UNE FOIS par partie", async () => {
    // jocly purge son drapeau apres l'avoir signale, mais il le reposerait a
    // chaque coup tant que le moteur ne demarre pas : repeter la phrase a
    // chaque tour serait du bruit.
    const annonces = [];
    const m = fakeMatch({ turn: J.PLAYER_B, maxTurns: 6 });
    m.machineSearch = function () {
        this.searched++;
        return Promise.resolve({ move: 'm', fairyFallback: { level: 'Strong' } });
    };
    const s = session(m, { humanSides: [J.PLAYER_A] }, { onFallback: (fb) => annonces.push(fb.level) });
    s.run();
    await tick(120);
    assert.ok(m.searched >= 2, 'plusieurs recherches doivent avoir eu lieu');
    assert.deepEqual(annonces, ['Strong']);
});


test('la fin de partie est annoncee meme quand elle arrive du camp adverse', async () => {
    // Symptome constate sur appareil : « joueur B gagne » ne revenait pas au
    // telephone qui avait ouvert la partie. Cause : la boucle testait
    // getFinished() APRES avoir arme un tour, donc elle armait userTurn() sur
    // une partie deja finie — et userTurn() ne se resout jamais dans ce cas.
    const m = fakeMatch({ finished: true, turn: J.PLAYER_A, userTurnHangs: true });
    let finished = null;
    const s = session(m, { mode: 'remote', remoteSide: J.PLAYER_B }, {
        onFinished: (res) => (finished = res),
    });
    s.run();
    await tick();
    assert.ok(finished, 'onFinished doit etre appele');
    assert.equal(finished.winner, J.PLAYER_B);
    assert.equal(m.armed, 0, 'aucun tour ne doit etre arme sur une partie finie');
    assert.equal(s.loopActive, false);
});

test('partie en cours : le tour humain est bien arme', async () => {
    const m = fakeMatch({ maxTurns: 1 });
    let finished = null;
    const s = session(m, {}, { onFinished: (res) => (finished = res) });
    s.run();
    await tick();
    assert.equal(m.armed, 1);
    assert.ok(finished, 'la fin qui suit le coup doit etre vue');
});

test("camp distant : on attend, on n'arme rien et on ne fait pas jouer l'ordinateur", async () => {
    // Sans cette troisieme branche, l'ordinateur jouerait a la place de
    // l'adversaire distant.
    const m = fakeMatch({ turn: J.PLAYER_B });
    const s = session(m, { mode: 'remote', remoteSide: J.PLAYER_B });
    s.run();
    await tick();
    assert.equal(m.armed, 0);
    assert.equal(m.searched, 0);
    assert.equal(s.loopActive, false, 'la boucle se met en pause jusqu\'a l\'arrivee du coup');
});

test('contre l\'ordinateur : une recherche est lancee pour le camp machine', async () => {
    const m = fakeMatch({ turn: J.PLAYER_B, maxTurns: 1 });
    const s = session(m, { humanSides: [J.PLAYER_A] });
    s.run();
    await tick();
    assert.equal(m.searched, 1);
    assert.equal(m.armed, 0);
});

// ---------------------------------------------------------------- jeu a distance

const envOf = (turns, key, game = 'classic-chess') => ({
    matchDetails: { matchId: 'm', gameName: game, nbTurns: turns },
    matchdata: { playedMoves: [], initialBoard: null, game },
    time: 1,
    key,
});

test("shouldApplyEnvelope : {} de match.php n'est PAS un etat jouable", () => {
    // match.php rend {} pour une partie jamais sauvegardee. La passer a
    // match.load() planterait.
    assert.equal(shouldApplyEnvelope({}, { selfKey: 'moi', lastTurns: 0 }).apply, false);
    assert.equal(shouldApplyEnvelope(null, { selfKey: 'moi', lastTurns: 0 }).reason, 'empty');
});

test('shouldApplyEnvelope : on ignore SA PROPRE enveloppe', () => {
    // Les deux camps ecrivent dans le meme fichier : sans ce test, chacun se
    // rechargerait lui-meme en boucle et interromprait son propre tour.
    const v = shouldApplyEnvelope(envOf(3, 'moi'), { selfKey: 'moi', lastTurns: 0 });
    assert.equal(v.apply, false);
    assert.equal(v.reason, 'own');
});

test('shouldApplyEnvelope : rien de neuf = on ne redessine pas', () => {
    assert.equal(shouldApplyEnvelope(envOf(3, 'lui'), { selfKey: 'moi', lastTurns: 3 }).reason, 'stale');
    assert.equal(shouldApplyEnvelope(envOf(4, 'lui'), { selfKey: 'moi', lastTurns: 3 }).apply, true);
});

test("shouldApplyEnvelope : une partie d'un AUTRE jeu est refusee", () => {
    // match.load() rejette deja un jeu different, mais autant ne pas lui
    // envoyer : le message d'erreur brut n'apprendrait rien a l'utilisateur.
    const v = shouldApplyEnvelope(envOf(4, 'lui', 'shogi'), {
        selfKey: 'moi',
        lastTurns: 0,
        gameName: 'classic-chess',
    });
    assert.equal(v.reason, 'other-game');
});

test('envelopeTurns / nextSince : jamais de recul', () => {
    assert.equal(envelopeTurns(envOf(7, 'x')), 7);
    assert.equal(envelopeTurns({}), 0);
    // Un en-tete absent ou aberrant ne doit pas faire repartir l'attente du
    // debut, ce qui rejouerait tout l'historique.
    assert.equal(nextSince('1754035200', 0), 1754035200);
    assert.equal(nextSince(null, 42), 42);
    assert.equal(nextSince('abc', 42), 42);
    assert.equal(nextSince('10', 42), 42);
});

test('backoffDelay : 1 s, 2 s, 4 s… plafonne', () => {
    assert.equal(backoffDelay(0), 0);
    assert.equal(backoffDelay(1), 1000);
    assert.equal(backoffDelay(3), 4000);
    assert.equal(backoffDelay(99), 30000);
});

test('sidesFor : le camp local et son oppose', () => {
    const J = { PLAYER_A: 1, PLAYER_B: -1 };
    assert.deepEqual(sidesFor('a', J), { local: 1, remote: -1 });
    assert.deepEqual(sidesFor('b', J), { local: -1, remote: 1 });
});

test('RelayChannel : publie, puis applique la reponse de l\'adversaire', async () => {
    const sent = [];
    let stored = {};
    let mtime = 0;
    const fakeFetch = async (url, init) => {
        const params = new URLSearchParams(init.body);
        sent.push(params.get('action'));
        if (params.get('action') === 'save') {
            stored = JSON.parse(params.get('data'));
            mtime += 1;
        }
        return {
            ok: true,
            status: 200,
            headers: { get: (h) => (h === 'X-Match-Mtime' ? String(mtime) : null) },
            json: async () => stored,
        };
    };
    const applied = [];
    const ch = new RelayChannel({
        relayUrl: 'https://exemple.fr/relai/',
        matchId: '1754035200000-AbCdEfGhIjKlMn',
        selfKey: 'moi',
        gameName: 'classic-chess',
        onEnvelope: (e) => applied.push(e.matchDetails.nbTurns),
        fetchImpl: fakeFetch,
    });

    await ch.publish(envOf(1, 'moi'));
    // Relire tout de suite ne doit RIEN appliquer : c'est notre enveloppe.
    assert.equal(await ch.pollOnce(), false);
    assert.deepEqual(applied, []);

    // L'adversaire ecrit a son tour.
    stored = envOf(2, 'lui');
    mtime += 1;
    assert.equal(await ch.pollOnce(), true);
    assert.deepEqual(applied, [2]);

    // Relire encore n'applique pas deux fois le meme coup.
    assert.equal(await ch.pollOnce(), false);
    assert.deepEqual(applied, [2]);
    assert.deepEqual(sent, ['save', 'load', 'load', 'load']);
});

test('RelayChannel : la premiere lecture est IMMEDIATE (rattrapage)', async () => {
    // Rejoindre une partie deja commencee ne doit pas attendre 20 s : la
    // premiere lecture se fait sans `since`, donc sans attente longue.
    const asked = [];
    const ch = new RelayChannel({
        relayUrl: 'https://exemple.fr/relai',
        matchId: '1754035200000-AbCdEfGhIjKlMn',
        selfKey: 'moi',
        onEnvelope: () => {},
        fetchImpl: async (u, init) => {
            const p = new URLSearchParams(init.body);
            asked.push(p.has('since'));
            return {
                ok: true,
                status: 200,
                headers: { get: () => '1' },
                json: async () => ({}),
            };
        },
    });
    await ch.pollOnce({ wait: false });
    await ch.pollOnce();
    assert.deepEqual(asked, [false, true]);
});

test('RelayChannel : une panne du relai remonte sans casser la boucle', async () => {
    const errors = [];
    const ch = new RelayChannel({
        relayUrl: 'https://exemple.fr/relai',
        matchId: '1754035200000-AbCdEfGhIjKlMn',
        selfKey: 'moi',
        onEnvelope: () => {},
        onError: (e) => errors.push(e.message),
        fetchImpl: async () => ({ ok: false, status: 503, headers: { get: () => null } }),
    });
    await assert.rejects(() => ch.pollOnce(), /relai 503/);
    assert.equal(errors.length, 0); // onError n'est appele que par la boucle
});

// ---------------------------------------------------------------- relai

const relayFetch = (map) => async (url) => {
    const key = url.replace(/\/match\.php$/, '');
    if (!(key in map)) return { ok: false, status: 404, json: async () => { throw new Error('non JSON'); } };
    const v = map[key];
    return { ok: true, status: 200, json: async () => v };
};
const RELAY_OK = { error: 'bad match id' };
const SPA_HTML = null; // json() qui echoue est simule par l'absence de cle

test('normalizeRelay / orderedRelays', () => {
    assert.equal(normalizeRelay('.'), '.');
    assert.equal(normalizeRelay('../joclymatch/'), '../joclymatch');
    assert.deepEqual(orderedRelays(null), ['.', '../joclymatch']);
    assert.deepEqual(orderedRelays('../joclymatch'), ['../joclymatch', '.']);
    // Le defaut couvre le deploiement de reference.
    assert.deepEqual(RELAY_ROOTS, ['.', '../joclymatch']);
});

test('locateRelay : le relai chez mogichex est trouve en premier', async () => {
    const r = await locateRelay({ fetchImpl: relayFetch({ '.': RELAY_OK }) });
    assert.equal(r.base, '.');
});

test('locateRelay : repli sur le relai de joclymatch', async () => {
    const r = await locateRelay({ fetchImpl: relayFetch({ '../joclymatch': RELAY_OK }) });
    assert.equal(r.base, '../joclymatch');
});

test("locateRelay : une page HTML servie en repli n'est pas un relai", async () => {
    // Le .htaccess renvoie index.html pour toute URL sans fichier : sans
    // verification de la signature, « . » gagnerait toujours.
    const r = await locateRelay({
        fetchImpl: async (url) => ({
            ok: true,
            status: 200,
            json: async () => {
                if (url.startsWith('./')) throw new Error('non JSON');
                return RELAY_OK;
            },
        }),
    });
    assert.equal(r.base, '../joclymatch');
    assert.ok(r.tried.some((t) => /reponse non JSON/.test(t)));
});

test('locateRelay : aucun relai => base nulle et liste des essais', async () => {
    const r = await locateRelay({ fetchImpl: relayFetch({}) });
    assert.equal(r.base, null);
    assert.equal(r.tried.length, 2);
});

test('looksLikeRelay : seule une erreur JSON de match.php compte', () => {
    assert.ok(looksLikeRelay({ error: 'bad match id' }));
    assert.ok(!looksLikeRelay({}));
    assert.ok(!looksLikeRelay(null));
    assert.ok(!looksLikeRelay('<!doctype html>'));
});

// ---------------------------------------------------------------- pair-a-pair

test('isOfferer / boxesFor : un ordre stable, connu des deux cotes', () => {
    // Sans ordre fixe, les deux pairs offrent en meme temps et aucune
    // negociation n'aboutit. Le camp vient du lien d'invitation.
    assert.equal(isOfferer('a'), true);
    assert.equal(isOfferer('b'), false);
    // On n'ecrit jamais dans la boite ou l'on lit.
    assert.deepEqual(boxesFor('a'), { mine: 'a', theirs: 'b' });
    assert.deepEqual(boxesFor('b'), { mine: 'b', theirs: 'a' });
});

test('orderSignals : la description AVANT les candidats', () => {
    // addIceCandidate echoue si la description distante n'est pas encore
    // posee, et le candidat est alors perdu.
    const brut = [
        signalMessage('candidate', { candidate: 'c1' }),
        signalMessage('offer', { sdp: 'x' }),
        signalMessage('candidate', { candidate: 'c2' }),
    ];
    assert.deepEqual(orderSignals(brut).map((m) => m.t), ['offer', 'candidate', 'candidate']);
});

test('orderSignals : les candidats vides (fin de collecte) sont ecartes', () => {
    const brut = [
        signalMessage('answer', { sdp: 'y' }),
        signalMessage('candidate', {}),
        signalMessage('candidate', null),
        signalMessage('candidate', { candidate: 'c' }),
    ];
    assert.deepEqual(orderSignals(brut).map((m) => m.t), ['answer', 'candidate']);
    assert.deepEqual(orderSignals(null), []);
});

test("shouldLongPoll : l'attente longue s'arrete quand le pair est ouvert", () => {
    // C'est tout l'interet : un joueur en attente immobilisait un processus
    // PHP pendant 20 s, en boucle.
    assert.equal(shouldLongPoll('open'), false);
    assert.equal(shouldLongPoll('connecting'), true);
    assert.equal(shouldLongPoll('failed'), true);
    assert.equal(shouldLongPoll('unsupported'), true);
});

test('ICE_SERVERS : du STUN, aucun TURN', () => {
    // Un mutualise ne peut pas heberger coturn, et TURN facturerait de la
    // bande passante pour un service que le relai rend deja.
    assert.ok(ICE_SERVERS.length > 0);
    assert.ok(ICE_SERVERS.every((s) => /^stun:/.test(s.urls)));
});

test("PeerChannel : sans RTCPeerConnection, on reste sur le relai sans bruit", async () => {
    // WebKitGTK des distributions Linux n'expose pas RTCPeerConnection
    // (constate sur Tabulon). Ce n'est pas une panne.
    const etats = [];
    const ch = new PeerChannel({
        relayUrl: 'https://exemple.fr/relai',
        matchId: '1754035200000-AbCdEfGhIjKlMn',
        side: 'a',
        onEnvelope: () => {},
        onStateChange: (s) => etats.push(s),
        rtcFactory: () => null,
        fetchImpl: async () => {
            throw new Error('ne doit pas etre appele');
        },
    });
    await ch.start();
    assert.deepEqual(etats, ['unsupported']);
    assert.equal(ch.isOpen, false);
    // publish() doit refuser proprement plutot que de lever.
    assert.equal(ch.publish({ a: 1 }), false);
});

test("PeerChannel : l'offreur cree le canal AVANT l'offre", async () => {
    // Le canal doit exister avant createOffer, sinon la description ne
    // contient aucune piste de donnees et la connexion ne sert a rien.
    const ordre = [];
    const envois = [];
    const fauxCanal = { readyState: 'connecting', send: () => {}, close: () => {} };
    const fauxPc = {
        createDataChannel: () => {
            ordre.push('createDataChannel');
            return fauxCanal;
        },
        createOffer: async () => {
            ordre.push('createOffer');
            return { type: 'offer', sdp: 'SDP' };
        },
        setLocalDescription: async () => ordre.push('setLocalDescription'),
        setRemoteDescription: async () => {},
        addIceCandidate: async () => {},
        close: () => {},
    };
    const ch = new PeerChannel({
        relayUrl: 'https://exemple.fr/relai',
        matchId: '1754035200000-AbCdEfGhIjKlMn',
        side: 'a',
        onEnvelope: () => {},
        rtcFactory: () => fauxPc,
        timeoutMs: 50,
        fetchImpl: async (u, init) => {
            const p = new URLSearchParams(init.body);
            envois.push(p.get('action') + ':' + (p.get('box') || ''));
            return { ok: true, status: 200, json: async () => ({ messages: [], next: 0 }) };
        },
    });
    await ch.start();
    assert.deepEqual(ordre, ['createDataChannel', 'createOffer', 'setLocalDescription']);
    // L'offre part dans SA boite, et il lit celle d'en face.
    assert.ok(envois.includes('post:a'));
    ch.running = false;
});

test('PeerChannel : publish rend false tant que le canal n\'est pas ouvert', () => {
    const ch = new PeerChannel({
        relayUrl: 'https://exemple.fr/relai',
        matchId: '1754035200000-AbCdEfGhIjKlMn',
        side: 'b',
        onEnvelope: () => {},
        rtcFactory: () => null,
    });
    assert.equal(ch.publish({ x: 1 }), false);
    ch.state = 'open';
    ch.channel = { readyState: 'open', send: () => {} };
    assert.equal(ch.publish({ x: 1 }), true);
});

test("RelayChannel : setLongPolling(false) supprime le parametre d'attente", async () => {
    const asked = [];
    const ch = new RelayChannel({
        relayUrl: 'https://exemple.fr/relai',
        matchId: '1754035200000-AbCdEfGhIjKlMn',
        selfKey: 'moi',
        onEnvelope: () => {},
        fetchImpl: async (u, init) => {
            asked.push(new URLSearchParams(init.body).has('since'));
            return { ok: true, status: 200, headers: { get: () => '1' }, json: async () => ({}) };
        },
    });
    ch.setLongPolling(false);
    await ch.pollOnce({ wait: ch.longPolling });
    ch.setLongPolling(true);
    await ch.pollOnce({ wait: ch.longPolling });
    assert.deepEqual(asked, [false, true]);
});

// ---------------------------------------------------------------- paquet Android

const refs = new Set(['res/visuals/amazon-600x600-2d.jpg']);
const keep = (p, o = {}) => keepFile(p, { referencedVisuals: refs, ...o });

test('citedVisuals : on LIT le HTML des regles, on ne devine pas', () => {
    const html = '<img src="{GAME}/res/visuals/amazon-600x600-2d.jpg"> et res/visuals/autre.png';
    assert.deepEqual(
        [...citedVisuals(html)].sort(),
        ['res/visuals/amazon-600x600-2d.jpg', 'res/visuals/autre.png']
    );
    assert.equal(citedVisuals('rien ici').size, 0);
});

test('keepFile : les captures citees par les regles sont CONSERVEES', () => {
    // 151 captures, dont 24 citees par 32 pages de regles : les supprimer
    // toutes casserait ces pages.
    assert.equal(keep('games/chessbase/res/visuals/amazon-600x600-2d.jpg').keep, true);
    assert.equal(keep('games/chessbase/res/visuals/baby-600x600-3d.jpg').keep, false);
});

test('keepFile : scan/ et res/vr sont du poids mort', () => {
    // chessbase n'utilise que les IA uct et fairy-stockfish.
    assert.equal(keep('scan/scan.wasm').keep, false);
    assert.equal(keep('scan/data/x.bin').keep, false);
    assert.equal(keep('res/vr/quelque-chose.png').keep, false);
    // Un dossier au nom voisin ne doit pas etre emporte.
    assert.equal(keep('scanner/x.js').keep, true);
    assert.equal(keep('res/vrai/x.png').keep, true);
});

test('keepFile : three.js reste embarque MEME sans 3D', () => {
    // jocly le charge sans condition, y compris pour un skin 2D : le retirer
    // donnait « 404 dist/three.js » et un plateau vide. Mesure, pas theorie.
    assert.equal(keep('three.js', { keep3d: false }).keep, true);
});

test('keepFile : les textures 3D de chessbase partent avec --no-3d', () => {
    // Elles ne sont referencees que depuis des blocs mesh + materials des
    // fichiers *-view.js — des definitions de pieces TRIDIMENSIONNELLES.
    // 302 fichiers, 15,4 Mo mesures sur le dist chessbase.
    const off = { keep3d: false };
    assert.equal(keep('games/chessbase/res/staunton/king-normalmap.jpg', off).keep, false);
    assert.equal(keep('games/chessbase/res/staunton/king-diffusemap.jpg', off).keep, false);
    assert.equal(keep('games/chessbase/res/xiangqi/board-normal.jpg', off).keep, false);
    assert.equal(keep('games/chessbase/res/xiangqi/board-diffuse.jpg', off).keep, false);
    // Repertoires entiers de faces de pieces.
    assert.equal(keep('games/chessbase/res/shogi/chu-diffusemaps/copper-b.jpg', off).keep, false);
    assert.equal(keep('games/chessbase/res/counters/diffusemaps/x.jpg', off).keep, false);
    // Sans l'option, tout reste.
    assert.equal(keep('games/chessbase/res/shogi/chu-diffusemaps/copper-b.jpg').keep, true);
});

test('keepFile : le filtre de textures ne deborde PAS hors de chessbase/res', () => {
    // Le res/ de la racine du dist sert a tout autre chose ; et un nom qui
    // se termine par « diffuse.jpg » ailleurs n'est pas concerne.
    const off = { keep3d: false };
    assert.equal(keep('res/textures/bois-diffuse.jpg', off).keep, true);
    assert.equal(keep('games/chessbase/res/rules/mini/mini-thumb.png', off).keep, true);
    // « diffusemaps » doit etre un SEGMENT de chemin, pas un fragment de nom.
    assert.equal(keep('games/chessbase/res/shogi/diffusemapsource.jpg', off).keep, true);
});

test('keepFile : la 3D se filtre par EXTENSION, jamais par dossier', () => {
    // res/fairy melange modeles .gltf et planches de sprites 2D. Retirer le
    // dossier faisait disparaitre wikipedia-fairy-sprites.png, dont les skins
    // 2D ont besoin.
    assert.equal(keep('games/chessbase/res/fairy/roi.gltf', { keep3d: false }).keep, false);
    assert.equal(
        keep('games/chessbase/res/fairy/wikipedia-fairy-sprites.png', { keep3d: false }).keep,
        true
    );
    // Sans l'option, la 3D reste.
    assert.equal(keep('games/chessbase/res/fairy/roi.gltf').keep, true);
});

test('keepFile : le reste du dist est conserve', () => {
    assert.equal(keep('jocly.js').keep, true);
    assert.equal(keep('games/chessbase/res/rules/mini/mini-thumb.png').keep, true);
    assert.equal(keep('fairy-stockfish/stockfish.wasm').keep, true);
});

test('summarize : compte les fichiers et les octets par motif de retrait', () => {
    const r = summarize([
        { keep: true, reason: 'garde', size: 100 },
        { keep: false, reason: 'visuel-non-cite', size: 30 },
        { keep: false, reason: 'visuel-non-cite', size: 20 },
        { keep: false, reason: 'ressource-3d', size: 50 },
    ]);
    assert.equal(r.keptFiles, 1);
    assert.equal(r.keptBytes, 100);
    assert.equal(r.droppedFiles, 3);
    assert.equal(r.droppedBytes, 100);
    assert.deepEqual(r.byReason['visuel-non-cite'], { files: 2, bytes: 50 });
});

// ---------------------------------------------------------------- coherence

test('tous les libelles de niveaux du catalogue sont traduits en francais', () => {
    // 28 libelles distincts viennent de jocly. Ce test attrape celui qui
    // apparaitrait a la prochaine mise a jour sans traduction : sans lui,
    // « Fast [5sec] » resterait en anglais dans une interface francaise sans
    // que personne le remarque.
    const cat = JSON.parse(readFileSync(path.join(root, 'app', 'catalog.json'), 'utf8'));
    const fr = JSON.parse(readFileSync(path.join(root, 'lang', 'fr.json'), 'utf8'));
    const tr = (x) => (fr[x] !== undefined ? fr[x] : x);
    // Ceux-la s'ecrivent pareil dans les deux langues : c'est voulu.
    // « Novice » s'ecrit pareil en francais, comme « Expert » ou « Champion ».
    // Arrive avec jocly 2.8, a cote de « Beginner » (traduit, lui, par
    // « Debutant ») : ce sont deux niveaux distincts, pas un doublon.
    const identiques = new Set(['Expert', 'Padawan', 'Papa', 'Champion', 'Novice', '10 min', '20 min']);
    const labels = [...new Set(cat.games.flatMap((g) => g.levels.map((l) => l.label)))];
    const manquants = labels.filter(
        (l) => translateLevelLabel(l, tr) === l && !identiques.has(l)
    );
    assert.deepEqual(manquants, [], 'libelles de niveaux sans traduction francaise');
    assert.ok(labels.length >= 20, 'le catalogue doit bien porter des niveaux');
});

test('lang/ : chaque locale declaree a son fichier, et le JSON est valide', () => {
    const index = JSON.parse(readFileSync(path.join(root, 'lang', 'index.json'), 'utf8'));
    for (const loc of index.locales) {
        const f = path.join(root, 'lang', loc.code + '.json');
        assert.ok(existsSync(f), 'fichier manquant : ' + f);
        JSON.parse(readFileSync(f, 'utf8'));
    }
    assert.ok(index.locales.some((l) => l.code === index.fallback));
});

test('la mention legale AGPL est presente dans l\'application', () => {
    // Article 13 de l'AGPL : quiconque utilise le programme A TRAVERS UN
    // RESEAU doit se voir offrir le code source correspondant. Les liens de
    // la section « A propos » SONT cette offre — un allegement d'ecran ne
    // doit pas les faire disparaitre sans qu'on s'en apercoive.
    const html = readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.match(html, /github\.com\/fhoudebert\/mogichex/, 'lien vers le source de l\'application');
    assert.match(html, /github\.com\/fhoudebert\/jocly2/, 'lien vers le source de la bibliotheque');
    assert.match(html, /Affero General Public License/, 'mention de la licence');
    assert.match(html, /CC BY-SA 3\.0/, 'attribution des illustrations');
    // Le fichier de licence existe et est bien l'AGPL v3.
    const lic = readFileSync(path.join(root, 'LICENSE'), 'utf8');
    assert.match(lic, /GNU AFFERO GENERAL PUBLIC LICENSE/);
    assert.match(lic, /Version 3, 19 November 2007/);
    // package.json ne doit plus annoncer une licence permissive.
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.match(pkg.license, /^AGPL-3\.0/);
});

test('manifest : chaque icone declaree existe sur le disque', () => {
    // Une icone manquante ne casse rien de visible en developpement, mais
    // l'invite d'installation PWA peut ne jamais apparaitre sur mobile.
    const man = JSON.parse(readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
    for (const icon of man.icons) {
        assert.ok(existsSync(path.join(root, icon.src)), 'icone manquante : ' + icon.src);
    }
});

test('sw.js : TOUS les modules js/ sont pre-caches', () => {
    // L'inverse du test suivant. Trois modules js/remote/ manquaient a la
    // liste : l'application n'aurait pas demarre hors ligne, et rien ne le
    // signalait — le pre-cache tolere les entrees manquantes, pas les oubliees.
    const src = readFileSync(path.join(root, 'sw.js'), 'utf8');
    const list = src.slice(src.indexOf('const SHELL = ['), src.indexOf('];', src.indexOf('const SHELL = [')));
    const caches = new Set([...list.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]));
    const walk = (dir, prefix) => {
        for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
            if (e.isDirectory()) walk(dir + '/' + e.name, prefix + e.name + '/');
            else if (e.name.endsWith('.js')) {
                assert.ok(caches.has(prefix + e.name), 'absent du pre-cache : ' + prefix + e.name);
            }
        }
    };
    walk('js', 'js/');
});

test('sw.js : la coquille pre-cachee existe reellement sur le disque', () => {
    // Une entree fantome ne casse pas l'installation (on tolere les echecs),
    // mais elle signale un fichier renomme sans que la liste ait suivi.
    const src = readFileSync(path.join(root, 'sw.js'), 'utf8');
    const list = src.slice(src.indexOf('const SHELL = ['), src.indexOf('];', src.indexOf('const SHELL = [')));
    for (const m of list.matchAll(/'\.\/([^']+)'/g)) {
        assert.ok(existsSync(path.join(root, m[1])), 'pre-cache inexistant : ' + m[1]);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Premier tour : favoris, horloge, historique, discussion.
// ─────────────────────────────────────────────────────────────────────────────

import { sanitizeFavorites, toggleFavorite, isFavorite, favoriteGroup, FAV_MODULE } from '../js/favorites.js';
import { CLOCK_PRESETS, presetById, formatClock, Clock } from '../js/clock.js';
import { moveRows, rollbackTarget, canRollback } from '../js/history.js';
import {
    KIND,
    PRESENCE,
    chatMidFor,
    newMessage,
    encodeThread,
    decodeThread,
    mergeThreads,
    presenceOf,
    countUnread,
    canNudge,
    requiresSeal,
    NUDGE_MIN_INTERVAL_MS,
} from '../js/remote/chat-protocol.js';
import { ChatChannel } from '../js/remote/chat-channel.js';

// ---- favoris ---------------------------------------------------------------

test('favoris : ajout, retrait, pas de doublon', () => {
    let list = [];
    list = toggleFavorite(list, 'classic-chess');
    assert.deepEqual(list, ['classic-chess']);
    list = toggleFavorite(list, 'classic-chess');
    assert.deepEqual(list, []);
    list = toggleFavorite(toggleFavorite(list, 'shogi'), 'shogi');
    assert.deepEqual(list, []);
    assert.deepEqual(sanitizeFavorites(['a', 'a', '', null, 'b']), ['a', 'b']);
    assert.deepEqual(sanitizeFavorites('pas une liste'), []);
});

test('favoris : la section suit le filtre, elle ne le contredit pas', () => {
    // Un favori ecarte par la recherche ou par le filtre d'appareil ne doit
    // PAS reapparaitre par la bande : sinon « adaptes a cet ecran » afficherait
    // quand meme un 16x16, et une recherche sans resultat en montrerait.
    const filtered = [{ name: 'shogi' }, { name: 'xiangqi' }];
    const group = favoriteGroup(filtered, ['tera-chess', 'xiangqi']);
    assert.equal(group.module, FAV_MODULE);
    assert.deepEqual(group.games.map((g) => g.name), ['xiangqi']);
    assert.equal(favoriteGroup(filtered, ['tera-chess']), null);
    assert.equal(favoriteGroup(filtered, []), null);
});

test('favoris : l ordre est celui du marquage, pas l alphabet', () => {
    const filtered = [{ name: 'a' }, { name: 'b' }, { name: 'z' }];
    const group = favoriteGroup(filtered, ['z', 'a']);
    assert.deepEqual(group.games.map((g) => g.name), ['z', 'a']);
});

test('favoris : la section n est jamais repliee par defaut', () => {
    const groups = [{ module: FAV_MODULE, favorite: true, games: [] }, { module: 'chessbase', games: [] }];
    const collapsed = initialCollapsed(groups, { searching: false });
    assert.equal(collapsed.has(FAV_MODULE), false);
    assert.equal(collapsed.has('chessbase'), true);
});

// ---- horloge ---------------------------------------------------------------

test('horloge : format, dixiemes sous la minute, jamais de negatif', () => {
    assert.equal(formatClock(600000), '10:00');
    assert.equal(formatClock(65000), '1:05');
    assert.equal(formatClock(3600000), '1:00:00');
    assert.equal(formatClock(4300), '0:04.3');
    assert.equal(formatClock(-5000), '0:00.0');
});

test('horloge : l increment va a celui qui vient de jouer', () => {
    const c = new Clock({ initial: 60000, increment: 5000, at: 0 });
    c.switchTo(1, 0); // A demarre
    c.switchTo(-1, 10000); // A a joue apres 10 s : il recupere 5 s
    assert.equal(c.left[1], 55000);
    assert.equal(c.remaining(-1, 10000), 60000);
    c.switchTo(1, 13000); // B a joue apres 3 s
    assert.equal(c.left[-1], 62000);
});

test('horloge : le drapeau tombe une fois et arrete tout', () => {
    const c = new Clock({ initial: 1000, increment: 5000, at: 0 });
    c.switchTo(1, 0);
    assert.equal(c.flagOf(500), null);
    assert.equal(c.flagOf(1500), 1);
    // Meme apres coup, on ne credite plus et l'autre compteur ne repart pas :
    // sans cela, reprendre un coup relancerait une partie deja close.
    c.switchTo(-1, 1600);
    assert.equal(c.running, null);
    assert.equal(c.flagOf(9999), 1);
    assert.equal(c.remaining(-1, 9999), 1000);
});

test('horloge : le premier tour ne credite rien', () => {
    const c = new Clock({ initial: 60000, increment: 5000, at: 0 });
    c.switchTo(1, 0);
    assert.equal(c.left[1], 60000);
    assert.equal(c.left[-1], 60000);
});

test('horloge : « sans horloge » est la cadence par defaut et ne demarre rien', () => {
    assert.equal(CLOCK_PRESETS[0].id, 'none');
    assert.equal(presetById('inconnu').id, 'none');
    assert.equal(presetById('none').initial, 0);
});

// ---- historique ------------------------------------------------------------

test('historique : deux colonnes, chaque cellule numerotee', () => {
    const rows = moveRows(['e4', 'e5', 'Cf3']);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0].cells.map((c) => c.n), [1, 2]);
    assert.deepEqual(rows[1].cells.map((c) => c.n), [3]);
    assert.equal(rows[1].cells[0].text, 'Cf3');
    assert.deepEqual(moveRows([]), []);
    assert.deepEqual(moveRows(null), []);
});

test('historique : revenir au dernier coup ne defait rien', () => {
    assert.equal(rollbackTarget(3, 3, 2), null);
    assert.equal(rollbackTarget(1, 3, 2), 1);
    assert.equal(rollbackTarget(0, 3, 1), 0);
    assert.equal(rollbackTarget(2, 0, 2), null);
});

test('historique : le retour arriere est interdit des qu un camp est distant', () => {
    assert.equal(canRollback({ remote: false, moves: 4 }), true);
    assert.equal(canRollback({ remote: true, moves: 4 }), false);
    assert.equal(canRollback({ remote: false, moves: 0 }), false);
});

// ---- discussion ------------------------------------------------------------

const rand = (bytes) => bytes.fill(7);

test('discussion : deux cles distinctes, acceptees par match.php', () => {
    const mid = '1748100000000-AbCdEfGhIjKlMn';
    assert.equal(chatMidFor(mid, 1), mid + '-ca');
    assert.equal(chatMidFor(mid, -1), mid + '-cb');
    // Le motif du serveur, verifie cote client pour ne pas produire un echec
    // reseau opaque la ou une erreur lisible est possible.
    for (const side of [1, -1]) assert.match(chatMidFor(mid, side), /^[A-Za-z0-9_-]{6,64}$/);
    assert.throws(() => chatMidFor(mid, 0));
    assert.throws(() => chatMidFor('x'.repeat(70), 1));
});

test('discussion : un message rapide voyage comme identifiant, pas comme texte', () => {
    const m = newMessage({ kind: KIND.CHAT, side: 1, quick: 'wellPlayed', at: 10, rand });
    assert.equal(m.quick, 'wellPlayed');
    assert.equal(m.body, undefined);
    assert.equal(requiresSeal(m), false);
    assert.throws(() => newMessage({ kind: KIND.CHAT, side: 1, quick: 'pas valide !', rand }));
    assert.throws(() => newMessage({ kind: KIND.CHAT, side: 1, rand }));
    assert.throws(() => newMessage({ kind: KIND.PRESENCE, side: 1, state: 'inconnu', rand }));
});

test('discussion : le texte libre est REFUSE tant qu il n y a pas de scelleur', async () => {
    // C'est le garde-fou du lot suivant : on ne peut pas ajouter un champ de
    // saisie sans avoir ajoute le chiffrement, l'encodage echouerait.
    const free = { v: 1, kind: KIND.CHAT, side: 1, at: 1, id: 'ab', body: 'bonjour' };
    await assert.rejects(() => encodeThread([free]));
    const quick = newMessage({ kind: KIND.CHAT, side: 1, quick: 'rematch', at: 1, rand });
    const presence = newMessage({ kind: KIND.PRESENCE, side: 1, state: PRESENCE.PAUSED, at: 2, rand });
    assert.ok(await encodeThread([quick, presence]));
});

test('discussion : un fil illisible rend une liste vide, jamais une exception', async () => {
    for (const bad of ['', '{}', 'pas du json', '<html>erreur</html>', JSON.stringify({ msgs: 3 })]) {
        assert.deepEqual(await decodeThread(bad), []);
    }
});

test('discussion : un corps en clair est conserve, verrouille', async () => {
    const text = JSON.stringify({
        v: 1,
        msgs: [{ v: 1, kind: KIND.CHAT, side: -1, at: 5, id: 'ff', body: 'en clair' }],
    });
    const [m] = await decodeThread(text);
    // Ni affiche tel quel (cela laisserait croire que le canal protege quelque
    // chose), ni efface (un trou silencieux est pire qu'un cadenas).
    assert.equal(m.locked, true);
    assert.equal(m.reason, 'unsealed');
    assert.equal(m.body, null);
});

test('discussion : les fils fusionnent, dedupliquent et se trient stablement', () => {
    const a = { id: 'b2', at: 10, kind: KIND.CHAT, side: 1, quick: 'rematch' };
    const b = { id: 'a1', at: 10, kind: KIND.CHAT, side: -1, quick: 'yourTurn' };
    const c = { id: 'c3', at: 5, kind: KIND.CHAT, side: 1, quick: 'wellPlayed' };
    const conv = mergeThreads([a, c], [b, a]);
    assert.deepEqual(conv.map((m) => m.id), ['c3', 'a1', 'b2']);
    assert.equal(mergeThreads([a], [a]).length, 1);
});

test('discussion : presence et non-lus', () => {
    const conv = [
        { id: '1', at: 1, kind: KIND.PRESENCE, side: -1, state: PRESENCE.THINKING },
        { id: '2', at: 2, kind: KIND.PRESENCE, side: -1, state: PRESENCE.PAUSED },
        { id: '3', at: 3, kind: KIND.CHAT, side: 1, quick: 'yourTurn' },
        { id: '4', at: 4, kind: KIND.CHAT, side: -1, quick: 'backSoon' },
    ];
    assert.equal(presenceOf(conv, -1).state, PRESENCE.PAUSED);
    assert.equal(presenceOf(conv, 1), null);
    // Ses propres messages ne comptent jamais : on n'a pas a se relire. La
    // presence, elle, COMPTE — « votre adversaire s'est absente » vaut une
    // pastille autant qu'un message rapide.
    assert.equal(countUnread(conv, null, 1), 3);
    assert.equal(countUnread(conv, '2', 1), 1);
    assert.equal(countUnread(conv, '4', 1), 0);
});

test('discussion : la relance est bornee dans le temps', () => {
    const now = 1000000;
    assert.equal(canNudge([], 1, now), true);
    const recent = [{ id: 'n', at: now - 1000, kind: KIND.NUDGE, side: 1 }];
    assert.equal(canNudge(recent, 1, now), false);
    assert.equal(canNudge(recent, -1, now), true);
    const old = [{ id: 'n', at: now - NUDGE_MIN_INTERVAL_MS - 1, kind: KIND.NUDGE, side: 1 }];
    assert.equal(canNudge(old, 1, now), true);
});

test('discussion : un seul ecrivain par fil — on ecrit chez soi, on lit en face', async () => {
    const calls = [];
    const files = new Map();
    const fakeFetch = async (url, init) => {
        const f = Object.fromEntries(new URLSearchParams(init.body));
        calls.push(f);
        if (f.action === 'save') files.set(f.mid, f.data);
        return {
            ok: true,
            headers: { get: () => '0' },
            text: async () => files.get(f.mid) || '',
        };
    };
    const mid = '1748100000000-AbCdEfGhIjKlMn';
    const chan = new ChatChannel({ relayUrl: '.', matchId: mid, side: 1, fetchImpl: fakeFetch });
    await chan.send({ kind: KIND.CHAT, quick: 'wellPlayed' });
    const saves = calls.filter((c) => c.action === 'save');
    assert.equal(saves.length, 1);
    assert.equal(saves[0].mid, mid + '-ca', 'on n ecrit que dans SON fil');
    assert.equal(chan.theirsMid, mid + '-cb');
    assert.equal(chan.conversation.length, 1);

    // Le fil part en ENTIER : sans cela, le deuxieme message effacerait le
    // premier, puisque le relai est en dernier-ecrit-gagne.
    await chan.send({ kind: KIND.PRESENCE, state: PRESENCE.PAUSED });
    const last = calls.filter((c) => c.action === 'save').pop();
    assert.equal(JSON.parse(last.data).msgs.length, 2);
});

test('discussion : un message du pair entre, le sien est ignore', async () => {
    const chan = new ChatChannel({
        relayUrl: '.',
        matchId: '1748100000000-AbCdEfGhIjKlMn',
        side: 1,
        fetchImpl: async () => ({ ok: true, headers: { get: () => '0' }, text: async () => '' }),
    });
    await chan.acceptFromPeer({ v: 1, kind: KIND.CHAT, side: -1, at: 3, id: 'aa', quick: 'rematch' });
    assert.equal(chan.conversation.length, 1);
    await chan.acceptFromPeer({ v: 1, kind: KIND.CHAT, side: 1, at: 4, id: 'bb', quick: 'rematch' });
    assert.equal(chan.conversation.length, 1, 'son propre message ne revient pas');
    await chan.acceptFromPeer({ n_importe: 'quoi' });
    assert.equal(chan.conversation.length, 1);
});

test('discussion : la conversation n est publiee que si elle a change', async () => {
    let pushes = 0;
    const chan = new ChatChannel({
        relayUrl: '.',
        matchId: '1748100000000-AbCdEfGhIjKlMn',
        side: 1,
        onConversation: () => pushes++,
        fetchImpl: async () => ({ ok: true, headers: { get: () => '0' }, text: async () => '' }),
    });
    const msg = { v: 1, kind: KIND.CHAT, side: -1, at: 3, id: 'aa', quick: 'rematch' };
    await chan.acceptFromPeer(msg);
    await chan.acceptFromPeer(msg);
    await chan.acceptFromPeer(msg);
    assert.equal(pushes, 1, 'relire le meme fil ne doit pas faire clignoter la pastille');
});

test('hors ligne : la discussion ne peut pas se brancher sans le jeu a distance', () => {
    // `--offline` pose remotePlay:false, donc attachRelay() n'est jamais
    // appele, donc state.chat reste nul et le bouton reste masque. Ce test
    // garde l'invariant qui le rend vrai : la discussion n'est branchee QUE
    // depuis attachRelay. La brancher ailleurs — au demarrage d'une partie,
    // par exemple — ferait sortir une requete d'une application censee ne
    // jamais en emettre.
    const src = readFileSync(path.join(root, 'js/app.js'), 'utf8');
    const calls = src.match(/^\s*attachChat\(/gm) || [];
    assert.equal(calls.length, 1, 'attachChat doit etre appele une seule fois');
    const relayStart = src.indexOf('function attachRelay(');
    const relayEnd = src.indexOf('\nasync function leaveMatch', relayStart);
    const call = src.indexOf('    attachChat(');
    assert.ok(call > relayStart && call < relayEnd, 'attachChat doit vivre dans attachRelay');
});
