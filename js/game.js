// Integration du moteur Jocly : chargement paresseux, creation de partie,
// boucle de jeu, panneau de regles.

import { CONFIG, distUrl, gameAssetUrl } from './config.js';
import { t, pickLocalized, getLocale } from './i18n.js';

let joclyLoading = null;

/**
 * Charge le moteur Jocly une seule fois, a la premiere partie — pas au
 * demarrage : c'est le gros morceau, et la liste des jeux n'en a pas besoin
 * (elle lit app/catalog.json).
 *
 * Deux details qui ont couté une sonde chacun :
 *
 * 1. Le point d'entree est `jocly.js`, PAS `jocly.embed.js`. Ce dernier ne
 *    sert qu'a l'integration par iframe et n'expose rien. jocly.js declare
 *    `var Jocly = ...` au premier niveau d'un script CLASSIQUE : la variable
 *    devient globale. Le charger comme module ES ne l'exposerait pas.
 *
 * 2. jocly.js devine sa propre URL de base par
 *    `scripts[scripts.length - 1].src` — le DERNIER <script> du document au
 *    moment ou il s'execute. Dans une page qui le declare en dur, l'analyseur
 *    n'a pas encore vu les scripts suivants et l'astuce marche. Injecte
 *    dynamiquement, elle designe n'importe quel autre script (ici js/app.js)
 *    et la base pointe alors a cote : tous les jeux echouent au chargement.
 *    On REDRESSE donc explicitement la base apres coup, plutot que de compter
 *    sur l'ordre du DOM. `setBaseURL` attend un chemin absolu termine par « / »,
 *    comme celui que jocly se serait calcule.
 */
export function loadJocly() {
    if (window.Jocly) return Promise.resolve(window.Jocly);
    if (joclyLoading) return joclyLoading;
    joclyLoading = new Promise((resolve, reject) => {
        const src = distUrl('jocly.js');
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => {
            if (!window.Jocly) return reject(new Error('Jocly absent apres chargement de ' + src));
            const base = new URL(CONFIG.distBase.replace(/\/$/, '') + '/', document.baseURI).pathname;
            if (window.BrowserScriptLoader && window.BrowserScriptLoader.getBaseURL() !== base) {
                window.BrowserScriptLoader.setBaseURL(base);
            }
            resolve(window.Jocly);
        };
        s.onerror = () => reject(new Error('chargement impossible : ' + src));
        document.head.appendChild(s);
    });
    return joclyLoading;
}

const store = {
    get(key, def) {
        try {
            const v = window.localStorage.getItem(CONFIG.storagePrefix + key);
            return v === null ? def : JSON.parse(v);
        } catch {
            return def;
        }
    },
    set(key, value) {
        try {
            window.localStorage.setItem(CONFIG.storagePrefix + key, JSON.stringify(value));
        } catch {
            /* stockage plein ou evince (iOS) : la preference est perdue, pas la partie */
        }
    },
};

/**
 * Vrai pour l'erreur que jocly leve quand on interrompt volontairement un
 * tour utilisateur. Exportee pour etre testee : la reconnaitre a tort ou a
 * raison decide si l'utilisateur voit « panne du moteur » ou rien du tout.
 */
export function isAbortError(err) {
    return !!err && typeof err.message === 'string' && /aborted/i.test(err.message);
}

export class GameSession {
    /**
     * @param {HTMLElement} area conteneur du plateau
     * @param {object} entry entree de catalog.json
     * @param {object} hooks { onTurn, onProgress, onFinished, onError }
     */
    constructor(area, entry, hooks = {}) {
        this.area = area;
        this.entry = entry;
        this.hooks = hooks;
        this.match = null;
        this.humanSide = null;
        this.loopActive = false;
        this.aborted = false;
    }

    /** Options de vue memorisees pour ce jeu (skin, sons, notation, viewAs…). */
    storedViewOptions() {
        return store.get('view.' + this.entry.name, {});
    }

    saveViewOptions(opts) {
        store.set('view.' + this.entry.name, opts);
    }

    levelName() {
        return store.get('level.' + this.entry.name, null);
    }

    /**
     * Options de vue passees a attachElement.
     *
     * Deux defauts imposes ici, et un seul endroit pour les imposer :
     *   - le skin 2D du catalogue, tant que l'utilisateur n'en a pas choisi
     *     un autre (three.js n'est alors jamais charge) ;
     *   - viewAs = PLAYER_A, pour que le joueur voie toujours le plateau de
     *     SON cote au premier lancement. jocly n'accepte ce reglage que si le
     *     jeu se declare switchable ; le poser ailleurs serait ignore, voire
     *     source de confusion dans le panneau.
     */
    initialViewOptions(Jocly) {
        const saved = this.storedViewOptions();
        const opts = Object.assign({}, saved);
        if (!opts.skin) opts.skin = this.entry.defaultSkin;
        if (this.entry.switchable && opts.viewAs === undefined) opts.viewAs = Jocly.PLAYER_A;
        return opts;
    }

    async start({ side } = {}) {
        const Jocly = await loadJocly();
        this.Jocly = Jocly;
        this.humanSide = side === 'b' ? Jocly.PLAYER_B : Jocly.PLAYER_A;
        this.match = await Jocly.createMatch(this.entry.name);
        this.config = await this.match.getConfig();
        await this.match.attachElement(this.area, { viewOptions: this.initialViewOptions(Jocly) });
        // getViewOptions() ne rend QUE les options que ce jeu gere : c'est ce
        // qui permet au panneau de n'afficher ni « sons » ni « auto-complete »
        // pour un jeu qui les ignore, plutot que des cases sans effet.
        this.viewOptions = await this.match.getViewOptions();
        this.run();
        return this.match;
    }

    /**
     * Applique un lot d'options de vue et rearme.
     * jocly redessine sur setViewOptions mais ne rearme pas le tour : sans
     * rearmement, les elements cliquables restent perimes (control.html
     * rappelle RunMatch pour la meme raison).
     */
    async applyViewOptions(patch) {
        const merged = Object.assign({}, this.storedViewOptions(), patch);
        this.saveViewOptions(merged);
        await this.match.setViewOptions(patch);
        this.viewOptions = Object.assign({}, this.viewOptions, patch);
        await this.rearm();
    }

    /**
     * Recommence la partie depuis la position initiale.
     * Il n'existe PAS de match.restart() dans l'API jocly : control.html
     * fait rollback(0) puis relance sa boucle, et c'est la seule facon
     * correcte — rollback redessine mais ne rearme rien.
     */
    async restart() {
        if (!this.match) return;
        await this.match.rollback(0);
        await this.rearm();
    }

    setSkin(name) {
        return this.applyViewOptions({ skin: name });
    }

    setLevel(name) {
        store.set('level.' + this.entry.name, name);
    }

    currentLevel() {
        const levels = (this.config && this.config.model && this.config.model.levels) || [];
        const wanted = this.levelName();
        return levels.find((l) => l.name === wanted) || levels.find((l) => l.isDefault) || levels[0] || {};
    }

    /**
     * Reame la boucle apres tout changement de position (rollback, restart,
     * chargement) : jocly REDESSINE mais ne rearme rien, les elements
     * cliquables restent alors perimes. Piege deja paye une fois dans Tabulon.
     */
    async rearm() {
        if (!this.match) return;
        // abortUserTurn() ne se contente pas d'arreter l'attente : il fait
        // REJETER le userTurn() en cours (« User input aborted »). Sans ce
        // drapeau, la boucle prend cette interruption VOULUE pour une panne du
        // moteur et affiche une erreur a chaque changement d'option.
        this.aborting = true;
        try {
            await this.match.abortUserTurn();
        } catch {
            /* pas de tour utilisateur en cours */
        }
        // Laisser la rejection se propager jusqu'au catch de la boucle avant
        // de rearmer, sinon on relancerait pendant que l'ancienne boucle
        // s'arrete encore et loopActive serait remis a false juste apres.
        await new Promise((r) => setTimeout(r, 0));
        this.aborting = false;
        if (!this.loopActive) this.run();
    }

    stop() {
        this.aborted = true;
        this.loopActive = false;
        const m = this.match;
        this.match = null;
        if (!m) return Promise.resolve();
        return Promise.resolve()
            .then(() => m.abortMachineSearch && m.abortMachineSearch())
            .catch(() => {})
            .then(() => m.abortUserTurn && m.abortUserTurn())
            .catch(() => {})
            .then(() => m.detachElement && m.detachElement())
            .catch(() => {});
    }

    /** Boucle de jeu : tour humain ou recherche machine, puis test de fin. */
    run() {
        const { Jocly, match } = this;
        if (!match) return;
        this.loopActive = true;
        const next = () => {
            if (this.aborted || this.match !== match) return;
            match
                .getTurn()
                .then((player) => {
                    if (this.hooks.onTurn) this.hooks.onTurn(player, player === this.humanSide);
                    if (player === this.humanSide) return match.userTurn();
                    return match
                        .machineSearch({
                            level: this.currentLevel(),
                            progress: (p) => this.hooks.onProgress && this.hooks.onProgress(p),
                        })
                        .then((result) => {
                            if (!result || !result.move)
                                throw new Error('machineSearch n\'a produit aucun coup');
                            return match.playMove(result.move);
                        })
                        .then(() => this.hooks.onProgress && this.hooks.onProgress(null));
                })
                .then(() => match.getFinished())
                .then((result) => {
                    if (this.aborted || this.match !== match) return;
                    if (result && result.finished) {
                        this.loopActive = false;
                        if (this.hooks.onFinished) this.hooks.onFinished(result, Jocly);
                    } else next();
                })
                .catch((err) => {
                    this.loopActive = false;
                    if (this.aborted || this.match !== match) return;
                    // Interruption demandee par nous (rearm, changement
                    // d'option, redemarrage) : ce n'est pas une panne.
                    if (this.aborting || isAbortError(err)) return;
                    if (this.hooks.onError) this.hooks.onError(err);
                });
        };
        next();
    }
}

/** Libelle du vainqueur, traduit. */
export function winnerLabel(result, Jocly) {
    if (!result) return '';
    if (result.winner === Jocly.PLAYER_A) return t('Player A wins');
    if (result.winner === Jocly.PLAYER_B) return t('Player B wins');
    return t('Draw');
}

/**
 * Charge les regles d'un jeu dans un conteneur.
 * Les fichiers de regles referencent leurs images par le jeton {GAME}, que
 * jocly remplace par le chemin du module — on fait pareil, en visant le dist.
 */
export async function loadRules(container, entry) {
    const rel = pickLocalized(entry.rules, getLocale());
    container.textContent = t('Loading…');
    if (!rel) {
        container.textContent = t('No rules available for this game.');
        return false;
    }
    const base = gameAssetUrl(entry.module, '').replace(/\/$/, '');
    try {
        const res = await fetch(gameAssetUrl(entry.module, rel));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const html = (await res.text()).replace(/\{GAME\}/gi, base);
        // Contenu servi depuis notre propre dist, pas une source tierce.
        container.innerHTML = html;
        container.scrollTop = 0;
        return true;
    } catch (err) {
        container.textContent = t('No rules available for this game.');
        console.warn('regles indisponibles', entry.name, err);
        return false;
    }
}
