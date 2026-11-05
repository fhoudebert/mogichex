// Prévenir quand l'application n'est pas sous les yeux.
//
// C'est la seule fonction de ce portage où le téléphone bat le PC : une partie
// par correspondance dure des jours, et l'adversaire ne va pas garder un onglet
// ouvert. Logique PURE ici ; l'appel au navigateur est dans app.js.
//
// ── Ce que cela fait, et ce que cela ne fait pas ────────────────────────────
//
// Tant que l'application VIT — onglet en arrière-plan, écran éteint,
// application Android suspendue mais pas tuée — la boucle d'écoute tourne
// (ralentie par le système) et une notification part. C'est déjà l'essentiel
// des cas : on repose le téléphone entre deux coups, on ne ferme pas.
//
// Une fois l'application TUÉE par le système, plus rien n'arrive jusqu'à
// réouverture. Y remédier demanderait un service en arrière-plan — `WorkManager`
// (réveil différé d'un quart d'heure minimum) ou FCM, c'est-à-dire un service
// tiers et un serveur. Tout le reste du projet a été construit pour n'en
// dépendre d'aucun ; la limite est assumée et écrite, pas contournée en
// silence.
//
// ── Deux règles qui ne se négocient pas ─────────────────────────────────────
//
// 1. On ne demande JAMAIS la permission au démarrage. Une invite de permission
//    sur le premier écran est refusée par réflexe, et ce refus est définitif
//    dans la plupart des navigateurs — on aurait grillé la fonction avant que
//    l'utilisateur sache ce qu'elle fait. Elle est donc demandée sur un geste
//    explicite, dans le panneau de discussion, quand le sujet est à l'écran.
//
// 2. On ne met pas le texte libre dans la notification. Il a été chiffré
//    précisément pour que le relai ne le voie pas ; l'afficher sur un écran
//    verrouillé, dans un bandeau que voit quiconque passe à côté, déferait une
//    partie de ce travail. Les messages rapides, eux, ne portent rien de
//    personnel — ils s'affichent en toutes lettres.

import { KIND } from './remote/chat-protocol.js';

/** Faut-il prévenir pour ce message ? */
export function shouldNotify({ visible, permission, message, selfSide }) {
    if (!message) return false;
    if (permission !== 'granted') return false;
    // L'application est sous les yeux : le fil et la pastille suffisent, une
    // notification par-dessus serait du bruit.
    if (visible) return false;
    // Ses propres messages ne se notifient pas.
    if (message.side === selfSide) return false;
    // La présence ne réveille pas un téléphone. « Votre adversaire réfléchit »
    // n'appelle aucune action ; le seuil d'une notification est qu'elle
    // mérite d'interrompre.
    return message.kind === KIND.CHAT || message.kind === KIND.NUDGE;
}

/**
 * Le contenu de la notification.
 *
 * `tag` est constant par partie : une notification en remplace une autre au
 * lieu de s'empiler. Cinq bandeaux pour cinq messages de la même partie, c'est
 * ce qui fait désactiver les notifications d'une application.
 *
 * @param {object} message
 * @param {Function} t traduction
 * @param {string} gameTitle
 */
export function notificationFor(message, t, gameTitle = '') {
    const title = gameTitle || t('Messages');
    if (message.kind === KIND.NUDGE) return { title, body: t('Your opponent is waiting'), tag: 'chat' };
    if (message.quick) return { title, body: t(QUICK_BODY[message.quick] || 'New message'), tag: 'chat' };
    // Texte libre : on annonce, on ne cite pas. Voir l'en-tête.
    return { title, body: t('New message'), tag: 'chat' };
}

const QUICK_BODY = {
    wellPlayed: 'Well played',
    yourTurn: 'Your turn!',
    backSoon: 'Back in a few minutes',
    rematch: 'Another game?',
    unreadable: 'Unreadable — change key!',
};

/**
 * Temps restant avant de pouvoir relancer, en millisecondes.
 *
 * Sert à ÉTIQUETER le bouton plutôt qu'à le faire échouer : un bouton qui ne
 * répond pas sans dire pourquoi se presse trois fois. `canNudge()` reste
 * l'autorité — ceci n'en est que l'affichage.
 */
export function nudgeCooldown(conversation, side, now, minInterval) {
    for (let i = conversation.length - 1; i >= 0; i--) {
        const m = conversation[i];
        if (m.kind === KIND.NUDGE && m.side === side) {
            return Math.max(0, minInterval - (now - m.at));
        }
    }
    return 0;
}

/** « 4 min » / « 45 s » — de quoi savoir s'il faut attendre ou faire autre chose. */
export function formatCooldown(ms) {
    const s = Math.ceil(Math.max(0, ms) / 1000);
    return s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`;
}
