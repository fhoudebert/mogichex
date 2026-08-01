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

    /** Skin retenu : preference memorisee, sinon le 2D par defaut du catalogue. */
    skinName() {
        return store.get('skin.' + this.entry.name, this.entry.defaultSkin);
    }

    levelName() {
        return store.get('level.' + this.entry.name, null);
    }

    /**
     * @param {{side?: 'a'|'b'}} opts camp humain designe par 'a'/'b' et NON par
     *   Jocly.PLAYER_A : ces constantes n'existent qu'une fois le moteur
     *   charge, et l'appelant, lui, decide avant. Resoudre ici est le seul
     *   endroit ou l'on sait que Jocly est pret.
     */
    async start({ side } = {}) {
        const Jocly = await loadJocly();
        this.Jocly = Jocly;
        this.humanSide = side === 'b' ? Jocly.PLAYER_B : Jocly.PLAYER_A;
        this.match = await Jocly.createMatch(this.entry.name);
        this.config = await this.match.getConfig();

        const viewOptions = Object.assign({}, store.get('view.' + this.entry.name, {}), {
            skin: this.skinName(),
        });
        await this.match.attachElement(this.area, { viewOptions });
        this.run();
        return this.match;
    }

    setSkin(name) {
        store.set('skin.' + this.entry.name, name);
        return this.match.setViewOptions({ skin: name }).then(() => this.rearm());
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
        try {
            await this.match.abortUserTurn();
        } catch {
            /* pas de tour utilisateur en cours */
        }
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
                    if (!this.aborted && this.hooks.onError) this.hooks.onError(err);
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
