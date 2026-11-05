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

/**
 * Nom d'affichage des modules.
 *
 * POURQUOI UNE TABLE PLUTOT QUE LE CAPITALIZE DU CSS. Les identifiants de
 * modules sont des mots-valises — `fourinarow`, `pensoc` — que
 * `text-transform: capitalize` rendait « Fourinarow » et « Pensoc » : lisibles
 * par qui connait deja jocly, opaques pour les autres. Et une fois traduits,
 * le capitalize devenait nuisible, transformant « Puissance 4 » en « Puissance
 * 4 » mais « Four in a row » en « Four In A Row ». Les libelles sont donc
 * ecrits ici tels qu'ils doivent apparaitre, et le CSS ne touche plus a la
 * casse.
 *
 * Les valeurs sont les libelles ANGLAIS, donc les cles de traduction, comme
 * partout ailleurs dans ce projet. Ce qui n'a pas de traduction francaise
 * s'affiche en anglais — c'est le cas des noms propres (Tafl, Margo, Mana,
 * Yohoho, Go), qui ne se traduisent pas.
 */
export const MODULE_LABELS = {
    checkers: 'Checkers',
    chessbase: 'Chessbase',
    fourinarow: 'Four in a row',
    go: 'Go',
    hunt: 'Hunt',
    mana: 'Mana',
    margo: 'Margo',
    mills: 'Mills',
    pensoc: 'Penguin soccer',
    reversi: 'Reversi',
    scrum: 'Scrum',
    tafl: 'Tafl',
    yohoho: 'Yohoho',
};

/**
 * Le nom a afficher pour un module.
 *
 * Un module inconnu — jocly en gagne — rend son identifiant avec une majuscule
 * initiale : moche, mais jamais vide, et jamais « FOURINAROW ». C'est le meme
 * principe que le repli des titres de jeux.
 *
 * @param {string} module
 * @param {Function} [t] traduction ; sans elle, le libelle anglais
 */
export function moduleLabel(module, t = (x) => x) {
    const name = String(module || '');
    const label = MODULE_LABELS[name] || (name ? name[0].toUpperCase() + name.slice(1) : '');
    return t(label);
}

/** Groupe par module, modules tries, jeux tries par titre localise. */
export function groupByModule(games, locale = 'en', t = null) {
    const map = new Map();
    for (const g of games) {
        if (!map.has(g.module)) map.set(g.module, []);
        map.get(g.module).push(g);
    }
    const collator = new Intl.Collator(locale, { sensitivity: 'base' });
    // TRI SUR LE LIBELLE AFFICHE, pas sur l'identifiant. Les jeux d'un module
    // sont deja ranges par titre localise ; ranger les modules par identifiant
    // donnait, en francais, « Dames, Echecs, Puissance 4, Go, Chasse… » —
    // l'ordre alphabetique d'une langue que l'utilisateur ne voit pas. Sans
    // `t`, le libelle anglais sert de cle, ce qui redonne l'ordre d'avant pour
    // les modules dont le libelle est l'identifiant capitalise.
    const cle = (module) => (t ? moduleLabel(module, t) : moduleLabel(module));
    return [...map.entries()]
        .map(([module, list]) => ({
            module,
            games: list.slice().sort((a, b) =>
                collator.compare(pickLocalized(a.title, locale), pickLocalized(b.title, locale))
            ),
        }))
        .sort((a, b) => collator.compare(cle(a.module), cle(b.module)));
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
