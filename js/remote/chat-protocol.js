// Echanger autre chose que des coups : messages rapides, presence, relance.
//
// PORTE DE TABULON (app/content/remote-chat-protocol.js), au format pres.
// Les deux applications doivent rester lisibles l'une par l'autre : un joueur
// Tabulon et un joueur mogichex partagent deja le lien d'invitation,
// l'enveloppe de partie et le relai — la discussion n'a aucune raison de faire
// exception. Tout ce qui circule ici est donc identique a ce que Tabulon
// depose, y compris les noms de champs.
//
// Logique PURE : aucun reseau, aucun DOM.
//
// ── Un seul ecrivain par fil ────────────────────────────────────────────────
//
// match.php stocke une cle -> une valeur, en dernier-ecrit-gagne. Ecrire une
// discussion a deux dans la meme cle, c'est une lecture-modification-ecriture
// concurrente : des messages perdus des que les deux joueurs tapent en meme
// temps. La solution ne demande rien au serveur — DEUX cles, une par joueur.
// Chacun n'ecrit QUE dans la sienne et ne lit QUE celle d'en face. Plus aucune
// concurrence, et le dernier-ecrit-gagne devient exact au lieu d'etre
// dangereux. Le prix est que chaque joueur reecrit son fil entier a chaque
// message ; un fil de partie tient tres largement dans la limite de match.php.
//
// ── Ce qui n'est pas encore la ──────────────────────────────────────────────
//
// Le TEXTE LIBRE et son scellement. Le relai n'authentifie personne : ce qu'on
// y depose est lisible par qui tient le serveur et par qui devine un
// identifiant de partie. Un message rapide ne pose pas ce probleme — il voyage
// comme IDENTIFIANT et se traduit chez celui qui le lit, donc il ne contient
// rien de personnel. encodeThread() REFUSE donc un corps de texte libre tant
// qu'aucun scelleur ne lui est fourni : c'est le garde-fou qui empeche
// d'ajouter un champ de saisie sans avoir ajoute le chiffrement.

/** Genres de message. Memes valeurs que Tabulon. */
export const KIND = {
    CHAT: 'chat',
    PRESENCE: 'presence',
    NUDGE: 'nudge',
};

/** Version du format de fil. */
export const THREAD_VERSION = 1;

/**
 * Etats de presence.
 *
 * Des DRAPEAUX, pas des phrases : ils traversent le reseau comme identifiants
 * et chaque client les affiche dans SA langue. Deux joueurs sans langue
 * commune se disent ainsi l'essentiel, et rien de personnel ne circule — donc
 * rien a chiffrer, donc ils restent disponibles meme sans cle.
 */
export const PRESENCE = {
    PAUSED: 'paused',
    BACK: 'back',
    THINKING: 'thinking',
    LEAVING: 'leaving',
};

const PRESENCE_VALUES = Object.values(PRESENCE);

/** Identifiants de messages rapides reconnus. Un identifiant inconnu est
 *  ignore a la lecture plutot qu'affiche brut : il viendrait d'un client plus
 *  recent, et montrer « rematch3 » n'aiderait personne. */
export const QUICK = ['wellPlayed', 'yourTurn', 'backSoon', 'rematch', 'unreadable'];

const QUICK_RE = /^[A-Za-z][A-Za-z0-9]{0,31}$/;

/** Ce message transporte-t-il du texte libre, donc doit-il etre scelle ? */
export function requiresSeal(message) {
    return !!message && message.kind === KIND.CHAT && typeof message.body === 'string';
}

/**
 * Cle de stockage du fil d'un joueur.
 *
 * Le suffixe est le CAMP, pas un numero d'ordre : les deux joueurs doivent
 * calculer la meme chose sans se concerter, et chacun connait le sien.
 *
 * Le motif accepte par match.php est /^[A-Za-z0-9_-]{6,64}$/ — ni point ni
 * barre, sous peine de traversee de repertoire. Un identifiant mogichex fait
 * 28 caracteres, donc le suffixe passe ; on verifie quand meme, parce qu'un
 * identifiant refuse par le serveur donnerait un echec reseau opaque plutot
 * qu'une erreur lisible.
 *
 * @param {string} matchId
 * @param {1|-1} side
 */
export function chatMidFor(matchId, side) {
    if (typeof matchId !== 'string' || !matchId) throw new Error('chatMidFor: matchId requis');
    if (side !== 1 && side !== -1) throw new Error('chatMidFor: side doit valoir 1 ou -1');
    const mid = matchId + (side === 1 ? '-ca' : '-cb');
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(mid))
        throw new Error('chatMidFor: identifiant hors du format accepte par le relai : ' + mid);
    return mid;
}

/**
 * Identifiant de message : non devinable, et surtout STABLE, puisqu'il sert a
 * dedupliquer quand un fil est relu (rattrapage, reconnexion, relecture d'un
 * fichier inchange). Deux messages ecrits dans la meme milliseconde par le
 * meme joueur ne doivent pas se confondre, d'ou la part aleatoire.
 */
function messageKey(rand) {
    const bytes = new Uint8Array(8);
    rand(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function defaultRand(bytes) {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
        return;
    }
    throw new Error('chat-protocol: crypto.getRandomValues indisponible');
}

/**
 * Construit un message.
 * @param {{kind:string, side:1|-1, body?:string, quick?:string, state?:string,
 *          at?:number, rand?:Function}} m
 */
export function newMessage({
    kind,
    side,
    body = null,
    quick = null,
    state = null,
    at = Date.now(),
    rand = defaultRand,
}) {
    if (![KIND.CHAT, KIND.PRESENCE, KIND.NUDGE].includes(kind))
        throw new Error('newMessage: genre inattendu : ' + kind);
    if (side !== 1 && side !== -1) throw new Error('newMessage: side doit valoir 1 ou -1');
    if (kind === KIND.CHAT && !String(body || '').trim() && !quick)
        throw new Error("newMessage: un message de discussion sans texte n'a rien a dire");
    if (quick !== null && !QUICK_RE.test(String(quick)))
        throw new Error('newMessage: identifiant de message rapide inattendu : ' + quick);
    if (kind === KIND.PRESENCE && !PRESENCE_VALUES.includes(state))
        throw new Error('newMessage: etat de presence inconnu : ' + state);

    /*
     * L'IDENTIFIANT EST `<horodatage>-<aleatoire>`, et cette forme n'est pas
     * cosmetique : le fil commun transporte `time` et `key` separement, et
     * l'identifiant s'en reconstruit a la lecture. Une forme quelconque — un
     * simple hexadecimal, ce qu'elle etait — ne se reconstruit PAS : le
     * message revenu du serveur portait alors un autre identifiant que celui
     * affiche, la deduplication ne voyait plus le lien, et chaque message
     * apparaissait DEUX fois (mesure : six a l'ecran pour quatre sur le
     * relai).
     */
    const msg = { v: THREAD_VERSION, kind, side, at, id: at + '-' + messageKey(rand) };
    if (kind === KIND.CHAT && quick) msg.quick = String(quick);
    else if (kind === KIND.CHAT) msg.body = String(body);
    if (kind === KIND.PRESENCE) msg.state = state;
    return msg;
}

/**
 * Serialise le fil d'UN joueur, tel qu'il sera depose sous sa cle.
 *
 * ASYNCHRONE alors que rien ne l'exige aujourd'hui : le scellement viendra
 * (WebCrypto ou XChaCha), et il sera asynchrone. Figer la signature maintenant
 * evite d'avoir a remonter des `await` dans tous les appelants le jour ou le
 * texte libre arrive.
 *
 * Sans scelleur, un message de texte libre FAIT ECHOUER l'encodage plutot que
 * de partir en clair. Presence et messages rapides passent : ils ne portent
 * aucun texte.
 */
export async function encodeThread(messages, { sealer = null, allowClear = false } = {}) {
    if (!Array.isArray(messages)) throw new Error('encodeThread: liste attendue');
    const out = [];
    for (const m of messages) {
        if (!requiresSeal(m)) {
            out.push(m);
            continue;
        }
        // `allowClear` est une PERMISSION EXPLICITE, jamais deduite de
        // l'absence de scelleur : un scelleur qui n'a pas pu se construire —
        // cle abimee, aleatoire indisponible — ne vaut pas autorisation
        // d'ecrire en clair. C'est exactement ainsi qu'une protection se perd
        // sans que personne ne l'ait decide.
        if (!sealer && allowClear) {
            out.push(m);
            continue;
        }
        if (!sealer)
            throw new Error(
                'encodeThread: un message de discussion ne peut pas partir en clair (aucun sealer fourni)'
            );
        out.push(Object.assign({}, m, { body: await sealer.seal(m.body), enc: 1 }));
    }
    return JSON.stringify({ v: THREAD_VERSION, msgs: out });
}

/**
 * Relit un fil. Rend TOUJOURS un tableau — jamais d'exception, jamais null :
 * un fil illisible (partie neuve, page d'erreur, message d'un client plus
 * recent) doit se traduire par « rien a afficher » et non par une partie
 * cassee. C'est la regle que suit deja shouldApplyEnvelope.
 *
 * Un corps scelle qu'on ne sait pas ouvrir est CONSERVE, marque `locked` :
 * l'utilisateur voit qu'un message existe et qu'il lui manque la cle, ce qui
 * vaut mieux qu'un trou silencieux dans la conversation.
 */
/**
 * Un message interne vers la ligne deposee dans le fil COMMUN.
 *
 * Le fil est celui de joclymatch : un objet par ligne, aux champs
 * `{msg, player, pseudo, time, key}`. Nos champs a nous — `kind`, `quick`,
 * `state`, `enc` — s'y ajoutent en FACULTATIF. Un client qui les ignore n'en
 * souffre pas : `kind` absent vaut `chat`, et les trois applications sautent en
 * silence ce qu'elles ne savent pas rendre.
 *
 * `player` et `side` portent deja la meme chose (1 / -1) : c'est le seul
 * endroit ou les deux formats se rejoignaient sans rien faire.
 *
 * UN MESSAGE RAPIDE DOIT RESTER LISIBLE par qui ne connait pas `quick`. Le
 * champ voyage comme identifiant et se traduit chez le lecteur ; un client qui
 * l'ignore affiche `msg`, qui vaudrait la chaine vide — donc une bulle VIDE
 * dans son fil. On y met donc le libelle traduit, dans NOTRE langue faute de
 * connaitre la sienne, ce qui vaut mieux que rien. Rien n'est trahi : un
 * message rapide ne porte aucun texte personnel, c'est precisement ce qui lui
 * permet de circuler sans cle.
 */
export function toRelayMessage(msg, seal = null, quickText = null) {
    const [time, key] = String(msg.id).split('-');
    let corps = seal !== null ? seal : (msg.body ?? '');
    if (seal === null && msg.quick && typeof quickText === 'string' && quickText.length)
        corps = quickText;
    const out = {
        msg: corps,
        player: msg.side,
        time: Number(time) || msg.at,
        key: key || '',
    };
    if (msg.kind && msg.kind !== KIND.CHAT) out.kind = msg.kind;
    if (msg.quick) out.quick = msg.quick;
    if (msg.state) out.state = msg.state;
    if (seal !== null) out.enc = 1;
    return out;
}

/**
 * L'inverse : une ligne du fil commun vers notre forme interne.
 *
 * Rend null sur ce qui n'est pas exploitable, plutot que de lever : le fil est
 * partage, et une ligne venue d'un client inconnu ne doit pas faire tomber la
 * lecture des autres.
 */
export function fromRelayMessage(line) {
    const d = line && typeof line === 'object' ? (line.data || line) : null;
    if (!d || typeof d !== 'object') return null;
    if (d.player !== 1 && d.player !== -1) return null;
    if (!Number.isFinite(d.time)) return null;
    const out = {
        v: 1,
        kind: typeof d.kind === 'string' ? d.kind : KIND.CHAT,
        side: d.player,
        at: d.time,
        id: String(d.time) + '-' + String(d.key || ''),
    };
    if (typeof d.quick === 'string') out.quick = d.quick;
    if (typeof d.state === 'string') out.state = d.state;
    if (typeof d.msg === 'string' && !out.quick) out.body = d.msg;
    if (d.enc) out.enc = 1;
    // Le pseudo de joclymatch : conserve tel quel. Le joueur qui s'est donne un
    // nom doit s'afficher sous ce nom, pas sous « Votre adversaire ».
    if (typeof d.pseudo === 'string' && d.pseudo.length) out.pseudo = d.pseudo;
    return out;
}

/**
 * Reporte le pseudo sur le message reconstruit.
 *
 * decodeThread rebatit chaque message a partir d'une liste FIXE de champs —
 * c'est ce qui empeche un client inconnu d'injecter n'importe quoi. Le pseudo
 * est recopie ici, et nulle part ailleurs, pour que cette liste reste la seule
 * porte d'entree.
 */
function withPseudo(out, source) {
    if (typeof source.pseudo === 'string' && source.pseudo.length) out.pseudo = source.pseudo;
    return out;
}

export async function decodeThread(text, { sealer = null, allowClear = false } = {}) {
    if (typeof text !== 'string' || !text.trim()) return [];
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        return [];
    }
    if (!data || !Array.isArray(data.msgs)) return [];

    const out = [];
    for (const m of data.msgs) {
        if (!m || typeof m !== 'object') continue;
        if (typeof m.id !== 'string' || !m.id) continue;
        if (m.side !== 1 && m.side !== -1) continue;
        if (!Number.isFinite(m.at)) continue;
        const head = { v: m.v || 1, kind: m.kind, side: m.side, at: m.at, id: m.id };

        if (m.kind === KIND.PRESENCE) {
            if (!PRESENCE_VALUES.includes(m.state)) continue;
            out.push(Object.assign(head, { state: m.state }));
        } else if (m.kind === KIND.NUDGE) {
            out.push(head);
        } else if (m.kind === KIND.CHAT) {
            if (typeof m.quick === 'string') {
                if (!QUICK_RE.test(m.quick)) continue;
                out.push(withPseudo(Object.assign(head, { quick: m.quick }), m));
                continue;
            }
            if (typeof m.body !== 'string') continue;
            if (!m.enc) {
                // Pas de sceau. Deux situations, et une seule est un probleme.
                //
                // `allowClear` dit que CETTE partie n'est pas protegee — une
                // invitation sans cle, typiquement un lien joclymatch. Le
                // message est alors normal, et le refuser priverait le joueur
                // de tout ce que son correspondant lui ecrit.
                //
                // Sans cette permission, le message est GARDE mais verrouille :
                // refuser l'affichage effacerait la trace d'un correspondant
                // mal configure, l'afficher tel quel laisserait croire que le
                // canal protege quelque chose.
                if (allowClear) {
                    out.push(withPseudo(Object.assign(head, { body: m.body }), m));
                    continue;
                }
                out.push(withPseudo(
                    Object.assign(head, { body: null, locked: true, reason: 'unsealed' }), m));
                continue;
            }
            let body = null;
            try {
                body = sealer ? await sealer.open(m.body) : null;
            } catch {
                body = null;
            }
            out.push(withPseudo(
                body === null
                    ? Object.assign(head, {
                          body: null,
                          locked: true,
                          reason: sealer ? 'badKey' : 'noKey',
                      })
                    : Object.assign(head, { body }),
                m
            ));
        }
        // Genre inconnu : ignore en silence. C'est ce qui permettra d'en
        // ajouter un quatrieme sans casser les clients d'aujourd'hui.
    }
    return out;
}

/**
 * Assemble plusieurs fils en une conversation.
 *
 * Trie par horodatage, puis par identifiant a egalite — deux horloges de
 * machines differentes ne s'accordent pas, et sans departage l'ordre affiche
 * changerait d'un rafraichissement a l'autre, ce qui se voit tout de suite.
 *
 * Deduplique par identifiant : un fil est relu en entier a chaque tour.
 */
export function mergeThreads(...threads) {
    const byId = new Map();
    for (const thread of threads)
        for (const m of thread || []) if (m && typeof m.id === 'string' && !byId.has(m.id)) byId.set(m.id, m);
    return [...byId.values()].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Le dernier etat de presence declare par un camp, ou null.
 * C'est ce qu'une interface affiche — « votre adversaire s'est absente » —
 * plutot que la suite des changements, qui n'interesse personne.
 */
export function presenceOf(conversation, side) {
    for (let i = conversation.length - 1; i >= 0; i--) {
        const m = conversation[i];
        if (m.kind === KIND.PRESENCE && m.side === side) return m;
    }
    return null;
}

/**
 * Nombre de messages non lus, a partir du dernier que l'affichage a signale.
 *
 * Ses PROPRES messages ne comptent jamais : on n'a pas a se relire.
 */
export function countUnread(conversation, seenId, side) {
    const from = seenId ? conversation.findIndex((m) => m.id === seenId) : -1;
    let n = 0;
    for (let i = from + 1; i < conversation.length; i++) {
        if (conversation[i].side !== side) n++;
    }
    return n;
}

/** Une relance est-elle permise maintenant ? Bornee dans le temps, sinon
 *  c'est une arme. Le garde-fou vit ici des le premier tour, meme si
 *  l'interface ne propose pas encore la relance. */
export const NUDGE_MIN_INTERVAL_MS = 5 * 60 * 1000;

export function canNudge(conversation, side, now = Date.now()) {
    for (let i = conversation.length - 1; i >= 0; i--) {
        const m = conversation[i];
        if (m.kind === KIND.NUDGE && m.side === side) return now - m.at >= NUDGE_MIN_INTERVAL_MS;
    }
    return true;
}
