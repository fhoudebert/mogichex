// Service worker de mogichex.
//
// Deux strategies, delimitees par la nature des ressources :
//
//   - la COQUILLE (index.html, css, js, catalogue, langues) est pre-cachee a
//     l'installation : c'est quelques dizaines de Ko, et c'est ce qui rend
//     l'application ouvrable hors ligne ;
//   - le DIST JOCLY est cache A LA DEMANDE, requete par requete. Il pese
//     plusieurs dizaines de Mo (three.js, maillages, textures, sons) : le
//     pre-cacher entier ferait payer 128 jeux a qui en joue trois. Un jeu
//     deja joue reste donc jouable hors ligne, les autres non — c'est le
//     compromis assume (etude §7.1).
//
// Le dist est immuable pour une version donnee de l'application : on le sert
// depuis le cache sans revalidation (cache-first). La coquille est servie
// reseau d'abord avec repli cache, pour qu'une mise en ligne soit prise en
// compte des la premiere connexion.
//
// SHELL_VERSION doit changer a chaque livraison — tools/stamp-sw.mjs s'en
// charge au build pour eviter l'oubli.

const SHELL_VERSION = '202608011113-eba464d';
const SHELL_CACHE = 'mogichex-shell-' + SHELL_VERSION;
const DIST_CACHE = 'mogichex-dist-' + SHELL_VERSION;

const SHELL = [
    './',
    './index.html',
    './manifest.webmanifest',
    './css/mogichex.css',
    './js/app.js',
    './js/config.js',
    './js/dist-locator.js',
    './js/i18n.js',
    './js/device.js',
    './js/catalog.js',
    './js/catalog-view.js',
    './js/game.js',
    './app/catalog.json',
    './lang/index.json',
    './lang/en.json',
    './lang/fr.json',
    './i/icon.svg',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE).then((cache) =>
            // addAll est tout-ou-rien : une seule 404 invaliderait l'installation
            // entiere. On tolere les manquants (une icone, une langue) pour ne
            // pas rendre l'application non installable pour si peu.
            Promise.all(
                SHELL.map((url) =>
                    cache.add(url).catch((err) => console.warn('[sw] non cache :', url, err))
                )
            )
        ).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((k) => k.startsWith('mogichex-') && k !== SHELL_CACHE && k !== DIST_CACHE)
                        .map((k) => caches.delete(k))
                )
            )
            .then(() => self.clients.claim())
    );
});

// Le dist n'est plus forcement sous /dist/ : il peut etre partage avec
// joclymatch (../dist, ../jocly/dist). On le reconnait a sa STRUCTURE plutot
// qu'a son emplacement, sinon un dist voisin serait cache comme la coquille
// (revalidation a chaque requete) au lieu d'etre servi depuis le cache.
function isDist(url) {
    return /(^|\/)(dist)\//.test(url.pathname) || /\/games\/[^/]+\//.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    // Requetes vers le relai (signalisation, coups) : jamais de cache.
    if (url.origin !== self.location.origin) return;

    if (isDist(url)) {
        event.respondWith(
            caches.open(DIST_CACHE).then(async (cache) => {
                const hit = await cache.match(req);
                if (hit) return hit;
                const res = await fetch(req);
                // Ne mettre en cache que les reponses completes et valides :
                // une 206 ou une erreur figee dans le cache serait tenace.
                if (res.ok && res.status === 200) cache.put(req, res.clone());
                return res;
            })
        );
        return;
    }

    event.respondWith(
        fetch(req)
            .then((res) => {
                if (res.ok && res.status === 200) {
                    const copy = res.clone();
                    caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
                }
                return res;
            })
            .catch(async () => {
                const hit = await caches.match(req);
                if (hit) return hit;
                if (req.mode === 'navigate') {
                    const shell = await caches.match('./index.html');
                    if (shell) return shell;
                }
                throw new Error('hors ligne et absent du cache : ' + req.url);
            })
    );
});

// Purge du dist a la demande de l'application (reglages : « liberer l'espace »).
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'purge-dist') {
        event.waitUntil(caches.delete(DIST_CACHE));
    }
});
