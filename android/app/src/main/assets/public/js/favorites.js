// Favoris — une liste d'identifiants de jeux. Logique PURE, testee sous Node.
//
// POURQUOI UNE SECTION ET PAS UN FILTRE. Un filtre « favoris seulement »
// remplacerait la liste, donc obligerait a le desactiver pour retrouver le
// reste — un aller-retour a chaque fois qu'on hesite. Une section epinglee en
// tete laisse les douze modules en place : les favoris sont a portee de pouce
// et le catalogue n'a pas bouge.
//
// Elle est la SEULE section deroulee par defaut, et c'est tout son interet :
// les modules sont replies pour donner la carte des familles, les favoris sont
// ouverts pour donner les jeux. Une section de favoris repliee ne ferait
// gagner aucun geste par rapport a chercher le jeu dans son module.

/** Cle de preference (prefixee par CONFIG.storagePrefix a l'ecriture). */
export const FAV_KEY = 'favorites';

/** Nom de module reserve a la section. Ce n'est pas un module de jocly : il ne
 *  peut donc jamais entrer en collision avec un vrai nom, et catalog-view le
 *  reconnait pour afficher un libelle traduit plutot que le nom brut. */
export const FAV_MODULE = '\u2605';

/** Une liste de favoris propre : des chaines, sans doublon, sans vide. */
export function sanitizeFavorites(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const name of list) {
        if (typeof name !== 'string' || !name) continue;
        if (seen.has(name)) continue;
        seen.add(name);
        out.push(name);
    }
    return out;
}

export function isFavorite(list, name) {
    return sanitizeFavorites(list).indexOf(name) >= 0;
}

/**
 * Ajoute ou retire. Rend une NOUVELLE liste : l'appelant compare l'ancienne
 * et la nouvelle pour savoir s'il doit ecrire dans le stockage.
 */
export function toggleFavorite(list, name) {
    const clean = sanitizeFavorites(list);
    if (!name) return clean;
    const at = clean.indexOf(name);
    if (at >= 0) return clean.slice(0, at).concat(clean.slice(at + 1));
    return clean.concat([name]);
}

/**
 * La section des favoris, a partir des jeux DEJA filtres.
 *
 * On part des jeux filtres et non du catalogue entier : sans cela, une
 * recherche qui ne rend rien afficherait quand meme les favoris, et le filtre
 * « adaptes a cet ecran » se retrouverait contredit par sa propre section
 * epinglee. Un favori exclu par le filtre reste accessible en le desactivant,
 * exactement comme les autres jeux.
 *
 * Rend null quand il n'y a rien a montrer — une section vide intitulee
 * « Favoris » n'apprend rien et occupe une ligne.
 *
 * L'ordre est celui dans lequel les jeux ont ete marques, pas l'alphabet :
 * c'est un classement que l'utilisateur a fait lui-meme, on ne le defait pas.
 */
export function favoriteGroup(filteredGames, list) {
    const names = sanitizeFavorites(list);
    if (!names.length) return null;
    const byName = new Map(filteredGames.map((g) => [g.name, g]));
    const games = names.map((n) => byName.get(n)).filter(Boolean);
    if (!games.length) return null;
    return { module: FAV_MODULE, favorite: true, games };
}
