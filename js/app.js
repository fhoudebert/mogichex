// Amorcage : catalogue -> detail -> partie, plus les panneaux regles/reglages.
// Mono-fenetre : on ne fait qu'echanger la classe .is-active.

import { CONFIG, gameAssetUrl } from './config.js';
import { initLocales, setLocale, applyTranslations, availableLocales, getLocale, t, pickLocalized } from './i18n.js';
import { detectTier } from './device.js';
import { CatalogView } from './catalog-view.js';
import { filterGames } from './catalog.js';
import { GameSession, loadRules, winnerLabel } from './game.js';

const $ = (sel) => document.querySelector(sel);
const state = { catalog: null, tier: 'phone', showAll: false, entry: null, session: null };

function pref(key, def) {
    try {
        const v = localStorage.getItem(CONFIG.storagePrefix + key);
        return v === null ? def : JSON.parse(v);
    } catch {
        return def;
    }
}
function setPref(key, value) {
    try {
        localStorage.setItem(CONFIG.storagePrefix + key, JSON.stringify(value));
    } catch {
        /* stockage indisponible : on continue sans memoriser */
    }
}

function showScreen(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('is-active', s.id === id);
}

function openPanel(id) {
    const p = $(id);
    p.classList.add('is-open');
    p.setAttribute('aria-hidden', 'false');
}
function closePanels() {
    for (const p of document.querySelectorAll('.panel')) {
        p.classList.remove('is-open');
        p.setAttribute('aria-hidden', 'true');
    }
}

function updateCount() {
    const n = filterGames(state.catalog.games, {
        query: $('#search').value,
        tier: state.tier,
        showAll: state.showAll,
        locale: getLocale(),
    }).length;
    $('#game-count').textContent = `${n} ${t('games')}`;
}

// ---------------------------------------------------------------- detail

function fillSelect(select, options, selected) {
    select.textContent = '';
    for (const o of options) {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === selected) opt.selected = true;
        select.appendChild(opt);
    }
}

function openDetail(entry) {
    state.entry = entry;
    const locale = getLocale();
    $('#detail-title').textContent = pickLocalized(entry.title, locale);
    $('#detail-summary').textContent = pickLocalized(entry.summary, locale);
    const thumb = $('#detail-thumb');
    if (entry.thumbnail) thumb.src = gameAssetUrl(entry.module, entry.thumbnail);
    else thumb.removeAttribute('src');

    fillSelect(
        $('#sel-skin'),
        entry.skins.map((s) => ({ value: s.name, label: s.title + (s.is3d ? ' · 3D' : '') })),
        pref('skin.' + entry.name, entry.defaultSkin)
    );
    fillSelect(
        $('#sel-level'),
        entry.levels.map((l) => ({ value: l, label: l })),
        pref('level.' + entry.name, null)
    );
    $('#btn-rules').disabled = !entry.rules;
    showScreen('screen-detail');
}

// ---------------------------------------------------------------- partie

async function startMatch() {
    const entry = state.entry;
    const board = $('#board');
    board.textContent = '';
    $('#game-title').textContent = pickLocalized(entry.title, getLocale());
    $('#status').textContent = t('Loading…');
    showScreen('screen-game');

    setPref('skin.' + entry.name, $('#sel-skin').value);
    if ($('#sel-level').value) setPref('level.' + entry.name, $('#sel-level').value);

    const session = new GameSession(board, entry, {
        onTurn: (player, isHuman) => {
            $('#status').textContent = isHuman ? t('Your turn') : t('Thinking…');
        },
        onProgress: (p) => {
            const bar = $('#progress');
            bar.classList.toggle('is-visible', p !== null && p !== undefined);
            bar.firstElementChild.style.width = (p || 0) + '%';
        },
        onFinished: (result, Jocly) => {
            $('#status').textContent = winnerLabel(result, Jocly);
        },
        onError: (err) => {
            console.error(err);
            $('#status').textContent = t('The game engine could not be loaded.');
        },
    });
    state.session = session;
    try {
        await session.start({ side: $('#sel-side').value });
    } catch (err) {
        console.error(err);
        $('#status').textContent = t('The game engine could not be loaded.');
    }
}

async function leaveMatch() {
    if (state.session) {
        await state.session.stop();
        state.session = null;
    }
    $('#board').textContent = '';
}

// ---------------------------------------------------------------- demarrage

async function main() {
    await initLocales({
        stored: pref('locale', null),
        navigatorLanguages: navigator.languages || [navigator.language],
    });
    applyTranslations();

    state.tier = detectTier();
    state.showAll = pref('showAll', false);
    $('#show-all').checked = state.showAll;

    const res = await fetch(CONFIG.catalogUrl);
    state.catalog = await res.json();

    const view = new CatalogView($('#catalog'), { onSelect: openDetail });
    view.setTier(state.tier);
    view.setShowAll(state.showAll);
    view.setGames(state.catalog.games);
    updateCount();

    $('#search').addEventListener('input', (e) => {
        view.setQuery(e.target.value);
        updateCount();
    });
    $('#show-all').addEventListener('change', (e) => {
        state.showAll = e.target.checked;
        setPref('showAll', state.showAll);
        view.setShowAll(state.showAll);
        updateCount();
    });

    // La classe d'appareil change avec la rotation ou le redimensionnement.
    window.addEventListener('resize', () => {
        const tier = detectTier();
        if (tier !== state.tier) {
            state.tier = tier;
            view.setTier(tier);
            updateCount();
        }
    });

    $('#btn-play').addEventListener('click', startMatch);
    $('#btn-rules').addEventListener('click', () => {
        openPanel('#panel-rules');
        loadRules($('#rules'), state.entry);
    });
    $('#btn-rules-game').addEventListener('click', () => {
        openPanel('#panel-rules');
        loadRules($('#rules'), state.entry);
    });
    for (const b of document.querySelectorAll('[data-close-panel]')) b.addEventListener('click', closePanels);
    for (const b of document.querySelectorAll('[data-back]')) {
        b.addEventListener('click', async () => {
            closePanels();
            if ($('#screen-game').classList.contains('is-active')) {
                await leaveMatch();
                showScreen('screen-detail');
            } else showScreen('screen-catalog');
        });
    }

    $('#btn-settings').addEventListener('click', () => openPanel('#panel-settings'));
    fillSelect(
        $('#sel-lang'),
        availableLocales().map((l) => ({ value: l.code, label: l.label })),
        getLocale()
    );
    $('#sel-lang').addEventListener('change', async (e) => {
        await setLocale(e.target.value);
        setPref('locale', e.target.value);
        applyTranslations();
        view.render();
        updateCount();
        if (state.entry) openDetail(state.entry);
    });

    const src = state.catalog.source || {};
    $('#about').textContent = `${state.catalog.counts.games} ${t('games')} · jocly ${(src.commit || '').slice(0, 7)}`;

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch((err) => console.warn('service worker', err));
    }
}

main().catch((err) => {
    console.error(err);
    document.body.insertAdjacentHTML('afterbegin', `<pre class="fatal">${String(err)}</pre>`);
});
