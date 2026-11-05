// Effacer une partie terminée du relai.
//
// ── Pourquoi ────────────────────────────────────────────────────────────────
//
// Une partie finie n'a plus rien à faire sur le relai, ni son état ni sa
// conversation. Le relai a une durée de vie (30 jours) : c'est le filet des
// parties abandonnées, pas le cas normal.
//
// ── Qui efface ──────────────────────────────────────────────────────────────
//
// Celui qui a REÇU le dernier coup : il sait que les deux côtés ont vu la fin.
// Celui qui l'a joué ne le sait pas, et effacer de son côté pourrait retirer le
// coup avant que l'autre l'ait lu. Même règle que Tabulon et joclymatch.
//
// Avec une précision propre à mogichex : la PREMIÈRE lecture d'une partie
// rouverte passe par le même chemin qu'un coup reçu. Si la partie y est déjà
// finie, rien ne dit qui a joué le dernier coup — peut-être nous, lors d'une
// visite précédente, et l'autre ne l'a peut-être pas encore vu. On n'arme donc
// que si CETTE page a vu la partie en cours avant de la voir finir.
//
// ── Quand ───────────────────────────────────────────────────────────────────
//
// En quittant la partie (retour au catalogue) ou en fermant la page
// (`pagehide`), pas à la fin : les mots échangés après le dernier coup restent
// lisibles tant qu'on est dessus. `sendBeacon`, parce qu'une requête ordinaire
// lancée à la fermeture d'une page n'a aucune garantie de partir.
//
// Le corps est du x-www-form-urlencoded : une requête « simple » au sens CORS,
// donc sans pré-vérification, ce qui compte quand l'application (GitHub Pages,
// coquille native) et le relai ne sont pas sur la même origine.

/** Suit une partie à distance pour savoir s'il faudra l'effacer. */
export class FinishWatch {
    constructor() {
        this.seenInProgress = false;
        this.armed = false;
    }

    /** Un coup local vient d'être publié : la partie était en cours. */
    noteLocalMove() {
        this.seenInProgress = true;
    }

    /**
     * Un état distant vient d'être appliqué. Rend true si l'effacement est
     * désormais armé. Une partie qui « dé-finit » (reprise de coup après la
     * fin) le désarme : son fichier sert de nouveau.
     */
    noteRemoteState(finished) {
        if (finished) {
            if (this.seenInProgress) this.armed = true;
        } else {
            this.seenInProgress = true;
            this.armed = false;
        }
        return this.armed;
    }

    /** Rend true UNE fois si l'effacement était armé (pas de second envoi). */
    take() {
        const was = this.armed;
        this.armed = false;
        return was;
    }
}

/**
 * La requête d'effacement. Par fileio.php quand il est déployé : il efface la
 * partie ET le fil (dialecte joclymatch, traduit vers match.php). Sinon par
 * match.php directement — sans fileio.php il n'y a pas de fil à effacer.
 */
export function dropRequest(relayUrl, matchId, { viaFileio = true } = {}) {
    const base = String(relayUrl || '').replace(/\/+$/, '');
    if (!base || !matchId) return null;
    const body = new URLSearchParams(viaFileio
        ? { gameioaction: 'drop', gameid: matchId }
        : { action: 'drop', mid: matchId });
    return { url: base + '/' + (viaFileio ? 'fileio.php' : 'match.php'), body };
}

/**
 * Envoie l'effacement. Rend 'beacon', 'fetch' ou null (rien n'est parti).
 * `beacon(url, body)` et `fetchImpl` sont injectés : navigator.sendBeacon et
 * fetch dans la page, des doublures dans les tests.
 */
export function sendRelayDrop(request, { beacon = null, fetchImpl = null } = {}) {
    if (!request) return null;
    try {
        if (beacon && beacon(request.url, request.body)) return 'beacon';
    } catch { /* on tente le repli */ }
    if (fetchImpl) {
        try {
            const p = fetchImpl(request.url, { method: 'POST', body: request.body, keepalive: true, mode: 'no-cors' });
            if (p && typeof p.catch === 'function') p.catch(() => {});
            return 'fetch';
        } catch { /* rien de plus à tenter */ }
    }
    return null;
}
