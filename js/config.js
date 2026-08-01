// Configuration de deploiement.
//
// Un seul dist jocly, coherent, construit en meme temps que l'application
// (etude §8.1) : distBase pointe vers ce dist et rien d'autre. Pas d'import
// d'extensions en v1 — c'est ce qui evite le scenario CubeGeometry/BoxGeometry.
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
        // Racine du dist jocly (jocly.js, games/, res/…), relative a l'app.
        // C'est dist/browser d'un checkout jocly2, pas dist/.
        distBase: 'dist',
        // Fichier produit par tools/build-catalog.mjs.
        catalogUrl: 'app/catalog.json',
        // Relai HTTP : signalisation WebRTC ET transport de repli (etape 5).
        // Vide = jeu solo uniquement. Voir README § Hebergement.
        relayUrl: '',
        storagePrefix: 'mogichex.',
    },
    overrides
);

export function distUrl(rest) {
    return CONFIG.distBase.replace(/\/$/, '') + '/' + String(rest).replace(/^\//, '');
}

/** Chemin d'une ressource de jeu (vignette, regles) : <dist>/games/<module>/<rel>. */
export function gameAssetUrl(module, rel) {
    return distUrl('games/' + module + '/' + String(rel).replace(/^\//, ''));
}
