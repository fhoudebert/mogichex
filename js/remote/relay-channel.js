// Transport du jeu a distance : les fichiers de partie de mogichex
// (deploy/match.php), en attente longue.
//
// Pas de WebRTC ici. Au tour par tour, un coup pese quelques centaines
// d'octets et la latence d'un aller-retour HTTP ne se voit pas : le relai
// suffit, et il traverse tout ce que WebRTC ne traverse pas. WebRTC viendra
// se greffer par-dessus cette meme interface, pas a sa place.

import { shouldApplyEnvelope, nextSince, backoffDelay } from './protocol.js';

export class RelayChannel {
    /**
     * @param {{relayUrl:string, matchId:string, selfKey:string,
     *          gameName?:string, onEnvelope:Function, onError?:Function,
     *          fetchImpl?:Function}} o
     */
    constructor(o) {
        this.relayUrl = String(o.relayUrl).replace(/\/$/, '');
        this.matchId = o.matchId;
        this.selfKey = o.selfKey;
        this.gameName = o.gameName || null;
        this.onEnvelope = o.onEnvelope;
        this.onError = o.onError || (() => {});
        this.fetchImpl = o.fetchImpl || ((u, i) => fetch(u, i));
        this.since = 0;
        this.lastTurns = 0;
        this.running = false;
        this.failures = 0;
    }

    endpoint(file) {
        return this.relayUrl + '/' + file;
    }

    async post(file, fields) {
        const body = new URLSearchParams(fields).toString();
        const res = await this.fetchImpl(this.endpoint(file), {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });
        if (!res.ok) throw new Error('relai ' + res.status);
        return res;
    }

    /** Publie l'etat complet de la partie. */
    async publish(envelope) {
        const res = await this.post('match.php', {
            action: 'save',
            mid: this.matchId,
            data: JSON.stringify(envelope),
        });
        // Notre propre ecriture avance la date du fichier : on la prend en
        // compte tout de suite, sinon la prochaine attente longue rendrait
        // immediatement notre propre enveloppe.
        this.since = nextSince(res.headers.get('X-Match-Mtime'), this.since);
        this.lastTurns = Math.max(this.lastTurns, envelopeTurnsOf(envelope));
        return res;
    }

    /**
     * Une lecture. Rend true si une enveloppe a ete appliquee.
     * @param {{wait?:boolean}} o wait:false demande une reponse IMMEDIATE
     *   (sans attente longue) — c'est ce qu'il faut au moment de rejoindre
     *   une partie : on veut l'etat courant tout de suite, pas dans 20 s.
     */
    async pollOnce({ wait = true } = {}) {
        const fields = { action: 'load', mid: this.matchId };
        if (wait) fields.since = String(this.since);
        const res = await this.post('match.php', fields);
        this.since = nextSince(res.headers.get('X-Match-Mtime'), this.since);
        const env = await res.json();
        const verdict = shouldApplyEnvelope(env, {
            selfKey: this.selfKey,
            lastTurns: this.lastTurns,
            gameName: this.gameName,
        });
        if (!verdict.apply) return false;
        this.lastTurns = verdict.turns;
        await this.onEnvelope(env);
        return true;
    }

    /**
     * Boucle d'ecoute. Elle tourne EN PERMANENCE, pas seulement pendant le
     * tour de l'adversaire : c'est ce qui permet de rattraper une partie
     * rechargee ou reprise sur un autre appareil.
     */
    /**
     * Suspend ou reprend l'ATTENTE LONGUE. Suspendue, la boucle ne dort pas :
     * elle ne demande plus au serveur de la faire patienter 20 s, ce qui
     * libere un processus PHP par joueur en attente — c'est tout l'interet du
     * canal pair-a-pair sur un hebergement mutualise.
     */
    setLongPolling(active) {
        this.longPolling = active !== false;
    }

    start() {
        if (this.running) return;
        this.running = true;
        if (this.longPolling === undefined) this.longPolling = true;
        const loop = async () => {
            // Premiere lecture IMMEDIATE : rattrape une partie deja commencee
            // (page rechargee, invite qui arrive en retard) sans attendre le
            // premier coup de l'adversaire.
            let first = true;
            while (this.running) {
                try {
                    await this.pollOnce({ wait: !first && this.longPolling !== false });
                    first = false;
                    // Sans attente longue, ne pas marteler le relai : le canal
                    // pair-a-pair porte deja les coups, cette boucle n'est
                    // qu'un filet de securite.
                    if (this.longPolling === false) await sleep(5000);
                    this.failures = 0;
                } catch (err) {
                    if (!this.running) return;
                    this.failures++;
                    this.onError(err, this.failures);
                    await sleep(backoffDelay(this.failures));
                }
            }
        };
        loop();
    }

    stop() {
        this.running = false;
    }
}

function envelopeTurnsOf(env) {
    const n = env && env.matchDetails && env.matchDetails.nbTurns;
    return typeof n === 'number' ? n : 0;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
