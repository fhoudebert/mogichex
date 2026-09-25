// Reprise de coup en partie a distance — decision pure, lien, et canal relai
// contre un faux match.php. Usage : npm test (node --test "tests/*.mjs").
//
// Le cas qui motive tout : Tabulon (cle fixe 'tabulon') reprend un coup contre
// mogichex. Avant, mogichex ignorait tout nbTurns inferieur au sien, PUIS le
// coup suivant de Tabulon (encore inferieur) : chaque camp attendait l'autre.

import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldApplyEnvelope, resolveAllowTakeback, takebackFromParam } from '../js/remote/protocol.js';
import { buildInviteLink, parseInviteLink } from '../js/remote/invite.js';
import { RelayChannel } from '../js/remote/relay-channel.js';

const env = (turns, key, time, extra = {}) => ({
    matchDetails: Object.assign({ matchId: 'm', gameName: 'classic-chess', nbTurns: turns }, extra),
    matchdata: { playedMoves: new Array(turns).fill('x'), initialBoard: null },
    time,
    key,
});
const ctx = (lastTurns, lastRemote = null) => ({ selfKey: 'moi', lastTurns, gameName: 'classic-chess', lastRemote });

test('verdict : moins de coups, enveloppe NOUVELLE de l\'adversaire = reprise appliquee', () => {
    const v = shouldApplyEnvelope(env(1, 'tabulon', 20), ctx(3, { key: 'tabulon', time: 10 }));
    assert.equal(v.apply, true);
    assert.equal(v.reason, 'takeback');
    // Recommencer (0 coup) est une reprise comme une autre.
    assert.equal(shouldApplyEnvelope(env(0, 'tabulon', 20), ctx(3, { key: 'tabulon', time: 10 })).reason, 'takeback');
});

test('verdict : moins de coups mais copie DEJA VUE ou plus ancienne = relecture en retard', () => {
    // Attente longue partie avant notre coup 3, qui rend l'enveloppe 2 deja appliquee.
    const seen = { key: 'tabulon', time: 10 };
    assert.equal(shouldApplyEnvelope(env(2, 'tabulon', 10), ctx(3, seen)).apply, false);
    assert.equal(shouldApplyEnvelope(env(1, 'tabulon', 5), ctx(3, seen)).reason, 'stale');
});

test('verdict : plus de coups toujours appliques, meme avec une horloge en retard', () => {
    // Cle fixe (Tabulon, joclymatch) + changement d'appareil : la date ne doit
    // pas bloquer un coup.
    const v = shouldApplyEnvelope(env(4, 'tabulon', 1), ctx(3, { key: 'tabulon', time: 999 }));
    assert.equal(v.apply, true);
    assert.equal(v.reason, 'new');
    assert.equal(shouldApplyEnvelope(env(3, 'tabulon', 50), ctx(3)).reason, 'stale');
});

test('reglage : le fichier fait foi, puis le lien, et interdit par defaut', () => {
    assert.equal(resolveAllowTakeback(true, false), true);
    assert.equal(resolveAllowTakeback(null, true), true);
    assert.equal(resolveAllowTakeback(null, null), false);
    assert.equal(takebackFromParam('1'), true);
    assert.equal(takebackFromParam('0'), false);
    assert.equal(takebackFromParam('oui'), null);
});

test('lien : tb ecrit explicitement dans la requete, relu, absence = null', () => {
    const base = 'https://biscandine.fr/variantes/mogichex/index.html';
    const mk = (tb) => buildInviteLink({ game: 'classic-chess', matchId: '1754035200000-AbCdEfGhIjKlMn',
        side: 'b', base, chatKey: 'c'.repeat(64), allowTakeback: tb });
    const on = mk(true), off = mk(false), none = mk(undefined);
    assert.equal(new URL(on).searchParams.get('tb'), '1');
    assert.equal(new URL(off).searchParams.get('tb'), '0');
    assert.equal(new URL(none).searchParams.has('tb'), false);
    assert.equal(new URL(on).hash, '#k=' + 'c'.repeat(64), 'la cle reste dans le fragment');
    assert.equal(parseInviteLink(on).allowTakeback, true);
    assert.equal(parseInviteLink(off).allowTakeback, false);
    assert.equal(parseInviteLink(none).allowTakeback, null);
    // Lien emis par Tabulon sur un relai joclymatch.
    const tab = 'https://biscandine.fr/variantes/joclymatch/index.php?game=go19&mid=1754035200000-AbCdEfGhIjKlMn&player=b&tb=1';
    assert.equal(parseInviteLink(tab).allowTakeback, true);
});

/** Faux match.php : un blob par partie, date d'ecriture en secondes. */
function fakeRelay() {
    const r = { stored: {}, mtime: 0 };
    r.fetch = async (url, init) => {
        const p = new URLSearchParams(init.body);
        if (p.get('action') === 'save') { r.stored = JSON.parse(p.get('data')); r.mtime += 1; }
        const body = r.stored;
        return {
            ok: true, status: 200,
            headers: { get: (h) => (h === 'X-Match-Mtime' ? String(r.mtime) : null) },
            json: async () => body,
        };
    };
    r.write = (e) => { r.stored = e; r.mtime += 1; };
    return r;
}

function channelOn(relay, applied, seen = []) {
    return new RelayChannel({
        relayUrl: 'https://exemple.fr/relai/',
        matchId: '1754035200000-AbCdEfGhIjKlMn',
        selfKey: 'moi',
        gameName: 'classic-chess',
        onSeen: (e) => seen.push(e.matchDetails.allowTakeback),
        onEnvelope: (e, v) => applied.push([e.matchDetails.nbTurns, v.reason]),
        fetchImpl: relay.fetch,
    });
}

test('canal : Tabulon reprend, puis rejoue — les DEUX sont suivis (plus de blocage)', async () => {
    const relay = fakeRelay();
    const applied = [];
    const ch = channelOn(relay, applied);

    relay.write(env(2, 'tabulon', 10));          // coup de Tabulon
    assert.equal(await ch.pollOnce({ wait: false }), true);
    await ch.publish(env(3, 'moi', 11));          // notre reponse
    relay.write(env(1, 'tabulon', 20));           // Tabulon reprend (notre coup et le sien)
    assert.equal(await ch.pollOnce(), true);
    relay.write(env(2, 'tabulon', 30));           // et joue autre chose
    assert.equal(await ch.pollOnce(), true);
    assert.deepEqual(applied, [[2, 'new'], [1, 'takeback'], [2, 'new']]);
});

test('canal : une relecture en retard apres notre coup n\'est PAS une reprise', async () => {
    const relay = fakeRelay();
    const applied = [];
    const ch = channelOn(relay, applied);
    const late = env(2, 'tabulon', 10);
    relay.write(late);
    await ch.pollOnce({ wait: false });
    await ch.publish(env(3, 'moi', 11));
    // Le serveur rend encore l'ancienne enveloppe (lecture partie avant l'ecriture).
    relay.stored = late;
    assert.equal(await ch.pollOnce(), false);
    assert.deepEqual(applied, [[2, 'new']]);
});

test('canal : notre propre reprise publiee remet le compteur, le coup suivant passe', async () => {
    const relay = fakeRelay();
    const applied = [];
    const ch = channelOn(relay, applied);
    relay.write(env(4, 'lui', 10));
    await ch.pollOnce({ wait: false });
    await ch.publish(env(2, 'moi', 11));          // reprise chez nous : 2 coups
    assert.equal(ch.lastTurns, 2);
    relay.write(env(3, 'lui', 12));               // l'adversaire joue sur la position reprise
    assert.equal(await ch.pollOnce(), true);
    assert.deepEqual(applied, [[4, 'new'], [3, 'new']]);
});

test('canal : le reglage s\'apprend meme d\'une enveloppe qui n\'apporte aucun coup', async () => {
    const relay = fakeRelay();
    const applied = [];
    const seen = [];
    const ch = channelOn(relay, applied, seen);
    relay.write(env(0, 'hote', 5, { allowTakeback: true }));   // position initiale publiee par l'hote
    assert.equal(await ch.pollOnce({ wait: false }), false);
    assert.deepEqual(seen, [true]);
    assert.deepEqual(applied, []);
});
