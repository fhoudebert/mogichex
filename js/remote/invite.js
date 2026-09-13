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
 *
 * LA CLE DE DISCUSSION VA DANS LE FRAGMENT, jamais dans la requete. Le
 * fragment n'est pas transmis au serveur : ni celui qui heberge la page, ni le
 * relai, ni un journal d'acces, ni un en-tete Referer ne le voient. Mise en
 * parametre, la cle arriverait dans les journaux du premier serveur venu et la
 * discussion serait protegee pour tout le monde sauf pour celui qui est le
 * mieux place pour la lire. Meme choix que Tabulon, et meme nom de champ.
 *
 * @param {{game:string, matchId:string, side:'a'|'b', locale?:string,
 *          base?:string, chatKey?:string}} o
 */
export function buildInviteLink(o) {
    const base = o.base === undefined ? 'index.html' : o.base;
    const q = new URLSearchParams();
    q.set('game', o.game);
    q.set('mid', o.matchId);
    q.set('player', o.side);
    if (o.locale) q.set('lg', o.locale);
    let link = base + '?' + q.toString();
    // Une cle mal formee est IGNOREE plutot que collee telle quelle : un lien
    // qui promet une discussion protegee sans pouvoir la tenir est pire qu'un
    // lien sans cle, ou le manque se voit.
    if (CHAT_KEY_RE.test(String(o.chatKey || ''))) link += '#k=' + o.chatKey;
    return link;
}

/**
 * Cette adresse peut-elle servir de base a un lien d'invitation ?
 *
 * LE PIEGE DE LA COQUILLE NATIVE. Sous Capacitor, l'application est servie
 * depuis `https://localhost` — une origine parfaitement valide, securisee, et
 * qui ne designe RIEN chez le destinataire. Construire le lien depuis
 * `location.href`, ce qui est juste sur le web, produit donc la un
 * `https://localhost/?game=…` qui n'ouvre rien chez personne. Et il echoue en
 * silence : le lien a l'air normal, il se copie, il s'envoie, et c'est
 * l'invite qui decouvre le probleme.
 *
 * ON NE REFUSE QUE LES ORIGINES D'APPLICATION EMPAQUETEE : les schemas
 * `capacitor:`, `file:`, `content:`, les ressources `android_asset`, et
 * `https://localhost` SANS PORT — qui est exactement ce que sert le WebView
 * Android de Capacitor.
 *
 * Un serveur de developpement, lui, passe : `http://127.0.0.1:8080` ou
 * `http://localhost:8080` servent parfaitement a faire jouer deux navigateurs
 * de la meme machine, et c'est ainsi que les sondes de ce depot travaillent.
 * Une adresse de reseau local passe pour la meme raison : deux appareils de la
 * meme maison n'ont pas besoin d'Internet. Le port est le discriminant, parce
 * qu'une coquille native n'en a jamais et qu'un serveur local en a toujours un.
 */
export function isShareableBase(url) {
    const text = String(url || '');
    if (!text) return false;
    if (/^(capacitor|file|content|chrome-extension):/i.test(text)) return false;
    if (text.includes('android_asset')) return false;
    let u;
    try {
        u = new URL(text, 'https://relatif.invalid/');
    } catch {
        return false;
    }
    if (u.hostname === 'relatif.invalid') return false; // adresse relative : rien a partager
    const local =
        u.hostname === 'localhost' ||
        u.hostname.endsWith('.localhost') ||
        u.hostname === '127.0.0.1' ||
        u.hostname === '[::1]';
    // `https://localhost` sans port : la coquille Capacitor, et elle seule.
    if (local && u.protocol === 'https:' && !u.port) return false;
    return true;
}

/**
 * L'adresse a mettre dans un lien d'invitation, ou null s'il n'y en a pas.
 *
 * Trois etages, du plus sur au plus deduit :
 *
 *   1. l'adresse CONFIGUREE (`CONFIG.inviteBase`). Autorite absolue, et c'est
 *      ce que pose tools/build-android.mjs ;
 *   2. l'adresse de la PAGE, si elle n'est pas celle d'une coquille
 *      empaquetee. C'est le cas du web, et le comportement d'origine ;
 *   3. l'adresse du RELAI, si elle est absolue. C'est une deduction, mais une
 *      deduction raisonnable : dans le deploiement de reference le relai vit
 *      DANS le repertoire de mogichex (« . » est sa premiere racine), donc son
 *      adresse est celle de l'application. Au pire elle designe le joclymatch
 *      voisin — qui lit le meme format de lien et parle au meme relai, donc
 *      l'invite joue quand meme.
 *
 * Fonction PURE, pour que les trois etages se testent sans navigateur : c'est
 * justement le cas qu'on ne peut pas simuler ailleurs, l'origine d'une
 * coquille native n'etant pas quelque chose qu'une page peut se donner.
 */
export function inviteBaseFrom({ configured = null, page = '', relay = '' } = {}) {
    if (configured) return String(configured);
    const clean = String(page).split('#')[0].split('?')[0];
    if (isShareableBase(clean)) return clean;
    const r = String(relay || '');
    if (/^https?:/i.test(r) && isShareableBase(r)) return r.replace(/\/+$/, '') + '/index.html';
    return null;
}

/** Forme d'une cle de discussion : 32 octets en hexadecimal minuscule.
 *  Duplique ici — et non importe de chat-sealer.js — pour que ce module reste
 *  PUR et sans dependance : c'est ce qui permet a joclymatch ou a un script de
 *  lire un lien sans embarquer de chiffre. */
export const CHAT_KEY_RE = /^[0-9a-f]{64}$/;
const CHAT_KEY_ID_RE = /^[0-9a-f]{16}$/;

/**
 * Lit un lien d'invitation, qu'il vienne de mogichex ou de joclymatch, qu'il
 * soit absolu ou reduit a sa chaine de requete. Rend null si ce n'est pas une
 * invitation exploitable — un lien tronque par un copier-coller ne doit pas
 * lancer une partie sur des valeurs partielles.
 *
 * @returns {{game:string, matchId:string, side:'a'|'b', locale:string|null,
 *            chatKey:string|null, chatKeyId:string|null,
 *            origin:'mogichex'|'joclymatch'|'unknown'}|null}
 */
export function parseInviteLink(text) {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed) return null;

    const qIndex = trimmed.indexOf('?');
    const query = qIndex >= 0 ? trimmed.slice(qIndex + 1) : trimmed;
    const path = qIndex >= 0 ? trimmed.slice(0, qIndex) : '';
    const hashIndex = query.indexOf('#');
    const fragment = hashIndex >= 0 ? query.slice(hashIndex + 1) : '';
    let params;
    let hash;
    try {
        params = new URLSearchParams(query.slice(0, hashIndex >= 0 ? hashIndex : undefined));
        hash = new URLSearchParams(fragment);
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

    // Une invitation porte l'un OU l'autre, jamais les deux : une cle tiree au
    // hasard (adversaire inconnu), ou l'empreinte du trousseau a employer
    // (Tabulon, adversaire de la meme communaute). mogichex ne gere pas de
    // trousseau ; il lit quand meme l'empreinte, pour pouvoir DIRE que cette
    // invitation attend une cle qu'il n'a pas, plutot que d'afficher une
    // discussion muette sans explication.
    const k = hash.get('k');
    const kid = hash.get('kid');
    return {
        game,
        matchId,
        side,
        locale: params.get('lg'),
        chatKey: CHAT_KEY_RE.test(k || '') ? k : null,
        chatKeyId: CHAT_KEY_ID_RE.test(kid || '') ? kid : null,
        origin,
    };
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
