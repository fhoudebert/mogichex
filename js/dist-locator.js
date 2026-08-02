// Localisation du dist Jocly.
//
// Le dist n'est pas toujours DANS mogichex. Pour un deploiement a cote de
// joclymatch, il est commode de le partager : un seul dist sur l'hebergement,
// deux applications qui s'en servent. On cherche donc plusieurs emplacements,
// combinaison de deux dimensions :
//
//   RACINES    dist/       embarque dans mogichex (developpement, ou copie)
//              ../dist/    au meme niveau que mogichex
//              jocly/dist/       un checkout jocly dans mogichex
//              ../jocly/dist/    un checkout jocly a cote de mogichex
//   SUFFIXES   <rien>  puis  browser/
//
// Le suffixe « browser » n'est pas un raffinement : `npx gulp build` dans
// jocly2 produit dist/browser/ ET dist/node/, et c'est browser/ qui contient
// jocly.js. Un checkout jocly deploye TEL QUEL a donc son moteur un cran plus
// bas. Cas reel qui a mis ce manque en evidence :
//
//   variantes/jocly/dist/browser   <- le moteur est ICI
//   variantes/joclymatch
//   variantes/mogichex             <- donc ../jocly/dist/browser/
//
// Aplatir ce niveau cote serveur obligerait a dupliquer le dist : c'est a
// mogichex de savoir descendre d'un cran.
//
// PIEGE : on ne peut PAS se contenter du code HTTP. Le .htaccess livre
// renvoie index.html pour toute URL qui ne correspond a aucun fichier (regle
// mono-page) : sonder un emplacement absent rend alors 200 avec la page de
// l'application, et le premier candidat gagnerait toujours. On verifie donc la
// SIGNATURE du contenu, pas le statut.

export const DIST_ROOTS = ['dist', '../dist', 'jocly/dist', '../jocly/dist'];
export const DIST_SUBDIRS = ['', 'browser'];

// jocly.js declare `var Jocly = ...` et installe BrowserScriptLoader : deux
// marqueurs qu'aucune page HTML de l'application ne contient.
const SIGNATURE = /BrowserScriptLoader/;

/** Normalise un candidat en base terminee par « / » (sans double barre). */
export function normalizeBase(base) {
    return String(base).replace(/\/+$/, '') + '/';
}

/**
 * Developpe racines x suffixes. Les deux formes d'une meme racine sont
 * essayees a la SUITE : si une racine existe, c'est la qu'est le dist, autant
 * y regarder tout de suite plutot que de balayer toutes les racines d'abord.
 */
export function expandCandidates(roots = DIST_ROOTS, subdirs = DIST_SUBDIRS) {
    const out = [];
    for (const root of roots) {
        for (const sub of subdirs) {
            out.push(sub ? normalizeBase(normalizeBase(root) + sub) : normalizeBase(root));
        }
    }
    return out;
}

export const DIST_CANDIDATES = expandCandidates();

/**
 * Ordre d'essai : l'emplacement retenu la derniere fois d'abord, puis les
 * autres. Pur, donc testable. Un emplacement memorise mais devenu invalide ne
 * bloque rien : il echoue a la signature et on poursuit la liste.
 */
export function orderedCandidates(remembered, candidates = DIST_CANDIDATES) {
    const list = candidates.map(normalizeBase);
    const first = remembered ? normalizeBase(remembered) : null;
    if (!first) return list;
    return [first, ...list.filter((c) => c !== first)];
}

/** Vrai si le corps recu est bien jocly.js et non la page de repli. */
export function looksLikeJocly(text) {
    return typeof text === 'string' && SIGNATURE.test(text);
}

/**
 * Cherche le dist et rend sa base (terminee par « / »), ou null.
 * @param {{fetchImpl?:Function, candidates?:string[], remembered?:string}} opts
 */
export async function locateDist(opts = {}) {
    const doFetch = opts.fetchImpl || ((u) => fetch(u));
    const tried = [];
    for (const base of orderedCandidates(opts.remembered, opts.candidates)) {
        try {
            const res = await doFetch(base + 'jocly.js');
            if (!res || !res.ok) {
                tried.push(base + ' (' + (res ? res.status : 'echec') + ')');
                continue;
            }
            const text = await res.text();
            if (looksLikeJocly(text)) return { base, tried };
            // 200 mais ce n'est pas jocly : typiquement la page de repli
            // mono-page servie par le .htaccess.
            tried.push(base + ' (contenu non reconnu)');
        } catch (err) {
            tried.push(base + ' (' + err.message + ')');
        }
    }
    return { base: null, tried };
}
