// Construction du catalogue mogichex a partir des entrees brutes de jocly2.
//
// Tout ce qui est ici est PUR : on recoit les tableaux d'entrees deja charges
// et on rend l'objet catalogue. Aucun acces disque, donc testable sans dist
// jocly ni checkout de jocly2 (voir tests/test-catalog.mjs).
//
// Forme d'une entree source (verifiee sur jocly2 4d6d1ce) :
//   { name, modelScripts, viewScripts, config: { status, model, view } }
// avec model = { "title-en", summary, thumbnail, module, rules, credits,
//                levels, obsolete, ... } et view = { skins, preferredRatio, ... }.
// Le resume ET les regles sont deja localises a la source, soit en chaine
// (ancien format), soit en objet { en, fr, ... }.

export const CATALOG_VERSION = 1;

/**
 * Normalise un champ qui peut etre une chaine ou un objet { locale: texte }.
 * Rend TOUJOURS un objet { locale: texte } : le catalogue est un artefact
 * multilingue, la reduction a une langue se fait a l'affichage (js/i18n.js).
 * Une chaine nue est consideree comme de l'anglais, comme dans jocly.
 */
export function normalizeLocalized(value, fallbackLocale = 'en') {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') {
        return value.length ? { [fallbackLocale]: value } : null;
    }
    if (typeof value !== 'object') return { [fallbackLocale]: String(value) };
    const out = {};
    for (const [loc, txt] of Object.entries(value)) {
        if (typeof txt === 'string' && txt.length) out[loc] = txt;
    }
    return Object.keys(out).length ? out : null;
}

/**
 * Choisit le skin 2D par defaut.
 *
 * jocly marque explicitement les skins tridimensionnels par "3d": true — c'est
 * plus sur que de se fier au prefixe du nom (l'etude proposait "commence par
 * skin2d", mais des skins 2D s'appellent alquerque2d, draughts2d...).
 * Mesure sur jocly2 4d6d1ce : les 128 jeux ont au moins un skin non-3d.
 * Le repli sur le premier skin reste la par principe, et il est signale.
 */
export function pick2dSkin(skins) {
    const list = Array.isArray(skins) ? skins : [];
    if (!list.length) return { name: null, is2d: false, fallback: true };
    const flat = list.find((s) => s && s['3d'] !== true);
    if (flat) return { name: flat.name, is2d: true, fallback: false };
    return { name: list[0].name, is2d: false, fallback: true };
}

/** Entree du catalogue pour un jeu, ou null si l'entree source est inutilisable. */
export function buildEntry(raw, { ineligible }) {
    if (!raw || !raw.name || !raw.config || !raw.config.model) return null;
    const model = raw.config.model;
    const view = raw.config.view || {};
    const skin = pick2dSkin(view.skins);
    const isIneligible = ineligible.has(raw.name);
    return {
        name: raw.name,
        module: model.module || null,
        title: normalizeLocalized(model['title-en']) || { en: raw.name },
        summary: normalizeLocalized(model.summary),
        thumbnail: model.thumbnail || null,
        rules: normalizeLocalized(model.rules),
        credits: normalizeLocalized(model.credits),
        skins: (view.skins || []).map((s) => ({
            name: s.name,
            title: s.title || s.name,
            is3d: s['3d'] === true,
        })),
        defaultSkin: skin.name,
        defaultSkinIs2d: skin.is2d,
        ratio: typeof view.preferredRatio === 'number' ? view.preferredRatio : null,
        // jocly n'accepte viewAs que pour les jeux qui se declarent
        // switchable : sans ce champ, on ne saurait pas s'il faut proposer
        // « voir en tant que joueur A/B » ni imposer PLAYER_A par defaut.
        switchable: view.switchable === true,
        levels: Array.isArray(model.levels) ? model.levels.map((l) => l.name) : [],
        obsolete: model.obsolete === true,
        // 'phone' = jouable au doigt sur telephone ; 'tablet' = reserve aux
        // grands ecrans (mais toujours atteignable via « afficher tous les
        // jeux » — un filtre qu'on ne peut pas desactiver est vecu comme une
        // panne, cf. etude §4.3).
        tier: isIneligible ? 'tablet' : 'phone',
    };
}

/**
 * @param {Array<{module:string, games:Array}>} modules entrees brutes par module
 * @param {{ineligible:string[], source?:object}} opts
 * @returns {{catalog:object, warnings:string[]}}
 * @throws si un nom de la liste d'inegibilite n'existe pas (faute de frappe)
 */
export function buildCatalog(modules, opts) {
    const ineligible = new Set(opts.ineligible || []);
    const warnings = [];
    const games = [];
    const seen = new Set();

    for (const mod of modules) {
        for (const raw of mod.games || []) {
            const entry = buildEntry(raw, { ineligible });
            if (!entry) {
                warnings.push(`entree ignoree dans ${mod.module} (name/config manquant)`);
                continue;
            }
            if (seen.has(entry.name)) {
                warnings.push(`nom duplique ignore : ${entry.name}`);
                continue;
            }
            seen.add(entry.name);
            if (!entry.module) entry.module = mod.module;
            if (!entry.defaultSkinIs2d) {
                warnings.push(`aucun skin 2D pour ${entry.name} : repli sur ${entry.defaultSkin}`);
            }
            if (!entry.rules) warnings.push(`aucune regle pour ${entry.name}`);
            games.push(entry);
        }
    }

    // Fail-fast : un nom mal orthographie dans la liste n'exclurait rien du
    // tout et le jeu apparaitrait sur telephone sans qu'on s'en apercoive.
    const unknown = [...ineligible].filter((n) => !seen.has(n));
    if (unknown.length) {
        throw new Error(
            `data/phone-ineligible.json : ${unknown.length} nom(s) inconnu(s) du catalogue jocly : ` +
            unknown.join(', ')
        );
    }

    // Tri : module puis titre anglais (l'ordre d'affichage reste decide par
    // l'interface, mais un catalogue trie rend les diffs de build lisibles).
    games.sort((a, b) =>
        a.module === b.module
            ? String(a.title.en).localeCompare(String(b.title.en), 'en')
            : String(a.module).localeCompare(String(b.module), 'en')
    );

    const byModule = {};
    for (const g of games) byModule[g.module] = (byModule[g.module] || 0) + 1;

    return {
        catalog: {
            catalogVersion: CATALOG_VERSION,
            source: opts.source || null,
            counts: {
                games: games.length,
                modules: Object.keys(byModule).length,
                phone: games.filter((g) => g.tier === 'phone').length,
                tablet: games.filter((g) => g.tier === 'tablet').length,
                obsolete: games.filter((g) => g.obsolete).length,
                byModule,
            },
            games,
        },
        warnings,
    };
}
