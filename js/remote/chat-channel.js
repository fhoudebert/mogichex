// Transport des messages qui ne sont pas des coups.
//
// ── Pourquoi un canal SEPARE du canal de partie ──────────────────────────────
//
// Il aurait ete plus court de faire voyager les messages dans l'enveloppe des
// coups. C'aurait ete un piege : le canal de partie est en dernier-ecrit-gagne
// sur la meme cle, et un message ecrit la ecraserait un coup pas encore lu.
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
//   - la LECTURE en attente longue s'arrete des que le pair est ouvert. C'est
//     tout l'interet : sans cela, chaque joueur immobiliserait DEUX processus
//     PHP pendant 20 s en boucle (un pour la partie, un pour la discussion) au
//     lieu d'un. La boucle continue a tourner au ralenti, en filet de
//     securite, exactement comme celle du canal de partie.

import { chatMidFor, newMessage, encodeThread, decodeThread, mergeThreads } from './chat-protocol.js';
import { nextSince, backoffDelay } from './protocol.js';

const IDLE_POLL_MS = 5000;

export class ChatChannel {
    /**
     * @param {object} o
     * @param {string} o.relayUrl
     * @param {string} o.matchId  identifiant de la PARTIE ; les cles des deux
     *   fils en derivent, donc les deux joueurs les trouvent sans se concerter
     * @param {1|-1} o.side       notre camp : decide laquelle est la notre
     * @param {object} [o.peer]   PeerChannel, s'il y en a un
     * @param {object} [o.sealer] viendra avec le texte libre ; sans lui, un
     *   message de texte libre est REFUSE a l'envoi (voir encodeThread)
     */
    constructor(o) {
        this.relayUrl = String(o.relayUrl || '').replace(/\/$/, '');
        this.side = o.side;
        this.peer = o.peer || null;
        this.sealer = o.sealer || null;
        this.fetchImpl = o.fetchImpl || ((u, i) => fetch(u, i));
        this.onConversation = o.onConversation || (() => {});
        this.onError = o.onError || (() => {});
        this.mineMid = chatMidFor(o.matchId, o.side);
        this.theirsMid = chatMidFor(o.matchId, o.side === 1 ? -1 : 1);
        this.mine = [];
        this.theirs = [];
        this.since = 0;
        this.running = false;
        this.failures = 0;
        this.longPolling = true;
        this.lastStamp = null;
    }

    /** La conversation telle qu'elle doit s'afficher. */
    get conversation() {
        return mergeThreads(this.mine, this.theirs);
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
        // On relit d'abord NOTRE fil : une page rechargee doit retrouver ce
        // qu'elle a dit, sinon le premier message reecrirait la cle et
        // effacerait tout l'historique — un fil est depose en ENTIER.
        try {
            this.mine = await this.read(this.mineMid, { wait: false, track: false });
        } catch {
            /* relai muet au demarrage : on repartira du fil vide */
        }
        this.publish();
        this.loop();
    }

    stop() {
        this.running = false;
        if (this.peer && this.peer.onMessage) this.peer.onMessage = null;
    }

    /** Suspend ou reprend l'attente longue (voir RelayChannel.setLongPolling). */
    setLongPolling(active) {
        this.longPolling = active !== false;
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
        const msg = newMessage({ kind, side: this.side, body, quick, state });
        const next = this.mine.concat([msg]);
        const payload = await encodeThread(next, { sealer: this.sealer });
        this.mine = next;
        this.publish();
        // Le pair d'abord (immediat), le relai ensuite (reference durable).
        if (this.peer && this.peer.isOpen) this.peer.publish(msg);
        try {
            await this.post({ action: 'save', mid: this.mineMid, data: payload });
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
        const [msg] = await decodeThread(JSON.stringify({ msgs: [raw] }), { sealer: this.sealer });
        if (!msg) return;
        // Un message que NOUS avons ecrit ne revient pas : le transport est
        // direct. Le filtre est la par surete — mergeThreads deduplique de
        // toute facon par identifiant.
        if (msg.side === this.side) return;
        this.theirs = mergeThreads(this.theirs, [msg]);
        this.publish();
    }

    // -- interne --------------------------------------------------------------

    async post(fields) {
        const res = await this.fetchImpl(this.relayUrl + '/match.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(fields).toString(),
        });
        if (!res.ok) throw new Error('relai ' + res.status);
        return res;
    }

    async read(mid, { wait, track = true } = {}) {
        const fields = { action: 'load', mid };
        if (wait) fields.since = String(this.since);
        const res = await this.post(fields);
        if (track) this.since = nextSince(res.headers.get('X-Match-Mtime'), this.since);
        return decodeThread(await res.text(), { sealer: this.sealer });
    }

    async loop() {
        let first = true;
        while (this.running) {
            try {
                this.theirs = await this.read(this.theirsMid, {
                    wait: !first && this.longPolling !== false,
                });
                first = false;
                this.failures = 0;
                this.publish();
                if (this.longPolling === false) await sleep(IDLE_POLL_MS);
            } catch (err) {
                if (!this.running) return;
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
