// Sceller le texte libre d'une discussion.
//
// ── Ce que cela protège, et de qui ──────────────────────────────────────────
//
// Le relai n'authentifie personne : ce qu'on y dépose est lisible par qui tient
// le serveur et par qui devine un identifiant de partie. Chiffrer avec une clé
// dérivée de cet identifiant ne protégerait rien — il est ENVOYÉ au serveur à
// chaque requête, c'est même la clé de stockage.
//
// Il faut donc un second secret qui ne parte jamais vers le relai. Celui-ci est
// tiré au hasard pour chaque partie et voyage dans le FRAGMENT du lien
// d'invitation, que le navigateur ne transmet jamais (voir buildInviteLink).
// Le relai ne voit que des octets opaques.
//
// ── Ce que cela ne protège pas, et qu'il faut savoir ────────────────────────
//
// Le serveur voit toujours qui écrit, quand, et combien. Et comme rien ne
// l'authentifie, quiconque connaît l'identifiant de partie peut ÉCRIRE dans le
// fil. Le sceau authentifie (AEAD), donc ce bruit sera rejeté à l'ouverture
// plutôt qu'affiché — c'est le bon comportement, mais ce n'est pas la même
// chose qu'empêcher d'écrire.
//
// Le lien, lui, porte la clé : qui l'intercepte lit la conversation. C'est le
// modèle de Tabulon, et c'est celui qui convient à deux joueurs qui
// s'échangent un lien par message ou par courriel — pas à un secret durable.
//
// ── Format : celui de Tabulon, à l'octet près ───────────────────────────────
//
//   clé     32 octets, écrits en hexadécimal minuscule (64 caractères)
//   sceau   base64 standard de (nonce[24] ‖ chiffré ‖ étiquette[16])
//   chiffre XChaCha20-Poly1305
//
// XCHACHA PLUTÔT QU'AES-GCM, et c'est la seule décision de conception de ce
// fichier. AES-GCM serait venu gratuitement avec `crypto.subtle` ; il aurait
// rendu les deux applications sourdes l'une à l'autre, alors qu'elles
// partagent déjà le lien d'invitation, l'enveloppe de partie et le relai. Le
// nonce de 192 bits est un bonus réel : tiré au hasard à chaque message, il
// n'oblige jamais à tenir un compteur persistant — impossible à garantir sur
// un téléphone, où le système tue l'application sans prévenir et où la partie
// peut reprendre sur un autre appareil.

import { xchacha20poly1305 } from '../vendor/noble-ciphers/chacha.js';

/** Longueur de la clé, en octets. */
export const KEY_BYTES = 32;

/** Longueur du nonce de XChaCha20-Poly1305, en octets. */
export const NONCE_BYTES = 24;

/** Forme d'une clé : 32 octets en hexadécimal minuscule. Sert à rejeter une
 *  valeur abîmée plutôt qu'à s'en servir — une clé à moitié valide ne protège
 *  rien et en donne l'apparence. */
export function isChatKey(value) {
    return typeof value === 'string' && new RegExp(`^[0-9a-f]{${KEY_BYTES * 2}}$`).test(value);
}

/** Forme d'une empreinte de trousseau Tabulon : 8 octets en hexadécimal. */
export function isChatKeyId(value) {
    return typeof value === 'string' && /^[0-9a-f]{16}$/.test(value);
}

/**
 * Une clé neuve.
 *
 * Pas de repli vers Math.random : une clé devinable est PIRE qu'une absence de
 * chiffrement, parce qu'elle en donne l'apparence. Mieux vaut échouer et
 * laisser l'appelant proposer une partie sans discussion protégée.
 */
export function generateChatKey(rand) {
    const bytes = new Uint8Array(KEY_BYTES);
    if (rand) rand(bytes);
    else if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function')
        crypto.getRandomValues(bytes);
    else throw new Error('chat-sealer: aucune source d’aléa sûre disponible');
    return toHex(bytes);
}

function toHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
}

// base64 standard, sans dépendre de Buffer : le même code doit tourner dans le
// navigateur et sous Node pour les tests.
function toBase64(bytes) {
    if (typeof btoa === 'function') {
        let s = '';
        for (const b of bytes) s += String.fromCharCode(b);
        return btoa(s);
    }
    return Buffer.from(bytes).toString('base64');
}

function fromBase64(text) {
    if (typeof atob === 'function') {
        const s = atob(text);
        const out = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
        return out;
    }
    return new Uint8Array(Buffer.from(text, 'base64'));
}

/**
 * Le scelleur d'une partie : ce que ChatChannel attend pour accepter d'envoyer
 * du texte libre.
 *
 * ASYNCHRONE alors que XChaCha ne l'exige pas. C'est voulu : `encodeThread` et
 * `decodeThread` attendent déjà un scelleur asynchrone, et une version
 * WebCrypto — si le format devait un jour changer — le serait forcément. Une
 * signature qui ne bouge pas évite de remonter des `await` dans tous les
 * appelants.
 *
 * `open` rend `null` plutôt que de lever : c'est ce que `decodeThread` attend,
 * un message qu'on ne peut pas ouvrir devant s'afficher verrouillé et non
 * faire disparaître la conversation.
 *
 * Toute erreur d'ouverture — base64 abîmé, message tronqué, sceau qui ne
 * correspond pas — rend la MÊME chose, sans dire laquelle. La distinction
 * n'aiderait que celui qui cherche à deviner la clé, et l'appelant, lui, n'en
 * ferait rien.
 */
export function makeSealer(key, { rand = null } = {}) {
    if (!isChatKey(key)) throw new Error('makeSealer: clé mal formée');
    const raw = fromHex(key);
    const nonce = () => {
        const n = new Uint8Array(NONCE_BYTES);
        if (rand) rand(n);
        else crypto.getRandomValues(n);
        return n;
    };
    return {
        key,
        async seal(text) {
            const n = nonce();
            const body = xchacha20poly1305(raw, n).encrypt(new TextEncoder().encode(String(text)));
            const framed = new Uint8Array(n.length + body.length);
            framed.set(n, 0);
            framed.set(body, n.length);
            return toBase64(framed);
        },
        async open(sealed) {
            try {
                const framed = fromBase64(String(sealed));
                // Un message plus court que nonce + étiquette ne peut pas être
                // valide : on refuse avant d'appeler le chiffre, qui lèverait
                // de toute façon.
                if (framed.length <= NONCE_BYTES) return null;
                const n = framed.slice(0, NONCE_BYTES);
                const body = framed.slice(NONCE_BYTES);
                return new TextDecoder().decode(xchacha20poly1305(raw, n).decrypt(body));
            } catch {
                return null;
            }
        },
    };
}
