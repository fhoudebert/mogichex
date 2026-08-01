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
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCatalog, buildEntry, normalizeLocalized, pick2dSkin } from '../tools/lib/catalog.mjs';
import { pickLocalized, preferredLocale, configure, t } from '../js/i18n.js';
import { filterGames, groupByModule, initialCollapsed, normalize, searchableText } from '../js/catalog.js';
import { classify } from '../js/device.js';
import { isAbortError } from '../js/game.js';
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

test('initialCollapsed : gros module replie, mais tout deroule pendant une recherche', () => {
    const big = { module: 'chessbase', games: new Array(81).fill({}) };
    const small = { module: 'margo', games: new Array(7).fill({}) };
    assert.deepEqual([...initialCollapsed([big, small])], ['chessbase']);
    assert.equal(initialCollapsed([big, small], { searching: true }).size, 0);
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

// ---------------------------------------------------------------- coherence

test('lang/ : chaque locale declaree a son fichier, et le JSON est valide', () => {
    const index = JSON.parse(readFileSync(path.join(root, 'lang', 'index.json'), 'utf8'));
    for (const loc of index.locales) {
        const f = path.join(root, 'lang', loc.code + '.json');
        assert.ok(existsSync(f), 'fichier manquant : ' + f);
        JSON.parse(readFileSync(f, 'utf8'));
    }
    assert.ok(index.locales.some((l) => l.code === index.fallback));
});

test('manifest : chaque icone declaree existe sur le disque', () => {
    // Une icone manquante ne casse rien de visible en developpement, mais
    // l'invite d'installation PWA peut ne jamais apparaitre sur mobile.
    const man = JSON.parse(readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
    for (const icon of man.icons) {
        assert.ok(existsSync(path.join(root, icon.src)), 'icone manquante : ' + icon.src);
    }
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
