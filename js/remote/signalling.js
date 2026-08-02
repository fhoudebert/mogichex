// Signalisation WebRTC — decisions PURES, sans reseau ni navigateur.
//
// POURQUOI WebRTC alors que le relai fonctionne deja.
//
// Ce n'est pas la latence : au tour par tour, l'attente longue de match.php
// livre un coup en quelques centaines de millisecondes, ce qui ne se voit pas.
// La vraie raison est le COUT SUR L'HEBERGEMENT MUTUALISE : chaque joueur en
// attente immobilise un processus PHP pendant 20 secondes, en boucle, tant
// que dure la partie. Deux joueurs qui reflechissent longuement, ce sont deux
// processus occupes en permanence — et un mutualise en compte peu.
//
// Une fois le canal pair-a-pair ouvert, on ARRETE l'attente longue : le relai
// n'est plus sollicite que par une ecriture breve apres chaque coup, pour que
// rechargement et reprise restent possibles. Si le canal tombe, l'attente
// longue reprend. Le relai reste donc la reference ; WebRTC n'est qu'un
// raccourci qu'on peut perdre sans rien casser.

/**
 * Qui emet l'offre. Il faut un ordre stable et connu des deux cotes AVANT
 * tout echange, sinon les deux pairs offrent en meme temps et aucune des deux
 * negociations n'aboutit (« glare »). Le camp est deja porte par le lien
 * d'invitation : on s'en sert.
 */
export function isOfferer(side) {
    return side === 'a';
}

/** Boite ou l'on ECRIT, et boite ou l'on LIT. Jamais la meme. */
export function boxesFor(side) {
    return side === 'a' ? { mine: 'a', theirs: 'b' } : { mine: 'b', theirs: 'a' };
}

/** Enveloppe de signalisation. Un seul type par message, jamais de melange. */
export function signalMessage(type, payload) {
    return { t: type, p: payload };
}

/**
 * Trie et filtre les messages recus.
 *
 * Deux regles qui comptent :
 *   - la description de session (offre ou reponse) doit etre appliquee AVANT
 *     tout candidat ICE : addIceCandidate echoue si la description distante
 *     n'est pas encore posee, et le candidat est alors perdu ;
 *   - un candidat vide ({} ou null) marque la fin de la collecte et n'a pas a
 *     etre transmis a l'implementation.
 */
export function orderSignals(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const descriptions = list.filter((m) => m && (m.t === 'offer' || m.t === 'answer'));
    const candidates = list.filter((m) => m && m.t === 'candidate' && m.p && m.p.candidate);
    return descriptions.concat(candidates);
}

/**
 * Faut-il encore interroger le relai en attente longue ?
 * Non tant que le canal pair-a-pair est ouvert : c'est tout l'interet.
 */
export function shouldLongPoll(peerState) {
    return peerState !== 'open';
}

/**
 * Delai avant d'abandonner la negociation et de rester sur le relai.
 * Sans TURN, une paire de reseaux qui ne se voient pas ne se connectera
 * jamais : insister ne ferait qu'occuper la signalisation.
 */
export const PEER_TIMEOUT_MS = 20000;

/** Serveurs STUN publics. Aucun TURN : voir README § Hebergement. */
export const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
];
