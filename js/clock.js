// L'horloge — logique PURE, testee sous Node. Aucun DOM, aucun timer : le
// temps entre par le parametre `at`, ce qui rend le decompte reproductible.
//
// MODELE REPRIS DE JOCLYBOARD (via Tabulon) : deux compteurs, un seul tourne,
// l'increment est credite a CELUI QUI VIENT DE JOUER au moment ou il rend la
// main. C'est la regle Fischer, la plus courante, et la seule qui ne demande
// pas d'expliquer quoi que ce soit avant de commencer.
//
// ── Ce que cette horloge ne fait PAS, et pourquoi ────────────────────────────
//
// Elle ne s'applique qu'aux parties LOCALES (ordinateur ou deux joueurs sur cet
// appareil). En partie a distance, les deux appareils ne voient pas le meme
// instant : le coup de l'adversaire est date de l'instant ou il ARRIVE, pas de
// celui ou il a ete joue. Le retard du reseau, une page mise en veille par le
// systeme, un rechargement — chacun deduirait du temps a l'autre, et deux
// pendules afficheraient deux verites. Une horloge a distance demande que le
// temps soit porte par l'enveloppe et arbitre d'un seul cote ; c'est un autre
// chantier, avec un autre format. Tant qu'il n'est pas fait, l'horloge est
// masquee des qu'un camp est distant plutot qu'affichee approximativement.
//
// Elle n'interrompt pas non plus la partie d'autorite. La chute du drapeau est
// SIGNALEE (onFlag) ; c'est l'appelant qui decide quoi en faire. jocly ignore
// tout de l'horloge : lui faire croire a une fin de partie demanderait de
// mentir a getFinished(), ce qui casserait la sauvegarde et la reprise.

/**
 * Les cadences proposees. Volontairement peu nombreuses : une liste de
 * quinze cadences sur un ecran de telephone, c'est un menu qu'on referme.
 *
 * `id` est ce qui est memorise ; changer un libelle n'invalide donc pas les
 * preferences deja enregistrees.
 */
export const CLOCK_PRESETS = [
    { id: 'none', label: 'No clock', initial: 0, increment: 0 },
    { id: 'blitz', label: '5 min', initial: 5 * 60000, increment: 0 },
    { id: 'rapid', label: '10 min + 5 s', initial: 10 * 60000, increment: 5000 },
    { id: 'long', label: '25 min + 10 s', initial: 25 * 60000, increment: 10000 },
];

export function presetById(id) {
    return CLOCK_PRESETS.find((p) => p.id === id) || CLOCK_PRESETS[0];
}

/**
 * Formate une duree.
 *
 * Sous la minute on passe aux dixiemes : c'est le moment ou la pendule est
 * REGARDEE, et « 0:04 » fige pendant une seconde entiere alors qu'il reste
 * peut-etre deux dixiemes. Au-dessus, les dixiemes ne seraient que du
 * clignotement.
 *
 * Le temps negatif est ramene a zero : un compteur qui affiche « -0:03 » dit
 * a la fois que le temps est ecoule et qu'il continue, ce qui est faux.
 */
export function formatClock(ms) {
    const total = Math.max(0, Math.floor(ms));
    if (total < 60000) {
        const s = Math.floor(total / 1000);
        const tenths = Math.floor((total % 1000) / 100);
        return `0:${String(s).padStart(2, '0')}.${tenths}`;
    }
    const secs = Math.floor(total / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Deux compteurs, un seul qui tourne.
 *
 * Les camps sont designes par les valeurs de jocly (PLAYER_A = 1,
 * PLAYER_B = -1) et non par 'a'/'b' : c'est ce que rend getTurn(), donc il n'y
 * a aucune conversion a faire au moment ou l'on s'en sert, donc aucune
 * occasion de se tromper de camp.
 */
export class Clock {
    /**
     * @param {{initial:number, increment?:number, at?:number}} o
     */
    constructor({ initial, increment = 0, at = Date.now() }) {
        this.initial = initial;
        this.increment = increment;
        this.left = { 1: initial, '-1': initial };
        this.running = null; // camp dont le compteur tourne, ou null
        this.since = at;
        this.flagged = null; // camp dont le temps est epuise, une fois pour toutes
    }

    /** Fige le compteur en cours a l'instant `at`. Idempotent. */
    _settle(at) {
        if (this.running !== null) {
            this.left[this.running] -= Math.max(0, at - this.since);
            if (this.left[this.running] <= 0) {
                this.left[this.running] = 0;
                if (this.flagged === null) this.flagged = this.running;
            }
        }
        this.since = at;
    }

    /**
     * Passe la main a `side`.
     *
     * Credite l'increment a celui qui tournait — donc a celui qui vient de
     * jouer. Appele aussi pour le PREMIER tour, ou personne ne tournait
     * encore : il n'y a alors rien a crediter, et c'est bien ce qui se passe.
     *
     * Un drapeau tombe ARRETE tout : sans cela, reprendre un coup apres la
     * chute relancerait un compteur a zero et l'autre camp perdrait du temps
     * sur une partie deja close.
     */
    switchTo(side, at = Date.now()) {
        this._settle(at);
        if (this.flagged !== null) {
            this.running = null;
            return;
        }
        if (this.running !== null && this.running !== side) {
            this.left[this.running] += this.increment;
        }
        this.running = side;
    }

    /** Suspend sans rien crediter (panneau ouvert, partie finie, sortie). */
    pause(at = Date.now()) {
        this._settle(at);
        this.running = null;
    }

    /** Temps restant d'un camp, compteur en cours inclus. */
    remaining(side, at = Date.now()) {
        const base = this.left[side];
        if (this.running !== side) return Math.max(0, base);
        return Math.max(0, base - Math.max(0, at - this.since));
    }

    /**
     * Le camp dont le temps est epuise, ou null.
     *
     * Interroge sans figer : c'est appele a chaque rafraichissement
     * d'affichage, et un effet de bord a cette frequence serait le genre de
     * chose qui se remarque le jour ou l'on ajoute un second appelant.
     */
    flagOf(at = Date.now()) {
        if (this.flagged !== null) return this.flagged;
        for (const side of [1, -1]) {
            if (this.remaining(side, at) <= 0 && this.left[side] <= 0) return side;
        }
        if (this.running !== null && this.remaining(this.running, at) <= 0) return this.running;
        return null;
    }

    /**
     * Remet les deux compteurs a leur valeur de depart.
     * Appele par « recommencer » : une nouvelle partie sur une pendule deja
     * entamee n'aurait aucun sens.
     */
    reset(at = Date.now()) {
        this.left = { 1: this.initial, '-1': this.initial };
        this.running = null;
        this.flagged = null;
        this.since = at;
    }
}
