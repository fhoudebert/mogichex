// Invitations — format de joclymatch.
//
// Un lien joclymatch a cette forme :
//
//   <racine>/index.php?game=<jeu>&mid=<horodatage>-<14 caracteres>&player=a|b
//
// mogichex reprend EXACTEMENT les memes parametres, sur sa propre page :
//
//   <racine>/index.html?game=<jeu>&mid=<...>&player=a|b[&lg=fr]
//
// Consequence voulue : un lien produit par l'une des deux applications est
// lisible par l'autre. Coller un lien joclymatch dans mogichex donne le bon
// jeu, la bonne partie et le bon camp — seul le fichier de partie differe
// (mogichex a le sien, a cote de signal.php).
//
// Tout ce module est PUR : aucune dependance au DOM ni au reseau.

// Meme alphabet que makeid() de joclymatch.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 14;

// Un identifiant de partie devient un nom de fichier cote serveur : le motif
// est verifie des la lecture du lien, pas seulement en PHP. Refuser tot evite
// d'envoyer une requete qui sera de toute facon rejetee.
export const MATCH_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

/**
 * Tirage uniforme dans l'alphabet. On REJETTE les valeurs hautes plutot que
 * de prendre un modulo : 256 n'est pas un multiple de 62, et le modulo
 * favoriserait les premiers caracteres. Meme correction que celle deja
 * apportee a makeid() de joclymatch.
 */
export function makeId(length = ID_LENGTH, randomBytes) {
    const n = ALPHABET.length;
    const limit = 256 - (256 % n); // 248 : au-dela, on retire
    const gen =
        randomBytes ||
        ((k) => {
            const buf = new Uint8Array(k);
            if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
            else for (let i = 0; i < k; i++) buf[i] = Math.floor(Math.random() * 256);
            return buf;
        });
    let out = '';
    while (out.length < length) {
        for (const b of gen(length * 2)) {
            if (b >= limit) continue;
            out += ALPHABET[b % n];
            if (out.length === length) break;
        }
    }
    return out;
}

/** Identifiant de partie au format joclymatch : <horodatage>-<14 caracteres>. */
export function newMatchId(now = Date.now(), randomBytes) {
    return now + '-' + makeId(ID_LENGTH, randomBytes);
}

/** 'a' | 'b' -> le camp adverse. Toute autre valeur rend null. */
export function otherSide(side) {
    if (side === 'a') return 'b';
    if (side === 'b') return 'a';
    return null;
}

/**
 * Construit un lien d'invitation.
 * @param {{game:string, matchId:string, side:'a'|'b', locale?:string, base?:string}} o
 */
export function buildInviteLink(o) {
    const base = o.base === undefined ? 'index.html' : o.base;
    const q = new URLSearchParams();
    q.set('game', o.game);
    q.set('mid', o.matchId);
    q.set('player', o.side);
    if (o.locale) q.set('lg', o.locale);
    return base + '?' + q.toString();
}

/**
 * Lit un lien d'invitation, qu'il vienne de mogichex ou de joclymatch, qu'il
 * soit absolu ou reduit a sa chaine de requete. Rend null si ce n'est pas une
 * invitation exploitable — un lien tronque par un copier-coller ne doit pas
 * lancer une partie sur des valeurs partielles.
 *
 * @returns {{game:string, matchId:string, side:'a'|'b', locale:string|null,
 *            origin:'mogichex'|'joclymatch'|'unknown'}|null}
 */
export function parseInviteLink(text) {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed) return null;

    const qIndex = trimmed.indexOf('?');
    const query = qIndex >= 0 ? trimmed.slice(qIndex + 1) : trimmed;
    const path = qIndex >= 0 ? trimmed.slice(0, qIndex) : '';
    let params;
    try {
        params = new URLSearchParams(query.split('#')[0]);
    } catch {
        return null;
    }

    const game = params.get('game');
    const matchId = params.get('mid');
    const player = params.get('player');
    if (!game || !matchId) return null;
    if (!MATCH_ID_RE.test(matchId)) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(game)) return null;

    // Le camp est facultatif dans un lien : joclymatch en produit un par
    // camp, mais on tolere un lien sans « player » — le joueur choisira.
    const side = player === 'a' || player === 'b' ? player : null;

    let origin = 'unknown';
    if (/index\.php$/i.test(path)) origin = 'joclymatch';
    else if (/index\.html?$/i.test(path) || path === '') origin = 'mogichex';

    return { game, matchId, side, locale: params.get('lg'), origin };
}

/**
 * Enveloppe de partie, format joclymatch.
 * `matchdata` est le resultat de match.save() : l'etat complet, indispensable
 * — publier seulement le dernier coup ne permet pas a l'autre camp de
 * rattraper une partie commencee.
 */
export function buildEnvelope({ matchDetails, matchdata, now = Date.now(), key }) {
    return {
        matchDetails,
        matchdata,
        time: now,
        key: key || makeId(8),
    };
}

/** Vrai si l'objet recu est une enveloppe exploitable (et non {} ou un debris). */
export function isUsableEnvelope(env) {
    return !!(
        env &&
        typeof env === 'object' &&
        env.matchDetails &&
        typeof env.matchDetails === 'object' &&
        env.matchdata
    );
}
