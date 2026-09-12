// Selection et groupement des jeux — logique pure, testee sous Node.

import { pickLocalized } from './i18n.js';

function allTranslations(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value !== 'object') return String(value);
    return Object.values(value).filter((v) => typeof v === 'string').join(' ');
}

/**
 * Texte de recherche d'un jeu. On indexe TOUTES les traductions disponibles,
 * pas seulement la langue affichee : un francophone dont l'interface est en
 * anglais cherche « echecs » et doit trouver Chess. Ne rien trouver alors que
 * le jeu existe est la pire des reponses.
 * Rend toujours une chaine (un objet qui fuit casse .toLowerCase()).
 */
export function searchableText(game) {
    return [allTranslations(game.title), allTranslations(game.summary), game.name]
        .join(' ')
        .toLowerCase();
}

export function normalize(s) {
    // Recherche insensible aux accents : « echecs » doit trouver « Échecs ».
    return String(s)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

/**
 * @param {Array} games catalogue complet
 * @param {{query?:string, tier?:'phone'|'tablet', showAll?:boolean,
 *          showObsolete?:boolean, locale?:string}} opts
 */
export function filterGames(games, opts = {}) {
    const { query = '', tier = 'phone', showAll = false, showObsolete = false, locale = 'en' } = opts;
    const q = normalize(query.trim());
    return games.filter((g) => {
        if (g.obsolete && !showObsolete) return false;
        // tier 'tablet' sur un jeu = « demande un grand ecran ». Un telephone
        // ne le montre que si l'utilisateur a demande a tout voir.
        if (!showAll && tier === 'phone' && g.tier === 'tablet') return false;
        if (!q) return true;
        return normalize(searchableText(g)).includes(q);
    });
}

/** Groupe par module, modules tries, jeux tries par titre localise. */
export function groupByModule(games, locale = 'en') {
    const map = new Map();
    for (const g of games) {
        if (!map.has(g.module)) map.set(g.module, []);
        map.get(g.module).push(g);
    }
    const collator = new Intl.Collator(locale, { sensitivity: 'base' });
    return [...map.entries()]
        .map(([module, list]) => ({
            module,
            games: list.slice().sort((a, b) =>
                collator.compare(pickLocalized(a.title, locale), pickLocalized(b.title, locale))
            ),
        }))
        .sort((a, b) => collator.compare(a.module, b.module));
}

/**
 * Sections repliees par defaut : TOUTES.
 *
 * La liste compte 12 modules et jusqu'a 116 jeux. Deroulee, elle oblige a
 * faire defiler longuement avant d'apercevoir checkers, tafl ou margo, que
 * chessbase enterre a lui seul. Tout replier donne d'emblee la carte des
 * familles disponibles ; un module s'ouvre d'un doigt.
 *
 * Exception : pendant une recherche, tout est deroule — sinon on afficherait
 * des sections fermees sur des resultats qu'on vient justement de demander.
 */
export function initialCollapsed(groups, { searching = false } = {}) {
    const set = new Set();
    if (searching) return set;
    // Les favoris font exception, et c'est tout leur interet : les modules
    // sont replies pour donner la carte des familles, les favoris sont ouverts
    // pour donner les jeux. Une section de favoris repliee ne ferait gagner
    // aucun geste par rapport a chercher le jeu dans son module.
    for (const g of groups) if (!g.favorite) set.add(g.module);
    return set;
}
