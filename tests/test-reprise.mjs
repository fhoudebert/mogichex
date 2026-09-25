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
import { isForcedPass } from '../js/game.js';
import { historyHint, canRollback, barLayout } from '../js/history.js';

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
    const v = shouldApplyEnvelope(env(4, 'tabulon', 1), ctx(3, { key: 'tabulon', time: 999, turns: 3 }));
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

test('historique : a distance, la phrase suit le reglage de la partie', () => {
    assert.equal(historyHint({ remote: true, allowTakeback: true, moves: 3 }),
        'In an online game, you can take back your last move on your turn.');
    assert.equal(historyHint({ remote: true, allowTakeback: false, moves: 3 }),
        'Going back is unavailable in an online game.');
    assert.equal(historyHint({ remote: false, moves: 3 }), 'Tap a move to go back to that position.');
    assert.equal(historyHint({ remote: true, allowTakeback: true, moves: 0 }), 'No move played yet.');
    // La liste, elle, reste inerte a distance : seule la reprise est permise.
    assert.equal(canRollback({ remote: true, moves: 3 }), false);
});

test('verdict : apres NOTRE reprise, une copie en retard de l\'enveloppe adverse ne la defait pas', () => {
    // Tabulon avait joue le 3e coup (date 20) ; nous reprenons -> 1 coup chez nous.
    const seen = { key: 'tabulon', time: 20, turns: 3 };
    assert.equal(shouldApplyEnvelope(env(3, 'tabulon', 20), ctx(1, seen)).reason, 'stale');
    // Mais le vrai coup suivant de Tabulon, joue sur la position reprise, passe.
    assert.equal(shouldApplyEnvelope(env(2, 'tabulon', 30), ctx(1, seen)).reason, 'new');
});

test('canal : notre reprise tient face a une lecture partie avant elle', async () => {
    const relay = fakeRelay();
    const applied = [];
    const ch = channelOn(relay, applied);
    const theirs = env(3, 'tabulon', 20);
    relay.write(theirs);
    await ch.pollOnce({ wait: false });
    await ch.publish(env(1, 'moi', 21));          // reprise : notre coup et la reponse
    relay.stored = theirs;                        // la lecture en vol rend l'ancien fichier
    assert.equal(await ch.pollOnce(), false);
    assert.equal(ch.lastTurns, 1);
    assert.deepEqual(applied, [[3, 'new']]);
});

test('barre : l\'historique revient a distance quand la reprise est permise, quatre icones au plus', () => {
    const count = (l) => [l.history, l.chat, l.rules].filter(Boolean).length + 1; // + options
    // Local : historique, regles, options.
    assert.deepEqual(barLayout({ playing: true }),
        { history: true, chat: false, rules: true, openHistory: false, openRules: false });
    // Distant, reprise interdite : pas d'historique dans la barre, liste par les options.
    const off = barLayout({ playing: true, remote: true, chat: true, takeback: false });
    assert.equal(off.history, false);
    assert.equal(off.openHistory, true);
    assert.equal(off.rules, true);
    // Distant, reprise permise, avec discussion : historique visible, regles dans les options.
    const on = barLayout({ playing: true, remote: true, chat: true, takeback: true });
    assert.equal(on.history, true);
    assert.equal(on.chat, true);
    assert.equal(on.rules, false);
    assert.equal(on.openRules, true);
    assert.equal(on.openHistory, false);
    // Sans discussion (pas de cle), la place suffit : les regles restent.
    const noChat = barLayout({ playing: true, remote: true, chat: false, takeback: true });
    assert.equal(noChat.history && noChat.rules, true);
    for (const l of [off, on, noChat, barLayout({ playing: true })]) assert.ok(count(l) <= 3, 'jamais plus de trois icones + retour');
});


test('prelude : seule une passe vide et unique est jouee pour l\'adversaire', () => {
    assert.equal(isForcedPass([{}]), true, 'passe du prelude (Timurid, Capablanca)');
    assert.equal(isForcedPass([{ setup: 0 }, { setup: 1 }]), false, 'choix d\'arrangement : a lui');
    assert.equal(isForcedPass([{ setup: 3 }]), false, 'choix persistant rejoue : reste a lui');
    assert.equal(isForcedPass([{ f: 12, t: 28 }]), false, 'coup unique qui deplace une piece : a lui');
    assert.equal(isForcedPass([{}, {}]), false);
    assert.equal(isForcedPass([]), false);
    assert.equal(isForcedPass(null), false);
});
