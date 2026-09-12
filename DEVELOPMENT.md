# mogichex — notes de développement

Ce document rassemble les décisions techniques, les mesures et les pièges rencontrés en
construisant mogichex. Pour l'application elle-même — à quoi elle sert, comment l'installer,
comment l'héberger — voir [README.md](README.md).

Dérivée de [joclymatch](https://github.com/fhoudebert/joclymatch) pour le patron d'interface
mono-fenêtre, et de [Tabulon](https://github.com/fhoudebert/tabulon) pour les acquis techniques.

---

## État

| Étape | Contenu | État |
|---|---|---|
| 0 | Tactile jouable | **acquis** — vérifié sous Android (JoclyBoard/electron) |
| 1 | Catalogue pré-calculé (`app/catalog.json`) | **fait** |
| 2 | Liste responsive : sections, recherche, filtre d'appareil | **fait** |
| 3 | Partie solo contre l'IA, 2D par défaut, règles en panneau | **fait** — plateau rendu, coup non validé (voir ci-dessous) |
| 3b | Options de partie (`control.html`), dist partageable | **fait** |
| 4 | PWA : manifeste, service worker, cache par module | **fait, non validé sur appareil** |
| 5a | Invitations (format joclymatch) + fichiers de partie | **fait** — codec pur testé, `match.php` testé sous PHP |
| 5b | Multijoueur côté client : invitation, transport HTTP, garde reculer | **fait** — échange prouvé entre deux navigateurs |
| 5c | Canal pair-à-pair WebRTC par-dessus `signal.php` | **fait** — canal ouvert des deux côtés, attente longue supprimée |
| 6 | COOP/COEP + fairy-stockfish multi-thread | **fait** — activé, mesuré, repli signalé à l'utilisateur |
| 7 | Favoris + horloge (1er tour) | **fait** — mesuré à la sonde, non vérifié au doigt |
| 8 | Historique et retour à une position (1er tour) | **fait** — mesuré à la sonde, non vérifié au doigt |
| 9 | Messages rapides + présence (1er tour) | **fait** — protocole et transport testés, jamais joué à deux |

### Ce qui a été mesuré au navigateur

Sonde Playwright, viewport 390×844, pointeur grossier, dist jocly2 réel :

- liste correcte (12 modules, `chessbase` seul replié), cibles tactiles à **64 px**,
  `touch-action: none` sur le plateau ;
- « afficher tous les jeux » fait passer de **118 à 129** entrées ;
- règles chargées, **25 images sur 25** résolues via `{GAME}` ;
- partie lancée : plateau 2D `skin2dfull` rendu (33 canvas), statut « Your turn »,
  **aucune erreur de console** ;
- dist résolu et mémorisé, vignettes chargées ;
- panneau d'options : six lignes pour `classic-chess`, **« voir en tant que » sur joueur A**
  par défaut, réglages persistés (`{skin, notation, viewAs}`) et relus après rechargement ;
- notation et retournement **changent réellement le rendu** (empreintes de pixels du plateau
  différentes avant/après) ; recommencer ramène le statut à « Your turn » sans erreur.

Jeu à distance, mesuré de bout en bout contre un vrai `match.php` :

- aller-retour entre deux pairs : A publie, B reçoit ; B répond, A reçoit ; **aucun ne se
  réapplique sa propre enveloppe** ;
- deux navigateurs : A crée l'invitation et attend, B ouvre le lien et arrive sur le bon jeu,
  en attente ; reculer est bien masqué ;
- **un coup traverse réellement** : un état publié dans le relai est chargé par l'autre
  navigateur, qui passe à son tour.

Ce qui reste non prouvé ici : jouer ce coup **au doigt**. Playwright n'y arrive pas dans
l'iframe Jocly (voir ci-dessous), donc l'état échangé a été produit en pilotant le moteur, pas
en touchant le plateau.

Deux bugs réels ont été trouvés par cette sonde, et corrigés : `Jocly.PLAYER_A` lu avant le
chargement du moteur, et la recherche qui n'indexait que la langue affichée.

### Ce qui reste à vérifier sur appareil

**Jouer un coup n'a pas pu être validé automatiquement.** La sonde atteint bien la bonne
case (`elementFromPoint` renvoie le canvas de la pièce visée), mais ni le clic, ni le
glisser-déposer, ni le tap ne déclenchent de coup dans l'iframe Jocly. **La même limite avait
déjà été rencontrée sur Tabulon** — c'est une limite de l'outil de sonde face à cette vue,
pas un diagnostic sur le code. À vérifier au doigt sur un vrai téléphone, en priorité.

Je n'ai pas pu **confirmer visuellement** l'orientation du plateau après « voir en tant que
joueur B » : l'empreinte de pixels prouve que le rendu change, mais pas quel camp se retrouve
en bas. À contrôler d'un coup d'œil sur appareil.

Restent également non vérifiables ici : l'installation PWA, l'éviction de stockage iOS,
WebRTC entre deux réseaux, et le fonctionnement conjoint COOP/COEP + service worker. Ces
points ne sont pas couverts par les tests, et les tests ne prétendent pas le contraire.

---

## Mise en route (voir aussi README.md § Under the hood)

mogichex a besoin d'un **dist Jocly** (non versionné : il pèse plusieurs dizaines de Mo, et
un dist incohérent est la première cause de panne — voir *Pièges*). Il n'a pas à être *dans*
mogichex : au démarrage, l'application le cherche successivement dans

```
racines    dist/            embarqué dans mogichex (développement, ou copie)
           ../dist/         au même niveau que mogichex
           jocly/dist/      un checkout jocly dans mogichex
           ../jocly/dist/   un checkout jocly à côté de mogichex
suffixes   <rien>  puis  browser/
```

soit huit emplacements, chaque racine étant essayée nue puis suivie de `browser/`.

Ce niveau `browser/` n'est pas un raffinement : `npx gulp build` produit `dist/browser/`
**et** `dist/node/`, et c'est `browser/` qui contient `jocly.js`. Un checkout jocly déployé tel
quel a donc son moteur un cran plus bas :

```
variantes/jocly/dist/browser   ← le moteur est ici
variantes/joclymatch
variantes/mogichex             ← donc ../jocly/dist/browser/
```

Aplatir ce niveau côté serveur obligerait à dupliquer le dist ; c'est à mogichex de savoir
descendre d'un cran.

Tout cela permet de **partager un seul dist avec joclymatch** sur l'hébergement. L'emplacement
trouvé est mémorisé et essayé en premier la fois suivante ; s'il a disparu, la recherche
reprend sans rien casser. `window.MOGICHEX_CONFIG = { distBase: '…' }` court-circuite tout, et
`{ distRoots: ['…'] }` ajoute des racines pour une disposition non prévue.

Le statut HTTP ne suffit pas à valider un emplacement : le `.htaccess` livré renvoie
`index.html` pour toute URL sans fichier correspondant, donc un candidat absent répondrait
**200 avec la page de l'application** et le premier de la liste gagnerait toujours. La sonde
vérifie donc la **signature du contenu**.

```sh
git clone https://github.com/fhoudebert/jocly2 ../jocly2
cd ../jocly2 && npm install && npx gulp build      # produit dist/
cd - && ln -s ../jocly2/dist/browser dist           # ou ../dist, ou jocly/dist

npm run build      # catalogue + estampille du service worker + tests
npm run serve      # http://localhost:8080
```

`npm run build` enchaîne trois choses : la construction du catalogue, l'estampillage de
`SHELL_VERSION` dans `sw.js`, et les tests. L'estampillage n'est pas laissé à la discipline
de qui livre : un service worker dont l'octet ne change pas n'est jamais réinstallé, et les
visiteurs déjà venus restent sur l'ancienne coquille indéfiniment.

---

## Le catalogue

La **taille de plateau n'est pas une métadonnée Jocly** : c'est un argument littéral dans le
code du modèle (`cbBoardGeometryGrid(8,8)`). Ni `listGames()` ni `getGameConfig()` ne
permettent d'y accéder sans instancier chaque jeu — inenvisageable au démarrage sur mobile.

`tools/build-catalog.mjs` charge les `index.js` de jocly2 (du CommonJS pur, chargé par
`require()` plutôt qu'analysé au motif régulier) et produit `app/catalog.json`. Trois gains,
pas un seul :

1. le filtrage par appareil devient possible ;
2. **~129 appels `getGameConfig()` disparaissent du démarrage** ;
3. le tri module + alphabétique est gratuit, sans charger le moteur.

Mesure sur jocly2 `c50c12d` (2.8) : **129 jeux, 13 modules — 118 téléphone, 11 réservés aux
grands écrans, aucun obsolète.**

### Qui est écarté du téléphone

`data/phone-ineligible.json` — une liste explicite, pas une heuristique. Un plateau
`13×13` peut très bien passer alors qu'un `12×12` très dense ne passe pas : c'est un
jugement, il est donc écrit à la main et assumé.

**Question ouverte depuis jocly 2.8 :** le scan signale `tenjiku-shogi`, un **16×16**, comme
absent de la liste alors que `sweet16-chess`, de même taille, y figure. Ce n'est pas une erreur
du scan, c'est un arbitrage qui n'a pas encore été rendu : soit le jeu rejoint la liste, soit la
décision de l'y laisser est écrite dans le `_comment`, comme l'ont été `fantasticXIII-chess` et
les trois cylindriques. Le laisser sans mention, c'est le réexaminer à chaque build.

`node tools/scan-geometry.mjs` aide à **réexaminer** cette liste quand jocly2 gagne des jeux :
il lit les constructeurs de géométrie et signale les désaccords avec la liste. Ce n'est
qu'une aide — les désaccords actuels (`fantasticXIII-chess` en 13×13, les trois jeux
cylindriques) sont des **décisions**, pas des oublis.

Un nom inconnu dans la liste **fait échouer le build**. Sans ce garde-fou, `terachess` écrit
au lieu de `tera-chess` n'exclurait rien et le jeu apparaîtrait sur téléphone sans que
personne ne s'en aperçoive — c'est exactement ce qui s'est produit lors de la première
rédaction de la liste.

### Le filtre est toujours désactivable

Le réglage « afficher tous les jeux » reste accessible en permanence. Un utilisateur de
téléphone qui veut son 16×16 doit pouvoir l'obtenir, quitte à zoomer : **un filtre qu'on ne
peut pas désactiver est vécu comme une panne.**

La classe d'appareil est détectée par **capacité** (petit côté du viewport + finesse du
pointeur), pas par user-agent — qui ment, se périme, et ne dit rien d'une fenêtre
redimensionnée.

---

## 2D par défaut

Chaque jeu déclare ses skins avec un drapeau `"3d": true` explicite. On retient **le premier
skin non-3D** — plus fiable que le préfixe du nom, puisque des skins 2D s'appellent
`alquerque2d` ou `draughts2d`. Mesure : **les 129 jeux ont au moins un skin non-3D**, donc
aucun n'est laissé de côté.

Ce n'est pas qu'une affaire de performance : la 2D **évite tout three.js**, et donc toute la
surface de risque de ses montées de version (un jeu importé a déjà échoué sur
`THREE.CubeGeometry`, supprimé en r125 alors que jocly2 est en r185).

---

## Langues

`en` / `fr` au départ. **Ajouter une langue = déposer `lang/<code>.json` et ajouter une ligne
dans `lang/index.json`.** Aucun code à modifier, aucune reconstruction.

Les clés de traduction **sont les textes anglais** : une clé non traduite s'affiche en
anglais plutôt qu'en identifiant technique, et `lang/en.json` reste vide par construction.

Deux mécanismes distincts, à ne pas confondre :

- **l'interface** est traduite par `t()` sur les éléments portant `data-t` ;
- **les champs de jeu** (titre, résumé, chemin des règles) sont déjà localisés à la source
  dans jocly2 — soit une chaîne, soit un objet `{en, fr, …}`. `pickLocalized()` les réduit
  (locale exacte → langue → anglais → n'importe quelle traduction → chaîne vide) et rend
  **toujours une chaîne** : un objet qui fuit jusqu'à l'affichage casse les filtres
  (`.toLowerCase()` sur un objet), panne déjà rencontrée sur Tabulon.

Mesure : **les 129 jeux** ont désormais un résumé français dans jocly2 — c'étaient 107 sur 128
avant la 2.8.

Le tri alphabétique suit la **langue affichée**, pas l'anglais.

---

## Invitations

**Le format est celui de joclymatch**, à la lettre :

```
<racine>/index.html?game=<jeu>&mid=<horodatage>-<14 car.>&player=a|b[&lg=fr]
```

Conséquence voulue : un lien produit par l'une des deux applications est lisible par l'autre.
Coller un lien joclymatch dans mogichex donne le bon jeu, la bonne partie et le bon camp — seul
le fichier de partie diffère.

Un lien tronqué par un copier-coller rend `null` plutôt que de lancer une partie sur des valeurs
partielles. L'identifiant est validé côté client **avant** l'envoi, avec le même motif que le PHP.

## Jouer à distance

Trois adversaires possibles depuis l'écran de démarrage : **l'ordinateur**, **un autre joueur
sur le même appareil**, ou **un autre joueur par Internet**.

Le mode Internet ouvre un panneau d'invitation : un lien à envoyer, au format joclymatch. Vous
gardez cet appareil et le camp A, l'invité reçoit le camp B.

**Transport : les fichiers de partie (`match.php`), pas WebRTC.** Au tour par tour un coup pèse
quelques centaines d'octets et la latence d'un aller-retour HTTP ne se voit pas ; le relai
traverse par ailleurs tout ce que WebRTC ne traverse pas. WebRTC viendra se greffer *par-dessus
la même interface*, pas à sa place.

Les deux camps écrivent l'**état complet** dans le même fichier, chacun après son coup, et
relisent celui de l'autre. Publier l'état complet plutôt que le dernier coup est ce qui permet
de rejoindre une partie commencée, de recharger la page sans rien perdre, et de repartir après
une coupure. La première lecture est immédiate (rattrapage), les suivantes en attente longue.

Trois refus valent d'être notés, tous testés : l'enveloppe vide que rend `match.php` pour une
partie jamais sauvegardée n'est **pas** un état jouable ; sa propre enveloppe est ignorée (les
deux camps écrivent dans le même fichier — sans ce test, chacun se rechargerait en boucle et
interromprait son propre tour) ; une enveloppe sans coup nouveau ne redessine rien.

### Le canal pair-à-pair (WebRTC)

En plus du relai, **jamais à sa place**. La raison n'est pas la latence — au tour par tour,
l'attente longue livre un coup en quelques centaines de millisecondes, ce qui ne se voit pas.
C'est le **coût sur l'hébergement mutualisé** : chaque joueur en attente immobilise un processus
PHP pendant 20 s, en boucle, tant que dure la partie.

Une fois le canal ouvert, l'attente longue **s'arrête**. Le relai n'est plus sollicité que par une
écriture brève après chaque coup, pour que rechargement et reprise restent possibles. Si le canal
tombe, l'attente longue reprend. Mesuré sur 45 s d'observation après ouverture : **0 requête en
attente longue**, contre 1 avant.

La signalisation passe par `signal.php` (les deux boîtes par salon), puis le salon est libéré. Le
camp du lien d'invitation décide qui émet l'offre : sans ordre stable, les deux pairs offrent en
même temps et aucune négociation n'aboutit. La description de session est toujours appliquée avant
les candidats ICE, faute de quoi `addIceCandidate` échoue et le candidat est perdu.

**STUN public, aucun TURN** : un mutualisé ne peut pas héberger coturn. Deux réseaux qui ne se
voient pas directement ne se connecteront donc jamais — c'est prévu, on reste sur le relai, et
l'utilisateur ne voit aucune différence. Idem là où `RTCPeerConnection` n'existe pas (WebKitGTK des
distributions Linux, constaté sur Tabulon).

**Reculer et recommencer sont masqués dès qu'un camp est distant** : rejouer une position déjà
partie chez l'adversaire désynchroniserait les deux plateaux. Ce sont les deux seules commandes
de position accessibles en partie, et un garde de fond double le masquage dans les gestionnaires.

**La fin de partie est testée avant d'armer un tour.** Dans l'autre ordre, le camp qui *reçoit*
l'état final arme un tour utilisateur sur une partie déjà finie : ce tour ne se résout jamais,
donc le test de fin qui le suivait n'était jamais atteint et le message de victoire n'arrivait
pas chez celui qui avait ouvert la partie. C'est aussi l'ordre de `RunMatch()` dans
`control.html` de Jocly.

## Le niveau « Expert » et l'isolation cross-origin

45 jeux sur 129 proposent un niveau **Expert** confié à Fairy-Stockfish. Son moteur WebAssembly
est multi-thread : il exige `SharedArrayBuffer`, que les navigateurs ne donnent qu'aux pages
**cross-origin isolated**.

Sans les en-têtes, le worker refuse de démarrer *avant même de télécharger le moteur* — aucune
requête vers `stockfish.wasm` n'est jamais émise — et jocly se rabat sur l'IA native.
`deploy/.htaccess` pose donc `Cross-Origin-Opener-Policy: same-origin` et
`Cross-Origin-Embedder-Policy: require-corp`. Mesure, même position :

| | `crossOriginIsolated` | Expert |
|---|---|---|
| sans les en-têtes | `false` | **5 ms** |
| avec les en-têtes | `true` | **2418 ms** |

`require-corp` casserait toute ressource **tierce** dépourvue d'en-tête CORP. mogichex ne charge
que sa propre origine, donc rien n'est concerné dans le déploiement de référence ; le
`.htaccess` explique quoi faire si cela changeait. Vérifié : l'isolation tient **sous le service
worker**, les en-têtes le traversent, et rien d'autre ne casse.

`tools/serve.mjs` pose les mêmes en-têtes **par défaut**, pour que le développement local
reflète la production (`--no-coi` pour s'en passer).

### Quand ça n'a pas marché, on le dit

Si le moteur ne démarre pas malgré tout, jocly (branche 2.4) pose `result.fairyFallback` sur le
retour de `machineSearch`. mogichex le lit et affiche un bandeau : *« Expert » est indisponible —
vous jouez contre l'IA native (Strong)*. C'est la source **autoritaire**, venue du moteur, et non
une déduction de notre part. Annoncé **une seule fois par partie**.

Vérifié que le drapeau **traverse la frontière de l'iframe** : `FallbackToNativeAI` s'exécute
dans l'iframe, la reconstruction du résultat y ajoute `fairyFallback`, et `jocly.embed.js`
reposte l'objet entier. Mesuré sans isolation : `{engine, reason, level}` arrive intact côté hôte
dès le premier coup. Bandeau présent sans isolation, absent avec.

## La liste des jeux

**Tous les modules sont repliés par défaut.** Treize modules et jusqu'à 118 jeux : déroulée, la
liste enterre `checkers`, `tafl` ou `margo` sous `chessbase`. Repliée, elle donne d'emblée la
carte des familles disponibles, et un module s'ouvre d'un doigt. Une recherche déroule tout —
afficher des sections fermées sur des résultats qu'on vient de demander n'aurait pas de sens.

Les réglages portent une section **À propos** renvoyant aux deux dépôts : mogichex pour
l'application, jocly2 pour la bibliothèque de jeux et les moteurs.

## Options de la partie

Reprises de `control.html` de Jocly, dans un panneau accessible pendant la partie :
**voir en tant que joueur A ou B**, **style de plateau**, **sons**, **notation**,
**montrer les coups possibles**, **compléter les coups**, et **recommencer la partie**.

Une seule ligne s'affiche si le jeu la gère : `getViewOptions()` ne rend que les options
supportées, et une case sans effet est pire qu'une case absente. Mesure : `classic-chess`
expose les six, `english-draughts` n'expose pas *compléter les coups*.

**« Voir en tant que joueur A » est le défaut**, pour que le joueur voie d'emblée le plateau
de son côté. Jocly n'accepte `viewAs` que pour les jeux qui se déclarent `switchable`
(108 sur 129) — ailleurs la ligne est masquée et le réglage n'est pas envoyé.

Les choix sont mémorisés par jeu, sous une clé unique (`view.<jeu>`), et rechargés au
lancement suivant.

Deux écarts assumés par rapport à `control.html` : **reculer** en est absent (il devra rester
désactivé dès qu'un côté est distant, cf. *Pièges*), ainsi que *sauver / charger / instantané*
et le mode *ordinateur contre ordinateur*, hors sujet sur téléphone pour l'instant.

**Recommencer** appelle `rollback(0)` puis ré-arme : il n'existe pas de `match.restart()`
dans l'API Jocly, et `rollback` redessine sans rien ré-armer.

---

## Reprendre un coup

Bouton à côté de l'aide, visible seulement quand il a un sens : il y a un coup à reprendre,
c'est au tour d'un humain, et **aucun camp n'est distant**.

À deux humains on défait le dernier coup ; contre l'ordinateur, sa réponse **et** le sien. Comme
tous les jeux n'alternent pas strictement les camps et que `getPlayedMoves()` ne rend que des
coups bruts sans indication de camp, on vérifie ensuite à qui c'est le tour et on recule d'un
cran de plus si besoin — un seul `rollback` dans le cas normal, deux au pire.

**Le niveau « expert » (fairy-stockfish) n'est pas une exception.** Vérifié dans
`src/core/jocly.fairy.js` : chaque recherche envoie au worker la **FEN complète** de la position,
sans aucun historique de coups. Le moteur n'a donc aucun état à défaire.

## Règles

Accessibles depuis deux endroits — le panneau de détail avant de jouer, et le bouton `?`
pendant la partie. Les fichiers de règles de Jocly référencent leurs images par le jeton
`{GAME}` : il est remplacé par le chemin du module dans le dist, comme le fait Jocly.

---

## Android (Capacitor)

`npm run android` produit le contenu web d'une application Android : dist Jocly **limité à
chessbase** en production, application, catalogue restreint à ce module. La génération et la
signature de l'APK restent indépendantes — **voir [`android/README.md`](android/README.md)**.

| Variante | `www` |
|---|---|
| `npm run android` | 85 Mo |
| `npm run android:light` (sans 3D) | 67 Mo |

Sur 113 Mo de dist chessbase, le script retire les captures promotionnelles non citées par les
règles (11,8 Mo), le moteur de dames que chessbase n'utilise pas (10,3 Mo) et les ressources VR
(5,6 Mo) ; `--no-3d` retire en plus les modèles 3D (18,4 Mo) **et les skins 3D du catalogue**,
pour ne pas proposer d'option qui échouerait.

## Déploiement de référence

```
https://biscandine.fr/variantes/mogichex/     l'application
https://biscandine.fr/variantes/joclymatch/   joclymatch
https://biscandine.fr/variantes/jocly/dist/   le dist partagé (moteur sous dist/browser/)
```

**Aucune configuration n'est nécessaire.** Déposer `deploy/signal.php`, `deploy/match.php`,
`deploy/.htaccess` et `deploy/signalconf.php.example` (renommé en `signalconf.php`) dans
`variantes/mogichex/`, et c'est tout :

- le **dist** est trouvé en `../jocly/dist/browser/` (racine `../jocly/dist` + suffixe `browser`) ;
- le **relai** est trouvé en `.` — le répertoire de mogichex lui-même.

Mettre le relai chez mogichex plutôt que chez joclymatch a un avantage concret : **même origine,
donc aucun en-tête CORS émis ni à configurer**, ce qui est le réglage le plus sûr. Le repli
`../joclymatch` existe si vous préférez l'y déposer.

Les deux emplacements trouvés sont mémorisés et réessayés en premier. La recherche du relai est
**paresseuse** : elle n'a lieu qu'au moment de proposer une partie à distance, donc qui ne joue
que contre l'ordinateur ne paie jamais cette requête.

Mesuré sur cette arborescence reconstituée, repli mono-page du `.htaccess` actif : dist en
`../jocly/dist/browser/`, relai en `.`, vignettes chargées, invitation créée, second navigateur
qui rejoint — **sans une ligne de configuration**.

`signalconf.php` ne sert qu'aux origines *autres* que le relai : un miroir GitHub Pages, ou une
coquille native. `https://biscandine.fr` y figure déjà.

## Hébergement

**Décision : à côté de joclymatch, sur l'hébergement mutualisé.**

| Brique | Où | Coût |
|---|---|---|
| Application + dist | même hébergement | nul |
| Signalisation WebRTC | `deploy/signal.php` | nul |
| STUN | serveurs publics | nul |
| TURN | **aucun** — voir ci-dessous | nul |
| Repli de transport | relai HTTP (`fileio.php` de joclymatch) | nul |

**Pas de TURN, et c'est un choix, pas un renoncement.** Un mutualisé ne peut pas héberger de
coturn (démon permanent, ports UDP). Mais au tour par tour, un coup pèse quelques centaines
d'octets : quand WebRTC échoue, le repli sur le relai HTTP rend exactement le même service.
TURN facturerait de la bande passante pour un bénéfice qui se réduit à la latence. On ne le
déploiera (service tiers, Metered ou Cloudflare) que si l'usage prouve le besoin.

**Pourquoi le mutualisé plutôt que GitHub Pages** : Pages est statique — aucun POST, donc
aucune signalisation possible. Et surtout, le mutualisé donne la **maîtrise des en-têtes
HTTP**, donc COOP/COEP, donc l'isolation cross-origin — précisément ce qui manquait à Tabulon
sous `tauri://` et qui débloquerait fairy-stockfish multi-thread. Pages reste un bon miroir.

### `deploy/signal.php`

Une boîte aux lettres, pas un serveur. Il ne remplace pas `fileio.php` : celui-ci porte
l'**état** de la partie (un blob par match), alors que la signalisation a besoin de **deux
boîtes indépendantes par salon** (une par pair) et d'un ajout en fin de boîte pour les
candidats ICE. Les faire cohabiter dans le même fichier ferait s'écraser les deux pairs.

Installation : copier `deploy/signal.php`, `deploy/.htaccess` et `deploy/signalconf.php.example`
(renommé en `signalconf.php`) à côté de joclymatch. Placer `signals/` **hors de la racine web**
si l'hébergeur le permet ; sinon le `.htaccess` en refuse la lecture directe, ce qui n'est
qu'un repli.

Testé réellement (`php tests/test-signal.php`, 14 assertions) : boîtes indépendantes, index
de reprise, attente longue bornée à 20 s, refus des salons malformés et des traversées de
répertoire, plafond de charge, effacement — **et 40 dépôts simultanés sans perte**. Ce dernier
test ne vaut que parce qu'il discrimine : lancés en séquence les processus s'échelonnent et la
course ne se produit pas (12/12 conservés même sans verrou) ; avec un top commun et sans
`flock`, **1 message sur 40 survit**, contre 40 sur 40 avec.

Non couvert : les limites propres à l'hébergeur (`max_execution_time`, nombre de processus
concurrents). Si l'attente longue de 20 s pose problème en ligne, la réduire dans `signal.php`.

### `deploy/match.php` — les fichiers de partie

**mogichex a ses propres fichiers de partie**, à côté de `signal.php`. Il ne partage pas le
stockage de joclymatch : deux applications qui écrivent dans le même répertoire, ce sont deux
formats qui doivent rester d'accord pour toujours, et une purge de l'une qui efface les parties
de l'autre.

L'**enveloppe**, elle, reste celle de joclymatch — `{matchDetails, matchdata, time, key}` — pour
que les deux applications restent lisibles l'une par l'autre le jour où on le voudra.

Écriture **atomique** (fichier temporaire puis `rename()`) : sans elle, un `load()` concurrent lit
un fichier vide ou tronqué. Mesuré : 4 lectures incomplètes sur ~1100 sans `rename()`, **0 avec**.
Attente longue optionnelle bornée à 20 s, comme `signal.php`.

### CORS

Nécessaire seulement si l'application n'est pas servie depuis le même domaine que le relai
(GitHub Pages, ou coquille native). La liste des origines est dans `signalconf.php`.

---

## Embarquement natif à venir

L'application est écrite pour pouvoir être empaquetée telle quelle dans une coquille native
(Capacitor, TWA). Deux règles en découlent, **à tenir dans tout le code ajouté** :

1. **tout ce qui est local est référencé en relatif** (`dist/…`, `lang/…`). Une seule URL
   absolue en dur et l'application casse sous `capacitor://` ou `https://localhost` ;
2. **la seule URL absolue autorisée est celle du relai**, et elle est configurable à
   l'exécution (`window.MOGICHEX_CONFIG`) — parce que l'origine d'une application native
   n'est ni le site ni Pages, et devra donc être autorisée en CORS. Ces origines sont déjà
   dans `signalconf.php.example`.

Le front ne dépend d'**aucun PHP** : catalogue et dist sont statiques. Seul le jeu à distance
appelle le relai. C'est ce qui rend l'embarquement possible sans réécriture.

---

## Premier tour : ce que Tabulon a donné, et à quel prix

Quatre fonctions reprises de [Tabulon](https://github.com/fhoudebert/tabulon)
(branche 0.8.x), choisies pour **mesurer les changements d'interface** avant
d'engager quoi que ce soit de lourd : favoris, horloge, historique, et la part
de la discussion qui ne demande aucun chiffrement.

Ce qui rend le portage possible est déjà là et n'a pas été touché : le lien
d'invitation, l'enveloppe de partie et le motif d'identifiant accepté par le
relai sont **les mêmes des deux côtés**. Un fil de discussion déposé par
mogichex est relisible par Tabulon, et réciproquement.

### Le budget de la barre de jeu, mesuré

La barre ne porte **jamais plus de quatre icônes**. Mesure à 390 px, titre
`Chess with different armies` :

| Icônes | Largeur restante pour le titre |
|---|---|
| quatre | **166 px** |
| cinq | **114 px** |

Historique et discussion se partagent donc la quatrième place, et le partage
tombe juste : le retour arrière n'a de sens qu'en partie locale, la discussion
n'existe qu'en partie à distance. En distant, la **liste des coups reste
atteignable depuis les options** — la *lire* ne change aucune position, c'est y
*revenir* qui est interdit.

« Reprendre le coup » a quitté la barre pour le haut du panneau des coups : il
suit la fonction dont il n'est qu'un cas particulier (`rollbackTo()`), et la
barre reste à quatre.

### Favoris

Une **section épinglée**, pas un filtre : un filtre « favoris seulement »
remplacerait la liste, donc obligerait à le désactiver pour retrouver le reste.

Elle est la **seule section déroulée par défaut**, et c'est tout son intérêt —
les modules sont repliés pour donner la carte des familles, les favoris sont
ouverts pour donner les jeux.

Elle part des jeux **déjà filtrés** : sans cela, une recherche sans résultat
afficherait quand même les favoris, et « adaptés à cet écran » se retrouverait
contredit par sa propre section épinglée. Mesuré : une recherche qui ne rend
rien fait disparaître la section.

L'étoile est un **bouton à part**, avec sa propre cible de 44×64 px : ouvrir la
fiche et marquer un favori sont deux gestes différents, et les superposer
ferait rater l'un ou l'autre. Marquer un jeu ne **referme pas** les sections
ouvertes (on marque ses favoris en parcourant les modules) — vérifié à la
sonde.

### Horloge

Modèle JoclyBoard, incrément Fischer crédité à celui qui vient de jouer.
Cadence mémorisée **globalement** et non par jeu : qui joue au blitz y joue à
tous les jeux, et la régler 127 fois serait une punition.

**Coût mesuré sur le plateau : 43 px, soit 5,7 %** de la hauteur disponible à
390×844 (758 px sans horloge, 715 px avec). C'est le seul des quatre lots qui
prend de la place à la seule chose qu'on regarde ; c'est pour cela qu'il passe
en premier sur un vrai téléphone.

**Masquée dès qu'un camp est distant.** Les deux appareils ne voient pas le
même instant : le coup de l'adversaire est daté de son *arrivée*, pas de son
départ. Le retard du réseau, une page mise en veille, un rechargement —
chacun déduirait du temps à l'autre, et deux pendules afficheraient deux
vérités. Une horloge à distance demande que le temps voyage dans l'enveloppe et
soit arbitré d'un seul côté : autre format, autre chantier.

**La chute du drapeau est annoncée, pas imposée à jocly.** Le moteur ignore
tout de l'horloge ; lui faire croire à une fin de partie demanderait de mentir
à `getFinished()`, ce qui casserait la sauvegarde et la reprise. Le tour en
cours est simplement interrompu. Le drapeau ne tombe **qu'une fois** : sans
cela, reprendre un coup après la chute relancerait un compteur à zéro sur une
partie déjà close.

### Historique et retour à une position

`takeBack()` devient un cas particulier de `rollbackTo(n)`, qui garde
l'ajustement déjà payé : tous les jeux n'alternent pas strictement les camps et
`getPlayedMoves()` ne rend que des coups bruts, donc on vérifie **après** le
rollback à qui c'est le tour et on recule d'un cran de plus si la position
visée n'est pas observable (l'ordinateur rejouerait aussitôt).

La notation vient de `getMoveString(moves)`, qui accepte un tableau. Tous les
jeux ne l'implémentent pas : le repli affiche la forme brute du coup. Un
historique qui refuserait de s'ouvrir sur certains jeux serait pire qu'un
historique aride.

**Deux colonnes, chaque cellule numérotée.** Une grille « blancs / noirs »
mentirait dès qu'on sort des échecs (prise multiple aux dames, coups doubles) :
la deuxième colonne n'est pas « le camp adverse », c'est « le coup suivant ».
Mesuré : cible de 175×44 px, **26 coups visibles sans défiler** sur une partie
de 80.

### Messages rapides et présence

Porté de `remote-chat-protocol.js` de Tabulon, **au format près**.

**Deux clés, un seul écrivain chacune.** `match.php` stocke une clé → une
valeur en dernier-écrit-gagne ; écrire une discussion à deux dans la même clé
serait une lecture-modification-écriture concurrente. Chacun dépose son fil
sous `matchId-ca` / `-cb`, n'écrit que dans le sien et ne lit que celui d'en
face. Plus aucune concurrence. Vérifié : un identifiant mogichex fait 28
caractères, le suffixe reste dans le `{6,64}` du serveur et ne contient ni
point ni barre.

**Le fil part en entier à chaque message**, faute de quoi le deuxième
effacerait le premier.

**Un message rapide voyage comme identifiant**, traduit chez celui qui le lit :
deux joueurs sans langue commune se disent l'essentiel, et rien de personnel ne
circule — donc rien à chiffrer, donc ils fonctionnent dans une partie sans clé.
C'est aussi la seule forme de discussion praticable au pouce.

**Le texte libre est refusé par construction.** `encodeThread()` lève tant
qu'aucun scelleur ne lui est fourni : on ne peut pas ajouter un champ de saisie
sans avoir ajouté le chiffrement. C'est le garde-fou du lot suivant, et il est
testé.

**Transport : le pair-à-pair quand il est ouvert, le relai toujours en
écriture.** Le canal de données porte déjà les enveloppes de partie ;
l'aiguillage se fait sur l'**absence** de champ `kind` (une enveloppe
joclymatch n'en a pas), et non sur un champ ajouté aux enveloppes, qui
casserait le format. Dès que le pair est ouvert, l'attente longue de la
discussion s'arrête comme celle de la partie : sans cela, chaque joueur
immobiliserait **deux** processus PHP pendant 20 s au lieu d'un.

La conversation n'est **republiée que si elle a changé** : le fil d'en face est
relu en entier à chaque tour, et prévenir à chaque fois ferait clignoter une
pastille de « nouveau message » qui n'en est pas un.

**Hors ligne (`--offline`) :** `remotePlay:false` ⇒ `attachRelay()` n'est jamais
appelé ⇒ `state.chat` reste nul ⇒ le bouton reste masqué et aucune requête ne
sort. Un test tient l'invariant qui rend cela vrai : `attachChat()` n'est appelé
que depuis `attachRelay()`.

### Un piège nouveau, propre à ce dépôt

**Les clés de traduction sont les textes anglais** — deux usages différents du
même libellé se marchent dessus. Le message rapide « Your turn » a écrasé le
statut de partie du même nom (« À vous de jouer ») sans que rien ne le
signale. Le bouton dit désormais `Your turn!`. À surveiller à chaque ajout de
chaîne.

### Ce qui a été mesuré (sonde Playwright, 390×844, pointeur grossier)

Le dist jocly n'est pas versionné : **l'écran de jeu n'a pas de plateau**. La
sonde mesure donc la mise en page, pas le jeu, et les éléments de partie sont
révélés à la main. C'est dit, ce n'est pas masqué par des tests factices.

- 13 modules, **toutes sections repliées** au départ ;
- étoile : cible **44×64 px**, section favoris créée, en tête, déroulée, et
  **conservée après rechargement** ; sections ouvertes non refermées ;
- favori **masqué par une recherche sans résultat** ;
- quatre cadences, `none` par défaut, ligne **masquée en mode distant** et
  revenue en local ;
- horloge : **43 px**, plateau de 758 → 715 px ;
- barre : **4 icônes**, titre à 166 px (114 px à cinq) ;
- coups : cible **175×44 px**, 26 visibles sans défiler sur 80 ;
- discussion : 4 messages rapides + 4 états de présence, **aucun libellé
  tronqué**, pastille de non-lus lisible ;
- **zéro erreur de console** hors les 404 de vignettes (dist absent).

Tests : **118 assertions**, Node pur.

### Ce qui reste à voir au doigt

- **jouer un coup**, toujours : la sonde n'y arrive pas dans l'iframe jocly,
  limite déjà rencontrée sur Tabulon ;
- l'horloge qui tourne pendant une vraie recherche machine — 200 ms de
  rafraîchissement, sur batterie ;
- un retour à une position **en milieu de partie**, et le ré-armement qui suit ;
- une discussion **réellement à deux**, sur deux appareils : c'est la seule
  chose que ni les tests ni la sonde ne peuvent approcher ;
- le retour d'arrière-plan : l'application est suspendue dès qu'on change
  d'écran, et le fil est relu en entier au réveil.

---

## Structure

```
index.html              coquille mono-fenêtre (écrans + panneaux)
css/mogichex.css        mobile d'abord, cibles tactiles ≥ 44 px
js/config.js            chemins, relai, surcharge à l'exécution
js/dist-locator.js      recherche du dist (pur, testé)
js/remote/invite.js     codec d'invitation joclymatch (pur, testé)
js/remote/protocol.js   décisions du jeu à distance (pur, testé)
js/remote/relay-channel.js  transport sur match.php
js/remote/relay-locator.js  recherche du relai (pur, testé)
js/remote/signalling.js     décisions de la négociation WebRTC (pur, testé)
js/remote/peer-channel.js   canal pair-à-pair sur signal.php
js/i18n.js              t(), pickLocalized(), chargement des langues
js/device.js            classe d'appareil par capacité
js/catalog.js           filtrage, groupement (pur, testé)
js/catalog-view.js      rendu de la liste
js/favorites.js         liste des favoris, section épinglée (pur, testé)
js/clock.js             pendule : compteurs, incrément, drapeau (pur, testé)
js/history.js           mise en lignes des coups, cible d'un retour (pur, testé)
js/remote/chat-protocol.js  messages, présence, fils (pur, testé — format Tabulon)
js/remote/chat-channel.js   transport de la discussion (relai + pair-à-pair)
js/game.js              chargement Jocly, session, boucle de jeu, règles
js/app.js               navigation entre écrans
sw.js                   service worker
data/phone-ineligible.json   liste explicite des jeux réservés aux grands écrans
tools/build-catalog.mjs      extraction du catalogue (build)
tools/scan-geometry.mjs      aide à la maintenance de la liste
tools/stamp-sw.mjs           estampille SHELL_VERSION
tools/serve.mjs              serveur de développement (--no-coi)
tools/build-android.mjs      contenu web de l'application Android
tools/lib/dist-trim.mjs      quoi embarquer dans l'APK (pur, testé)
deploy/                      signal.php, match.php, .htaccess, signalconf.php.example
tests/                       Node pur + PHP réel
```

---

## Pièges (déjà payés une fois)

- **Ré-armement après changement de position.** Après un rollback, un restart ou un
  chargement, Jocly *redessine* mais ne ré-arme rien : les éléments cliquables restent
  périmés. Il faut relancer la boucle de jeu — `GameSession.rearm()`.
- **Traces d'erreur mensongères.** Jocly charge le code des jeux par `eval` indirect : les
  erreurs des modèles sont attribuées à `jocly.embed.js, ligne 1` et non au fichier fautif.
- **Un seul dist, cohérent, construit avec l'application.** Pas d'import d'extensions en v1 :
  c'est ce qui évite le scénario `CubeGeometry`/`BoxGeometry`.
- **Jamais la séquence de fermeture PHP dans un commentaire.** Elle ferme le bloc *même en
  commentaire*, et tout le reste du fichier part en texte brut. Aucun `.php` de ce dépôt n'a
  de balise fermante du tout.
- **Le plateau ne doit pas défiler.** `touch-action: none` sur le conteneur, sinon déplacer
  une pièce fait défiler la page.
- **`StaticGenerateMoves` court-circuite toute IA.** `classic-chess` a un livre d'ouverture qui
  répond en 1 à 3 ms sans consulter ni le niveau ni le moteur : mesurer un niveau sur les
  premiers coups ne mesure rien. `shako-chess` et le shogi ont le niveau Expert **sans** livre —
  ce sont eux qu'il faut prendre pour tester le moteur.
- **Tester la fin de partie AVANT d'armer un tour.** `userTurn()` ne se résout jamais sur une
  partie finie, donc tout test placé après lui est inatteignable.
- **`abortUserTurn()` fait *rejeter* le `userTurn()` en cours** (« User input aborted »).
  C'est une interruption voulue, pas une panne : sans la distinguer, changer une option de
  vue affichait « le moteur de jeu n'a pas pu être chargé ». Constaté à la sonde.
- **Le point d'entrée du dist est `jocly.js`, pas `jocly.embed.js`** (ce dernier ne sert qu'à
  l'intégration par iframe et n'expose rien), et c'est `dist/browser` d'un checkout jocly2,
  pas `dist`.
- **`jocly.js` devine sa base par `scripts[scripts.length - 1].src`.** Dans une page qui le
  déclare en dur, l'analyseur n'a pas encore vu les scripts suivants et l'astuce marche.
  Injecté dynamiquement, elle désigne n'importe quel autre script et tous les jeux échouent
  au chargement. `loadJocly()` redresse donc la base explicitement.
- **Reculer / recommencer devront rester désactivés** dès qu'un côté est distant — sinon
  désynchronisation garantie (leçon Tabulon).
- **Un 404 de son vient de jocly, pas d'ici.** `src/core/jocly.game.js` déclare
  `win: "winblues"` parmi ses sons par défaut, mais le dist livre `win.ogg` / `win.mp3` :
  `res/sounds/winblues.ogg` n'existe pas. Conséquence visible : une requête en échec par
  partie, et aucun son de victoire. Corriger en amont (`win: "win"`) ; ne pas chercher la
  cause dans mogichex, qui ne fait que charger la page du moteur.
- **Les clés de traduction sont les textes anglais.** Deux usages différents du même
  libellé partagent donc la même entrée : le message rapide « Your turn » a écrasé le
  statut de partie « À vous de jouer », sans avertissement. Vérifier `lang/fr.json`
  avant d'ajouter une chaîne dont le texte existe peut-être déjà ailleurs.
- **Une capture d'écran prise trop tôt ment.** Les panneaux glissent en 180 ms ; une
  sonde qui attend 100 ms photographie un panneau à mi-course et fait croire à un
  défaut de mise en page. Attendre la fin de la transition, ou la désactiver.
- **Le canal pair-à-pair porte maintenant deux sortes d'objets.** L'aiguillage se fait
  sur l'ABSENCE de `kind` (une enveloppe joclymatch n'en a pas) : ajouter un `kind` aux
  enveloppes de partie casserait la compatibilité du format avec joclymatch et Tabulon.

---

## Tests

```sh
npm test                      # 118 assertions, Node pur
```

Ce qui est testable l'est : construction du catalogue, champs localisés, filtrage,
groupement, détection d'appareil, cohérence des langues et de la coquille pré-cachée, et le
relai de signalisation de bout en bout. Le reste demande un appareil, et c'est dit.
