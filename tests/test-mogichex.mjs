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
