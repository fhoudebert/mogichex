// Internationalisation.
//
// Reprend le mecanisme de joclymatch — une langue courante, une fonction t(),
// une table de traductions, et les champs de jeu qui sont soit une chaine soit
// un objet { locale: texte } — mais range les traductions dans des fichiers
// separes pour qu'AJOUTER UNE LANGUE = deposer lang/<code>.json et ajouter une
// ligne dans lang/index.json. Aucun code a modifier.
//
// Les cles de traduction sont les textes ANGLAIS, comme dans joclymatch : le
// fichier anglais peut donc rester vide, et une cle non traduite s'affiche en
// anglais plutot qu'en identifiant technique.
//
// Ce module est du JavaScript pur (aucune dependance au DOM sauf dans
// applyTranslations) : il est teste directement sous Node.

const FALLBACK = 'en';

let locales = [{ code: 'en', label: 'English' }];
let table = {};
let current = FALLBACK;
const listeners = new Set();

/**
 * Reduit un champ localisable a une chaine.
 * Ordre : locale exacte (fr-CA) -> langue (fr) -> anglais -> n'importe quelle
 * traduction disponible -> chaine vide. Rend TOUJOURS une chaine : un objet
 * qui fuit jusqu'a l'affichage casse les filtres (.toLowerCase() sur un objet).
 */
export function pickLocalized(value, locale = current) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value !== 'object') return String(value);
    if (value[locale]) return value[locale];
    const lang = String(locale).split('-')[0];
    if (value[lang]) return value[lang];
    if (value[FALLBACK]) return value[FALLBACK];
    for (const v of Object.values(value)) if (typeof v === 'string' && v) return v;
    return '';
}

/** Traduit un texte d'interface (cle = texte anglais). */
export function t(text, vars) {
    let out = (table && table[text]) || text;
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.split('{' + k + '}').join(v);
    return out;
}

export function getLocale() {
    return current;
}

export function availableLocales() {
    return locales.slice();
}

/** Langue preferee : choix memorise, sinon langue du navigateur, sinon anglais. */
export function preferredLocale(stored, navigatorLanguages = []) {
    const known = new Set(locales.map((l) => l.code));
    if (stored && known.has(stored)) return stored;
    for (const l of navigatorLanguages) {
        if (known.has(l)) return l;
        const lang = String(l).split('-')[0];
        if (known.has(lang)) return lang;
    }
    return FALLBACK;
}

/** Enregistre la liste des langues (lang/index.json) et la table courante. */
export function configure({ locales: list, translations, locale }) {
    if (Array.isArray(list) && list.length) locales = list;
    if (translations) table = translations;
    if (locale) current = locale;
    for (const fn of listeners) fn(current);
}

export function onLocaleChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Charge lang/index.json puis lang/<code>.json et bascule l'interface. */
export async function setLocale(code, { base = 'lang' } = {}) {
    const known = locales.find((l) => l.code === code);
    if (!known) throw new Error('locale inconnue : ' + code);
    let translations = {};
    if (code !== FALLBACK) {
        const res = await fetch(`${base}/${code}.json`);
        if (res.ok) translations = await res.json();
    }
    configure({ translations, locale: code });
    return code;
}

export async function initLocales({ base = 'lang', stored, navigatorLanguages } = {}) {
    const res = await fetch(`${base}/index.json`);
    const index = await res.json();
    locales = index.locales;
    const code = preferredLocale(stored, navigatorLanguages || []);
    await setLocale(code, { base });
    return code;
}

/**
 * Traduit le document : tout element portant data-t est retraduit a partir de
 * son texte anglais d'origine (memorise au premier passage, pour que les
 * changements de langue successifs restent fideles).
 */
export function applyTranslations(root = document) {
    for (const el of root.querySelectorAll('[data-t]')) {
        if (!el.dataset.tSrc) el.dataset.tSrc = el.textContent.trim();
        el.textContent = t(el.dataset.tSrc);
    }
    for (const el of root.querySelectorAll('[data-t-placeholder]')) {
        if (!el.dataset.tSrc) el.dataset.tSrc = el.getAttribute('placeholder') || '';
        el.setAttribute('placeholder', t(el.dataset.tSrc));
    }
    for (const el of root.querySelectorAll('[data-t-label]')) {
        if (!el.dataset.tSrc) el.dataset.tSrc = el.getAttribute('aria-label') || '';
        el.setAttribute('aria-label', t(el.dataset.tSrc));
    }
    if (root === document) document.documentElement.lang = current;
}
