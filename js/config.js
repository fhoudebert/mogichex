// Configuration de deploiement.
//
// Un seul dist jocly, coherent, construit en meme temps que l'application
// (etude §8.1) : distBase pointe vers ce dist et rien d'autre. Pas d'import
// d'extensions en v1 — c'est ce qui evite le scenario CubeGeometry/BoxGeometry.
//
// distBase n'est plus fige : il est RESOLU au demarrage par js/dist-locator.js
// parmi plusieurs emplacements, pour qu'un dist partage avec joclymatch soit
// trouve sans configuration. Le forcer reste possible via window.MOGICHEX_CONFIG.
//
// CONTRAINTE D'EMBARQUEMENT NATIF (decidee) : l'application doit pouvoir etre
// empaquetee telle quelle dans une coquille native (Capacitor, TWA). Deux
// regles en decoulent, a tenir dans tout le code :
//   1. TOUT ce qui est local est reference en RELATIF ('dist/…', 'lang/…').
//      Une seule URL absolue en dur et l'application casse sous capacitor://
//      ou https://localhost.
//   2. La seule URL absolue autorisee est celle du RELAI, et elle est
//      configurable a l'execution — parce que l'origine de l'application
//      native n'est pas celle du site, donc le relai devra de toute facon
//      autoriser cette origine en CORS (voir README § Hebergement).

const overrides = (typeof window !== 'undefined' && window.MOGICHEX_CONFIG) || {};

export const CONFIG = Object.assign(
    {
        // Base du dist jocly (jocly.js, games/, res/…). Renseignee au
        // demarrage par setDistBase() ; une valeur donnee ici ou dans
        // window.MOGICHEX_CONFIG court-circuite la recherche.
        distBase: null,
        // Racines supplementaires ou chercher le dist, pour une disposition
        // que la liste par defaut ne couvre pas. Chacune est essayee telle
        // quelle ET suivie de browser/ (voir js/dist-locator.js). Ces racines
        // passent AVANT celles par defaut.
        distRoots: [],
        // Fichier produit par tools/build-catalog.mjs.
        catalogUrl: 'app/catalog.json',
        // Relai HTTP (signal.php / match.php). null = a chercher au moment de
        // proposer une partie a distance, parmi relayRoots. Une valeur donnee
        // ici ou dans window.MOGICHEX_CONFIG court-circuite la recherche —
        // c'est ce qu'il faudra faire dans une coquille NATIVE, dont l'origine
        // n'est pas celle du site et pour qui « . » ne veut rien dire.
        relayUrl: null,
        // Jeu a distance. Le passer a false retire l'adversaire « un autre
        // joueur par Internet » : plus de choix dans la liste, plus de
        // recherche de relai, plus une seule requete sortante. C'est ce qu'il
        // faut pour une application Android qui doit rester HORS LIGNE —
        // tools/build-android.mjs --offline le pose pour vous.
        remotePlay: true,
        // Emplacements ou chercher le relai, avant ceux par defaut.
        // Defauts : « . » (le relai chez mogichex, meme origine donc aucun
        // CORS) puis « ../joclymatch ».
        relayRoots: [],
        storagePrefix: 'mogichex.',
    },
    overrides
);

/**
 * Ramene un mode de jeu a ce que la configuration autorise.
 * Une preference memorisee peut valoir « remote » alors que le jeu a
 * distance vient d'etre desactive : sans ce garde-fou, l'application
 * chercherait un relai qui n'existe pas et l'ecran resterait bloque.
 */
export function allowedMode(mode) {
    if (mode === 'remote' && !CONFIG.remotePlay) return 'ai';
    return mode === 'human' || mode === 'remote' ? mode : 'ai';
}

export function setRelayUrl(url) {
    CONFIG.relayUrl = url;
}

/** Vrai si l'emplacement du relai a ete impose (pas de recherche). */
export function relayUrlIsForced() {
    return !!overrides.relayUrl;
}

/** Vrai si l'emplacement du dist a ete impose (config figee, pas de recherche). */
export function distBaseIsForced() {
    return !!overrides.distBase;
}

export function setDistBase(base) {
    CONFIG.distBase = base;
}

export function distUrl(rest) {
    const base = CONFIG.distBase || 'dist/';
    return base.replace(/\/+$/, '') + '/' + String(rest).replace(/^\//, '');
}

/** Chemin d'une ressource de jeu (vignette, regles) : <dist>/games/<module>/<rel>. */
export function gameAssetUrl(module, rel) {
    return distUrl('games/' + module + '/' + String(rel).replace(/^\//, ''));
}
