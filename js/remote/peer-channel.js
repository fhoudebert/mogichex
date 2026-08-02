// Canal pair-a-pair WebRTC, negocie a travers deploy/signal.php.
//
// Meme interface que RelayChannel du point de vue de l'appelant : on publie
// une enveloppe, on en recoit. Il ne REMPLACE pas le relai, il le double :
// voir js/remote/signalling.js pour la raison (economiser les processus PHP
// d'attente longue sur l'hebergement mutualise).
//
// Aucun TURN n'est disponible (mutualise). Deux reseaux qui ne peuvent pas se
// joindre directement ne se connecteront donc jamais : c'est prevu, on reste
// alors sur le relai, sans rien signaler a l'utilisateur — pour lui la partie
// se deroule pareil.

import {
    isOfferer,
    boxesFor,
    signalMessage,
    orderSignals,
    PEER_TIMEOUT_MS,
    ICE_SERVERS,
} from './signalling.js';

export class PeerChannel {
    /**
     * @param {{relayUrl:string, matchId:string, side:'a'|'b',
     *          onEnvelope:Function, onStateChange?:Function,
     *          fetchImpl?:Function, rtcFactory?:Function,
     *          timeoutMs?:number}} o
     *   rtcFactory permet d'injecter une fausse implementation dans les tests.
     */
    constructor(o) {
        this.relayUrl = String(o.relayUrl).replace(/\/$/, '');
        this.matchId = o.matchId;
        this.side = o.side;
        this.onEnvelope = o.onEnvelope;
        this.onStateChange = o.onStateChange || (() => {});
        this.fetchImpl = o.fetchImpl || ((u, i) => fetch(u, i));
        this.rtcFactory =
            o.rtcFactory ||
            ((cfg) => (typeof RTCPeerConnection === 'function' ? new RTCPeerConnection(cfg) : null));
        this.timeoutMs = o.timeoutMs === undefined ? PEER_TIMEOUT_MS : o.timeoutMs;
        this.state = 'idle';
        this.since = 0;
        this.running = false;
        this.pc = null;
        this.channel = null;
    }

    setState(s) {
        if (this.state === s) return;
        this.state = s;
        this.onStateChange(s);
    }

    async post(fields) {
        const res = await this.fetchImpl(this.relayUrl + '/signal.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(fields).toString(),
        });
        if (!res.ok) throw new Error('signal ' + res.status);
        return res.json();
    }

    send(type, payload) {
        const { mine } = boxesFor(this.side);
        return this.post({
            action: 'post',
            room: this.matchId,
            box: mine,
            data: JSON.stringify(signalMessage(type, payload)),
        }).catch(() => {
            /* la signalisation est au mieux : un message perdu fait echouer la
               negociation, et on reste sur le relai */
        });
    }

    /** Ouvre la negociation. Ne rejette jamais : au pire on reste sur le relai. */
    async start() {
        if (this.running) return;
        this.running = true;
        const pc = this.rtcFactory({ iceServers: ICE_SERVERS });
        if (!pc) {
            // WebKitGTK des distributions Linux n'expose pas RTCPeerConnection
            // (constate sur Tabulon). Ce n'est pas une panne : le relai suffit.
            this.setState('unsupported');
            return;
        }
        this.pc = pc;

        pc.onicecandidate = (e) => {
            if (e && e.candidate) this.send('candidate', e.candidate.toJSON ? e.candidate.toJSON() : e.candidate);
        };
        pc.onconnectionstatechange = () => {
            const s = pc.connectionState;
            if (s === 'failed' || s === 'closed' || s === 'disconnected') this.setState('closed');
        };

        const wire = (ch) => {
            this.channel = ch;
            ch.onopen = () => this.setState('open');
            ch.onclose = () => this.setState('closed');
            ch.onmessage = (e) => {
                try {
                    this.onEnvelope(JSON.parse(e.data));
                } catch (err) {
                    console.warn('message pair illisible', err);
                }
            };
        };

        if (isOfferer(this.side)) {
            // Le canal doit etre cree AVANT l'offre : c'est lui qui fait
            // apparaitre la piste de donnees dans la description de session.
            wire(pc.createDataChannel('mogichex', { ordered: true }));
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await this.send('offer', { type: offer.type, sdp: offer.sdp });
        } else {
            pc.ondatachannel = (e) => wire(e.channel);
        }

        this.setState('connecting');
        this.pump();
        setTimeout(() => {
            if (this.state !== 'open') this.setState('failed');
        }, this.timeoutMs);
    }

    /** Boucle de lecture de la boite d'en face. */
    async pump() {
        const { theirs } = boxesFor(this.side);
        while (this.running && this.state !== 'open' && this.state !== 'failed') {
            let reply;
            try {
                reply = await this.post({
                    action: 'fetch',
                    room: this.matchId,
                    box: theirs,
                    since: String(this.since),
                });
            } catch {
                return; // relai injoignable : on abandonne la negociation
            }
            if (!this.running) return;
            this.since = typeof reply.next === 'number' ? reply.next : this.since;
            for (const msg of orderSignals(reply.messages)) {
                try {
                    await this.handle(msg);
                } catch (err) {
                    console.warn('signal ignore', msg && msg.t, err);
                }
            }
        }
    }

    async handle(msg) {
        const pc = this.pc;
        if (!pc) return;
        if (msg.t === 'offer') {
            await pc.setRemoteDescription(msg.p);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await this.send('answer', { type: answer.type, sdp: answer.sdp });
        } else if (msg.t === 'answer') {
            await pc.setRemoteDescription(msg.p);
        } else if (msg.t === 'candidate') {
            await pc.addIceCandidate(msg.p);
        }
    }

    get isOpen() {
        return this.state === 'open' && this.channel && this.channel.readyState === 'open';
    }

    /** Rend true si l'enveloppe est partie par le canal pair-a-pair. */
    publish(envelope) {
        if (!this.isOpen) return false;
        try {
            this.channel.send(JSON.stringify(envelope));
            return true;
        } catch (err) {
            console.warn('envoi pair impossible', err);
            return false;
        }
    }

    stop() {
        this.running = false;
        try {
            if (this.channel) this.channel.close();
        } catch {
            /* deja ferme */
        }
        try {
            if (this.pc) this.pc.close();
        } catch {
            /* deja ferme */
        }
        this.channel = null;
        this.pc = null;
        this.setState('closed');
        // Le salon de signalisation n'a plus lieu d'etre : on le libere.
        this.post({ action: 'drop', room: this.matchId }).catch(() => {});
    }
}
