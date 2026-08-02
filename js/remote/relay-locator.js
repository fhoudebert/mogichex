// Localisation du relai (signal.php / match.php).
//
// Meme demarche que pour le dist (js/dist-locator.js) : plusieurs
// emplacements plausibles, essayes dans l'ordre, valides par la SIGNATURE de
// la reponse et non par son code HTTP — le .htaccess livre renvoie index.html
// pour toute URL sans fichier correspondant, donc un emplacement absent
// repondrait 200 avec la page de l'application.
//
// Deux emplacements couvrent le deploiement reel :
//
//   .                le relai dans le repertoire de mogichex lui-meme
//                    -> https://biscandine.fr/variantes/mogichex/
//                    C'est le defaut recommande : meme origine, donc AUCUN
//                    CORS a configurer, et les fichiers de partie de mogichex
//                    restent chez mogichex.
//   ../joclymatch    le relai depose a cote de joclymatch
//                    -> https://biscandine.fr/variantes/joclymatch/
//
// La recherche est PARESSEUSE : elle n'a lieu qu'au moment de proposer une
// partie a distance. Quelqu'un qui ne joue que contre l'ordinateur ne paie
// jamais cette requete.

export const RELAY_ROOTS = ['.', '../joclymatch'];

// Un identifiant volontairement invalide : match.php le refuse par son motif
// avant de toucher au disque, donc la sonde ne cree aucun fichier et ne
// modifie aucune partie. La reponse attendue est un JSON portant `error`,
// que ni une page HTML ni un 404 d'hebergeur ne peut imiter.
const PROBE_ID = 'x';

export function normalizeRelay(base) {
    return String(base).replace(/\/+$/, '') || '.';
}

export function orderedRelays(remembered, roots = RELAY_ROOTS) {
    const list = roots.map(normalizeRelay);
    const first = remembered ? normalizeRelay(remembered) : null;
    if (!first) return list;
    return [first, ...list.filter((r) => r !== first)];
}

/** Vrai si la reponse vient bien de match.php et non d'une page de repli. */
export function looksLikeRelay(body) {
    return !!(body && typeof body === 'object' && typeof body.error === 'string');
}

/**
 * Cherche le relai et rend sa base (sans barre finale), ou null.
 * @param {{fetchImpl?:Function, roots?:string[], remembered?:string}} opts
 */
export async function locateRelay(opts = {}) {
    const doFetch = opts.fetchImpl || ((u, i) => fetch(u, i));
    const tried = [];
    for (const base of orderedRelays(opts.remembered, opts.roots)) {
        try {
            const res = await doFetch(base + '/match.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ action: 'load', mid: PROBE_ID }).toString(),
            });
            // On ne regarde PAS res.ok : match.php repond 400 a la sonde, et
            // c'est justement la bonne reponse.
            let body = null;
            try {
                body = await res.json();
            } catch {
                tried.push(base + ' (reponse non JSON)');
                continue;
            }
            if (looksLikeRelay(body)) return { base, tried };
            tried.push(base + ' (JSON inattendu)');
        } catch (err) {
            tried.push(base + ' (' + err.message + ')');
        }
    }
    return { base: null, tried };
}
