// L'historique des coups — logique PURE, testee sous Node.
//
// Le rendu et le rollback sont ailleurs ; ici on ne decide que de la FORME de
// la liste et de la position visee par un appui.
//
// ── Ce que « revenir au coup n » veut dire ──────────────────────────────────
//
// jocly compte les coups JOUES, sans indication de camp : getPlayedMoves()
// rend un tableau brut, et rollback(n) ramene a la position ou n coups ont ete
// joues. Appuyer sur le n-ieme coup de la liste demande donc rollback(n) — on
// voit la position QUI RESULTE de ce coup, ce qui est la lecture naturelle
// (« montre-moi ce coup »). Revenir avant le premier coup, c'est rollback(0),
// d'ou la ligne de position initiale en tete de liste.
//
// ── Pourquoi deux colonnes ──────────────────────────────────────────────────
//
// Les jeux de jocly n'alternent PAS tous strictement les camps (prise multiple
// aux dames, coups doubles), donc une grille « blancs / noirs » mentirait des
// qu'on sort des echecs. On numerote donc les coups un par un et on les range
// par deux uniquement pour tenir dans la hauteur : la deuxieme colonne n'est
// pas « le camp adverse », c'est « le coup suivant ». Chaque cellule porte son
// propre numero, et c'est ce qui rend la chose honnete sur tous les jeux.

/**
 * Range les coups par lignes de deux.
 *
 * @param {string[]} moves coups deja convertis en chaines (getMoveString)
 * @returns {Array<{cells:Array<{n:number, text:string}>}>}
 */
export function moveRows(moves) {
    const list = Array.isArray(moves) ? moves : [];
    const rows = [];
    for (let i = 0; i < list.length; i += 2) {
        const cells = [];
        for (let k = i; k < Math.min(i + 2, list.length); k++) {
            cells.push({ n: k + 1, text: String(list[k] === undefined ? '' : list[k]) });
        }
        rows.push({ cells });
    }
    return rows;
}

/**
 * Position visee par un appui sur le coup n.
 *
 * Contre l'ordinateur, une position ou c'est a LUI de jouer n'est pas
 * observable : la boucle repart, il joue, et on se retrouve un coup plus loin
 * que ce qu'on avait demande. On recule donc d'un cran de plus — exactement ce
 * que fait deja takeBackTarget(), et pour la meme raison.
 *
 * La verification du camp ne peut pas se faire ici (il faudrait interroger le
 * moteur) : cette fonction donne la cible NAIVE, et GameSession.rollbackTo()
 * ajuste ensuite si le tour ne tombe pas sur un humain. C'est le meme partage
 * que pour reprendre un coup.
 *
 * @param {number} n coup choisi (1..count), 0 = position initiale
 * @param {number} count nombre de coups joues
 * @param {number} humanCount 1 (contre l'ordinateur) ou 2 (deux humains)
 */
export function rollbackTarget(n, count, humanCount) {
    if (!(count > 0)) return null;
    const wanted = Math.max(0, Math.min(n, count));
    if (wanted === count) return null; // deja la : rien a defaire
    if (humanCount > 1) return wanted;
    return wanted;
}

/**
 * L'historique est-il consultable ?
 *
 * Il l'est toujours en lecture — voir ses coups ne change aucune position.
 * C'est le RETOUR EN ARRIERE qui est interdit des qu'un camp est distant :
 * rejouer une position que l'adversaire a deja depassee desynchroniserait les
 * deux plateaux (lecon Tabulon, deja payee ici pour « reprendre » et
 * « recommencer »).
 */
export function canRollback({ remote = false, moves = 0 } = {}) {
    return !remote && moves > 0;
}

/**
 * La phrase sous la liste des coups.
 *
 * En partie a distance, la liste reste INERTE — revenir a une position
 * quelconque que l'adversaire a deja depassee desynchroniserait les deux
 * plateaux. Mais quand la partie permet la reprise (reglage de l'invitation,
 * pose par Tabulon, joclymatch ou mogichex), « Reprendre » vaut, lui : il defait
 * notre dernier coup et la reponse, a notre tour, et PUBLIE la position. Dire
 * « indisponible » a cote d'un bouton actif serait faux.
 *
 * @returns {string} cle de traduction (texte anglais)
 */
export function historyHint({ remote = false, allowTakeback = false, moves = 0 } = {}) {
    if (!(moves > 0)) return 'No move played yet.';
    if (!remote) return 'Tap a move to go back to that position.';
    if (allowTakeback) return 'In an online game, you can take back your last move on your turn.';
    return 'Going back is unavailable in an online game.';
}

/**
 * Qui occupe la barre de la partie.
 *
 * QUATRE ICONES AU PLUS, retour compris : a 390 px, une cinquieme mange le
 * titre du jeu. En local : historique, regles, options. A distance : discussion,
 * regles, options — l'historique n'y servait a rien tant que revenir en arriere
 * y etait interdit, la liste restait atteignable depuis les options.
 *
 * Quand la partie a distance PERMET la reprise de coup, « Reprendre » vit dans
 * le panneau des coups : l'historique revient donc dans la barre. S'il y
 * retrouve la discussion, ce sont les REGLES qui passent dans les options —
 * elles ne changent pas en cours de partie, alors que la discussion porte un
 * badge et la reprise se joue a notre tour.
 *
 * @returns {{history:boolean, chat:boolean, rules:boolean,
 *            openHistory:boolean, openRules:boolean}} true = visible
 */
export function barLayout({ playing = false, remote = false, chat = false, takeback = false } = {}) {
    if (!playing) return { history: false, chat: false, rules: true, openHistory: false, openRules: false };
    const history = !remote || takeback;
    const withChat = remote && chat;
    const rules = !(history && withChat);
    return { history, chat: withChat, rules, openHistory: !history, openRules: !rules };
}
