// Jeu a distance — decisions PURES, sans reseau ni DOM.
//
// Modele repris de joclymatch : les deux camps ecrivent l'ETAT COMPLET de la
// partie dans le MEME fichier (un blob par match), chacun apres son coup, et
// relisent celui de l'autre. Ce n'est pas le modele de la signalisation, qui
// a besoin de deux boites separees : ici les deux camps jouent a tour de
// role, donc ils n'ecrivent jamais en meme temps.
//
// Publier l'etat complet plutot que le dernier coup n'est pas un detail :
// c'est ce qui permet de rejoindre une partie deja commencee, de recharger la
// page sans rien perdre, et de repartir apres une coupure reseau.

/**
 * Faut-il appliquer l'enveloppe recue ?
 *
 * @param {object} env enveloppe { matchDetails, matchdata, time, key }
 * @param {{selfKey:string, lastTurns:number, gameName?:string}} ctx
 * @returns {{apply:boolean, reason:string, turns:number}}
 *
 * Les trois refus comptent :
 *   - une enveloppe vide, c'est ce que match.php rend pour une partie jamais
 *     sauvegardee ({}) — la prendre pour un etat jouable planterait load() ;
 *   - notre propre enveloppe nous revient a chaque relecture (on ecrit et on
 *     lit le meme fichier) : sans le test sur la cle, on se rechargerait soi-
 *     meme en boucle, ce qui interromprait le tour de l'utilisateur ;
 *   - une enveloppe qui n'apporte pas de coup nouveau ferait clignoter le
 *     plateau pour rien.
 */
export function shouldApplyEnvelope(env, ctx) {
    const turns = envelopeTurns(env);
    if (!env || typeof env !== 'object' || !env.matchDetails || !env.matchdata) {
        return { apply: false, reason: 'empty', turns };
    }
    if (ctx.gameName && env.matchDetails.gameName && env.matchDetails.gameName !== ctx.gameName) {
        return { apply: false, reason: 'other-game', turns };
    }
    if (ctx.selfKey && env.key === ctx.selfKey) {
        return { apply: false, reason: 'own', turns };
    }
    if (turns <= (ctx.lastTurns || 0)) {
        return { apply: false, reason: 'stale', turns };
    }
    return { apply: true, reason: 'new', turns };
}

/** Nombre de coups porte par une enveloppe (0 si absent ou illisible). */
export function envelopeTurns(env) {
    const n = env && env.matchDetails && env.matchDetails.nbTurns;
    return typeof n === 'number' && n >= 0 ? n : 0;
}

/**
 * Prochaine valeur de `since` pour l'attente longue.
 * L'en-tete X-Match-Mtime est une date de derniere ecriture en secondes ; on
 * ne recule JAMAIS (un en-tete absent ou aberrant ne doit pas faire repartir
 * l'attente du debut, ce qui rejouerait tout l'historique).
 */
export function nextSince(header, current) {
    const parsed = parseInt(header, 10);
    if (!isFinite(parsed) || parsed < 0) return current || 0;
    return Math.max(parsed, current || 0);
}

/**
 * Delai avant la prochaine tentative apres un echec reseau : 1 s, 2 s, 4 s…
 * plafonne a 30 s. Un relai qui tombe ne doit pas etre martele, et une
 * reprise doit rester rapide quand la coupure etait breve.
 */
export function backoffDelay(consecutiveFailures, base = 1000, max = 30000) {
    if (!(consecutiveFailures > 0)) return 0;
    return Math.min(max, base * Math.pow(2, consecutiveFailures - 1));
}

/**
 * Camp local a partir du lien d'invitation.
 * 'a' -> PLAYER_A local et PLAYER_B distant, et inversement.
 */
export function sidesFor(side, Jocly) {
    const local = side === 'b' ? Jocly.PLAYER_B : Jocly.PLAYER_A;
    return { local, remote: -local };
}
