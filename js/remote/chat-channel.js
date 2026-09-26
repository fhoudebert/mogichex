// Transport des messages qui ne sont pas des coups.
//
// ── Pourquoi un canal SEPARE du canal de partie ──────────────────────────────
//
// Il aurait ete plus court de faire voyager les messages dans l'enveloppe des
// coups. C'aurait ete un piege : le canal de partie est en dernier-ecrit-gagne
// sur la meme cle, et un message ecrit la ecraserait un coup pas encore lu.
//
// ── Le fil COMMUN, servi par fileio.php ─────────────────────────────────────
//
// Les deux joueurs ecrivent dans le MEME fichier et le serveur ajoute une
// ligne par message : il n'y a donc aucune concurrence a eviter, et c'est le
// format que parlent joclymatch et Tabulon. Un joueur mogichex et un joueur
// Tabulon dans la meme partie se lisent l'un l'autre.
//
// Cela remplace le schema precedent — deux cles de partie ordinaires,
// `<mid>-ca` / `-cb`, chacune reecrite en entier a chaque message. Il evitait
// la concurrence sans rien demander au serveur, mais il ISOLAIT : personne
// d'autre ne lisait ce fil. Tabulon en est parti pour la meme raison.
//
// POURQUOI fileio.php ET NON match.php. La discussion est desormais un format
// partage ; elle appartient donc au point d'entree partage. match.php reste ce
// qu'il est : le stockage des parties de mogichex, qu'une seule chose touche.
// Les deux fichiers se deposent ensemble (voir README, « Host it yourself »).
//
// ── Meme forme que RelayChannel, et pour les memes raisons ──────────────────
//
// Un seul objet porte les deux transports, comme attachRelay() branche deja le
// relai ET le pair-a-pair sur la partie :
//
//   - le pair-a-pair, quand il est ouvert, porte le message immediatement ;
//   - le relai recoit TOUJOURS l'ecriture, breve, parce que c'est lui qui
//     permet de recharger la page ou de reprendre plus tard sans perdre le
//     fil ;
//   - la LECTURE se ralentit des que le pair est ouvert. Le fil n'a pas
//     d'attente longue — fileio.php repond tout de suite — donc c'est le
//     rythme du sondage qui fait la difference, et non un processus PHP tenu
//     ouvert.

import {
    chatMidFor, newMessage, encodeThread, decodeThread, mergeThreads,
    toRelayMessage, fromRelayMessage,
} from './chat-protocol.js';
import { backoffDelay } from './protocol.js';

// Le fil n'a pas d'attente longue : fileio.php repond tout de suite. C'est donc
// le rythme du sondage qui fait la difference entre « le pair est ouvert » et
// « il ne l'est pas », et non un processus PHP tenu ouvert pendant 20 s.
const POLL_MS = 3000;
const IDLE_POLL_MS = 15000;

export class ChatChannel {
    /**
     * @param {object} o
     * @param {string} o.relayUrl
     * @param {string} o.matchId  identifiant de la PARTIE ; les cles des deux
     *   fils en derivent, donc les deux joueurs les trouvent sans se concerter
     * @param {1|-1} o.side       notre camp
     * @param {object} [o.peer]   PeerChannel, s'il y en a un
     * @param {boolean} [o.allowClear] la partie n'est pas protegee (invitation
     *   sans cle) : un message recu sans sceau est alors NORMAL, pas suspect
     * @param {Function} [o.quickText] traduction d'un message rapide, pour que
     *   les clients qui ignorent `quick` n'affichent pas une bulle vide
     * @param {object} [o.sealer] scelleur de texte libre (chat-sealer.js).
     *   Sans lui, un message de texte libre est REFUSE a l'envoi (voir
     *   encodeThread) ; messages rapides et presence continuent de passer,
     *   n'ayant rien de personnel a proteger.
     */
    constructor(o) {
        this.relayUrl = String(o.relayUrl || '').replace(/\/$/, '');
        this.side = o.side;
        this.peer = o.peer || null;
        this.sealer = o.sealer || null;
        this.fetchImpl = o.fetchImpl || ((u, i) => fetch(u, i));
        this.onConversation = o.onConversation || (() => {});
        this.onError = o.onError || (() => {});
        this.matchId = String(o.matchId || '');
        this.allowClear = !!o.allowClear;
        this.quickText = typeof o.quickText === 'function' ? o.quickText : null;
        // `mine` sert l'affichage IMMEDIAT de ce qu'on vient d'ecrire ; `theirs`
        // est le fil tel que le serveur le rend, nos messages compris. Les deux
        // se recouvrent donc, et mergeThreads deduplique par identifiant.
        this.mine = [];
        this.theirs = [];
        this.legacy = [];
        this.running = false;
        this.failures = 0;
        this.longPolling = true;
        this.lastStamp = null;
        this.unavailable = false;
    }

    /** La conversation telle qu'elle doit s'afficher. */
    get conversation() {
        return mergeThreads(this.legacy, this.mine, this.theirs);
    }

    /**
     * Recolle et previent — mais SEULEMENT si quelque chose a change.
     *
     * Le fil d'en face est relu en entier a chaque tour, donc la plupart des
     * tours ne rapportent rien de neuf. Prevenir quand meme ferait redessiner
     * le panneau en boucle et clignoter une pastille de « nouveau message »
     * qui n'en est pas un.
     */
    publish() {
        const conv = this.conversation;
        const stamp = conv.length + ':' + (conv.length ? conv[conv.length - 1].id : '');
        if (stamp === this.lastStamp) return;
        this.lastStamp = stamp;
        this.onConversation(conv);
    }

    async start() {
        if (this.running) return;
        this.running = true;
        if (this.peer) this.peer.onMessage = (msg) => this.acceptFromPeer(msg);
        await this.readLegacy();
        this.publish();
        this.loop();
    }

    stop() {
        this.running = false;
        if (this.peer && this.peer.onMessage) this.peer.onMessage = null;
    }

    /** Suspend ou reprend le sondage rapide (voir RelayChannel.setLongPolling). */
    setLongPolling(active) {
        this.longPolling = active !== false;
    }

    /**
     * Les fils de l'ANCIEN format, en lecture seule.
     *
     * Une partie commencee avant ce changement a ses messages sous
     * `<mid>-ca` / `-cb`. Sans cela, la conversation en cours disparaitrait de
     * l'ecran le jour de la mise a jour — et une partie par correspondance dure
     * des jours. On les lit une fois, au demarrage, et on n'y ecrit JAMAIS :
     * ce qui part maintenant part dans le fil commun.
     *
     * Silencieux en cas d'echec : c'est un rattrapage, pas une dependance.
     */
    async readLegacy() {
        for (const side of [1, -1]) {
            try {
                const res = await this.postMatch({ action: 'load', mid: chatMidFor(this.matchId, side) });
                const old = await decodeThread(await res.text(),
                    { sealer: this.sealer, allowClear: this.allowClear });
                if (old.length) this.legacy = mergeThreads(this.legacy, old);
            } catch {
                /* pas d'ancien fil, ou relai muet : rien a rattraper */
            }
        }
    }

    /**
     * Envoie un message.
     *
     * ENCODER D'ABORD, RETENIR ENSUITE. Le fil part en ENTIER a chaque
     * message : un message que l'encodage refuse — un texte libre sans
     * scelleur — empoisonnerait tout ce qui suit, puisqu'il serait reencode a
     * chaque envoi. On le valide donc avant de l'ajouter, et un refus ne
     * laisse aucune trace.
     */
    async send({ kind, body = null, quick = null, state = null }) {
        if (this.unavailable) throw new Error('chat-unavailable');
        const msg = newMessage({ kind, side: this.side, body, quick, state });
        // SCELLER D'ABORD, RETENIR ENSUITE : un message que le scellement
        // refuse — un texte libre sans scelleur — ne doit laisser aucune trace
        // dans notre fil, sinon il s'afficherait chez nous comme s'il etait
        // parti. On passe par encodeThread plutot que par un second chemin de
        // scellement : deux chemins finiraient par diverger.
        const sealed = JSON.parse(await encodeThread([msg],
            { sealer: this.sealer, allowClear: this.allowClear })).msgs[0];
        this.mine = this.mine.concat([msg]);
        this.publish();
        // Le pair d'abord (immediat), le relai ensuite (reference durable).
        //
        // C'est la forme SCELLEE qui part sur le canal pair-a-pair, pas
        // l'objet en memoire. Envoyer `msg` tel quel ferait voyager le texte
        // en clair, et surtout l'autre bout le rejetterait : decodeThread
        // marque `locked` tout corps de discussion depourvu de `enc`. On
        // reutilise la sortie de encodeThread plutot que de sceller une
        // seconde fois ici — deux chemins de scellement finiraient par
        // diverger.
        if (this.peer && this.peer.isOpen) this.peer.publish(sealed);
        try {
            const repli = msg.quick && this.quickText ? this.quickText(msg.quick) : null;
            const ligne = toRelayMessage(msg, sealed.enc ? sealed.body : null, repli);
            await this.postChat({
                chatioaction: 'save', gameid: this.matchId,
                chatmsg: JSON.stringify({ data: ligne }),
            });
        } catch (err) {
            // Le message est deja affiche et deja parti chez le pair s'il y en
            // a un : une panne d'ecriture ne doit pas le faire disparaitre de
            // l'ecran. Il repartira au prochain envoi, le fil etant complet.
            this.onError(err);
        }
        return msg;
    }

    /**
     * Message recu par le canal pair-a-pair.
     *
     * Relu par decodeThread pour n'accepter qu'un message bien forme — la meme
     * porte que sur le relai, plutot qu'une seconde validation ecrite a part
     * qui divergerait.
     */
    async acceptFromPeer(raw) {
        const [msg] = await decodeThread(JSON.stringify({ msgs: [raw] }),
            { sealer: this.sealer, allowClear: this.allowClear });
        if (!msg) return;
        // Un message que NOUS avons ecrit ne revient pas : le transport est
        // direct. Le filtre est la par surete — mergeThreads deduplique de
        // toute facon par identifiant.
        if (msg.side === this.side) return;
        this.theirs = mergeThreads(this.theirs, [msg]);
        this.publish();
    }

    // -- interne --------------------------------------------------------------

    async postTo(file, fields) {
        const res = await this.fetchImpl(this.relayUrl + '/' + file, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(fields).toString(),
        });
        if (!res.ok) {
            const err = new Error('relai ' + res.status);
            err.status = res.status;
            throw err;
        }
        return res;
    }

    /** Le stockage des parties de mogichex — employe seulement pour relire les
     *  anciens fils. */
    postMatch(fields) { return this.postTo('match.php', fields); }

    /** Le point d'entree PARTAGE, celui du fil commun. */
    postChat(fields) { return this.postTo('fileio.php', fields); }

    /**
     * Le fil entier, tel que le serveur le rend.
     *
     * On relit tout a chaque tour plutot que d'entretenir un curseur : c'est
     * ce qui rend le rattrapage gratuit apres une coupure ou un rechargement,
     * et mergeThreads deduplique par identifiant.
     */
    async read() {
        const res = await this.postChat({ chatioaction: 'load', gameid: this.matchId });
        let data;
        try {
            data = JSON.parse(await res.text());
        } catch {
            return [];
        }
        if (!data || !Array.isArray(data.messages)) return [];
        const msgs = data.messages.map(fromRelayMessage).filter(Boolean);
        return decodeThread(JSON.stringify({ v: 1, msgs }),
            { sealer: this.sealer, allowClear: this.allowClear });
    }

    async loop() {
        while (this.running) {
            try {
                /*
                 * ON FUSIONNE, ON NE REMPLACE PAS.
                 *
                 * Le relai retire les plus anciens messages quand le fil est
                 * plein (voir deploy/fileio.php). Remplacer le fil par ce que
                 * le serveur rend faisait alors DISPARAITRE de l'ecran le
                 * debut d'une conversation qu'on avait sous les yeux — mesure
                 * faite : le message numero 1 s'efface sans un mot.
                 *
                 * Ce qu'on a lu, on le garde. C'est deja ce que fait
                 * joclymatch, qui n'enleve jamais une bulle de son panneau ;
                 * ce qui disparait n'est perdu que pour qui arrive apres.
                 * mergeThreads deduplique par identifiant, donc relire le fil
                 * entier a chaque tour ne coute rien.
                 */
                this.theirs = mergeThreads(this.theirs, await this.read());
                this.failures = 0;
                this.publish();
                await sleep(this.longPolling === false ? IDLE_POLL_MS : POLL_MS);
            } catch (err) {
                if (!this.running) return;
                // UN RELAI SANS fileio.php N'EST PAS UNE PANNE PASSAGERE.
                // C'est une installation incomplete — match.php deploye sans
                // son voisin — et reessayer indefiniment ne la corrigera pas.
                // On s'arrete et on le DIT, une fois : une discussion muette
                // sans explication se lit comme un defaut de l'application.
                if (err && err.status === 404) {
                    this.unavailable = true;
                    this.running = false;
                    this.onError(err, this.failures, 'chat-unavailable');
                    return;
                }
                this.failures++;
                this.onError(err, this.failures);
                await sleep(backoffDelay(this.failures));
            }
        }
    }
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
