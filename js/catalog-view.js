// Rendu de la liste des jeux : sections repliables par module, recherche,
// filtre d'appareil avec echappatoire.

import { t, pickLocalized, getLocale } from './i18n.js';
import { filterGames, groupByModule, initialCollapsed } from './catalog.js';
import { favoriteGroup, isFavorite } from './favorites.js';
import { gameAssetUrl } from './config.js';

export class CatalogView {
    constructor(root, { onSelect, onToggleFavorite = null }) {
        this.root = root;
        this.onSelect = onSelect;
        this.onToggleFavorite = onToggleFavorite;
        this.games = [];
        this.favorites = [];
        this.query = '';
        this.tier = 'phone';
        this.showAll = false;
        this.collapsed = null;
    }

    /**
     * La liste des favoris a change. On NE REMET PAS `collapsed` a null :
     * marquer un jeu refermerait alors toutes les sections ouvertes, et on
     * marque justement ses favoris en parcourant les modules.
     */
    setFavorites(list) {
        this.favorites = Array.isArray(list) ? list : [];
        this.render();
    }

    setGames(games) {
        this.games = games;
        this.collapsed = null;
        this.render();
    }

    setQuery(q) {
        this.query = q;
        this.collapsed = null;
        this.render();
    }

    setTier(tier) {
        this.tier = tier;
        this.render();
    }

    setShowAll(v) {
        this.showAll = !!v;
        this.render();
    }

    render() {
        const locale = getLocale();
        const searching = this.query.trim().length > 0;
        const selected = filterGames(this.games, {
            query: this.query,
            tier: this.tier,
            showAll: this.showAll,
            locale,
        });
        const groups = groupByModule(selected, locale);
        const fav = favoriteGroup(selected, this.favorites);
        if (fav) groups.unshift(fav);
        if (this.collapsed === null) this.collapsed = initialCollapsed(groups, { searching });

        this.root.textContent = '';
        if (!groups.length) {
            const p = document.createElement('p');
            p.className = 'empty';
            p.textContent = t('No game matches your search.');
            this.root.appendChild(p);
            return;
        }
        for (const group of groups) this.root.appendChild(this.renderGroup(group, locale));
    }

    renderGroup(group, locale) {
        const section = document.createElement('section');
        section.className = 'module' + (group.favorite ? ' is-favorites' : '');
        const collapsed = this.collapsed.has(group.module);

        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'module-head';
        head.setAttribute('aria-expanded', String(!collapsed));
        head.innerHTML =
            `<span class="module-name"></span>` +
            `<span class="module-count">${group.games.length}</span>` +
            `<span class="chevron" aria-hidden="true"></span>`;
        head.querySelector('.module-name').textContent = group.favorite
            ? '\u2605 ' + t('Favorites')
            : group.module;
        head.addEventListener('click', () => {
            if (this.collapsed.has(group.module)) this.collapsed.delete(group.module);
            else this.collapsed.add(group.module);
            this.render();
        });
        section.appendChild(head);

        if (!collapsed) {
            const ul = document.createElement('ul');
            ul.className = 'games';
            for (const g of group.games) ul.appendChild(this.renderGame(g, locale));
            section.appendChild(ul);
        }
        return section;
    }

    renderGame(game, locale) {
        const li = document.createElement('li');
        li.className = 'game';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'game-btn';

        const img = document.createElement('img');
        img.className = 'thumb';
        img.loading = 'lazy';
        img.alt = '';
        if (game.thumbnail) img.src = gameAssetUrl(game.module, game.thumbnail);
        btn.appendChild(img);

        const box = document.createElement('span');
        box.className = 'game-text';
        const title = document.createElement('span');
        title.className = 'game-title';
        title.textContent = pickLocalized(game.title, locale);
        const sum = document.createElement('span');
        sum.className = 'game-summary';
        sum.textContent = pickLocalized(game.summary, locale);
        box.append(title, sum);
        btn.appendChild(box);

        if (game.tier === 'tablet') {
            const flag = document.createElement('span');
            flag.className = 'tag tag-large';
            flag.textContent = '⤢';
            flag.title = t('This game is meant for a larger screen.');
            btn.appendChild(flag);
        }

        btn.addEventListener('click', () => this.onSelect(game));
        li.appendChild(btn);

        // L'etoile est un bouton A PART, avec sa propre cible tactile :
        // ouvrir la fiche et marquer un favori sont deux gestes differents,
        // et les superposer ferait rater l'un ou l'autre.
        if (this.onToggleFavorite) {
            const star = document.createElement('button');
            star.type = 'button';
            star.className = 'fav-btn';
            const on = isFavorite(this.favorites, game.name);
            star.setAttribute('aria-pressed', String(on));
            star.setAttribute('aria-label', t(on ? 'Remove from favorites' : 'Add to favorites'));
            star.textContent = on ? '\u2605' : '\u2606';
            star.addEventListener('click', (e) => {
                e.stopPropagation();
                this.onToggleFavorite(game.name);
            });
            li.appendChild(star);
        }
        return li;
    }
}
