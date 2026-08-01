# mogichex

**mo**bile · shō**gi** · **chex** — les jeux de plateau de [Jocly](https://github.com/mi-g/jocly),
jouables au doigt, dans une application web installable.

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
| 5 | Multijoueur : signalisation, WebRTC, repli HTTP | relai livré et testé ; côté client à écrire |
| 6 | COOP/COEP + fairy-stockfish multi-thread | préparé (`.htaccess`, `serve.mjs --coi`), non activé |

### Ce qui a été mesuré au navigateur

Sonde Playwright, viewport 390×844, pointeur grossier, dist jocly2 réel :

- liste correcte (12 modules, `chessbase` seul replié), cibles tactiles à **64 px**,
  `touch-action: none` sur le plateau ;
- « afficher tous les jeux » fait passer de **115 à 126** entrées ;
- règles chargées, **25 images sur 25** résolues via `{GAME}` ;
- partie lancée : plateau 2D `skin2dfull` rendu (33 canvas), statut « Your turn »,
  **aucune erreur de console** ;
- dist résolu et mémorisé, vignettes chargées ;
- panneau d'options : six lignes pour `classic-chess`, **« voir en tant que » sur joueur A**
  par défaut, réglages persistés (`{skin, notation, viewAs}`) et relus après rechargement ;
- notation et retournement **changent réellement le rendu** (empreintes de pixels du plateau
  différentes avant/après) ; recommencer ramène le statut à « Your turn » sans erreur.

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

## Mise en route

mogichex a besoin d'un **dist Jocly** (non versionné : il pèse plusieurs dizaines de Mo, et
un dist incohérent est la première cause de panne — voir *Pièges*). Il n'a pas à être *dans*
mogichex : au démarrage, l'application le cherche successivement dans

```
dist/            embarqué dans mogichex (développement, ou copie dédiée)
../dist/         au même niveau que mogichex
jocly/dist/      un checkout jocly dans mogichex
../jocly/dist/   un checkout jocly à côté de mogichex
```

ce qui permet de **partager un seul dist avec joclymatch** sur l'hébergement. L'emplacement
trouvé est mémorisé et essayé en premier la fois suivante ; s'il a disparu, la recherche
reprend sans rien casser. `window.MOGICHEX_CONFIG = { distBase: '…' }` court-circuite tout.

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
2. **~128 appels `getGameConfig()` disparaissent du démarrage** ;
3. le tri module + alphabétique est gratuit, sans charger le moteur.

Mesure sur jocly2 `4d6d1ce` : **128 jeux, 12 modules — 117 téléphone, 11 réservés aux grands
écrans, 2 obsolètes.**

### Qui est écarté du téléphone

`data/phone-ineligible.json` — une liste explicite, pas une heuristique. Un plateau
`13×13` peut très bien passer alors qu'un `12×12` très dense ne passe pas : c'est un
jugement, il est donc écrit à la main et assumé.

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
`alquerque2d` ou `draughts2d`. Mesure : **les 128 jeux ont au moins un skin non-3D**, donc
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

Mesure : 107 jeux sur 128 ont déjà un résumé français dans jocly2.

Le tri alphabétique suit la **langue affichée**, pas l'anglais.

---

## Options de la partie

Reprises de `control.html` de Jocly, dans un panneau accessible pendant la partie :
**voir en tant que joueur A ou B**, **style de plateau**, **sons**, **notation**,
**montrer les coups possibles**, **compléter les coups**, et **recommencer la partie**.

Une seule ligne s'affiche si le jeu la gère : `getViewOptions()` ne rend que les options
supportées, et une case sans effet est pire qu'une case absente. Mesure : `classic-chess`
expose les six, `english-draughts` n'expose pas *compléter les coups*.

**« Voir en tant que joueur A » est le défaut**, pour que le joueur voie d'emblée le plateau
de son côté. Jocly n'accepte `viewAs` que pour les jeux qui se déclarent `switchable`
(107 sur 128) — ailleurs la ligne est masquée et le réglage n'est pas envoyé.

Les choix sont mémorisés par jeu, sous une clé unique (`view.<jeu>`), et rechargés au
lancement suivant.

Deux écarts assumés par rapport à `control.html` : **reculer** en est absent (il devra rester
désactivé dès qu'un côté est distant, cf. *Pièges*), ainsi que *sauver / charger / instantané*
et le mode *ordinateur contre ordinateur*, hors sujet sur téléphone pour l'instant.

**Recommencer** appelle `rollback(0)` puis ré-arme : il n'existe pas de `match.restart()`
dans l'API Jocly, et `rollback` redessine sans rien ré-armer.

---

## Règles

Accessibles depuis deux endroits — le panneau de détail avant de jouer, et le bouton `?`
pendant la partie. Les fichiers de règles de Jocly référencent leurs images par le jeton
`{GAME}` : il est remplacé par le chemin du module dans le dist, comme le fait Jocly.

---

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

## Structure

```
index.html              coquille mono-fenêtre (écrans + panneaux)
css/mogichex.css        mobile d'abord, cibles tactiles ≥ 44 px
js/config.js            chemins, relai, surcharge à l'exécution
js/dist-locator.js      recherche du dist (pur, testé)
js/i18n.js              t(), pickLocalized(), chargement des langues
js/device.js            classe d'appareil par capacité
js/catalog.js           filtrage, groupement (pur, testé)
js/catalog-view.js      rendu de la liste
js/game.js              chargement Jocly, session, boucle de jeu, règles
js/app.js               navigation entre écrans
sw.js                   service worker
data/phone-ineligible.json   liste explicite des jeux réservés aux grands écrans
tools/build-catalog.mjs      extraction du catalogue (build)
tools/scan-geometry.mjs      aide à la maintenance de la liste
tools/stamp-sw.mjs           estampille SHELL_VERSION
tools/serve.mjs              serveur de développement (--coi)
deploy/                      signal.php, .htaccess, signalconf.php.example
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

---

## Tests

```sh
npm test                      # 18 assertions, Node pur
php tests/test-signal.php     # 14 assertions, PHP réel
```

Ce qui est testable l'est : construction du catalogue, champs localisés, filtrage,
groupement, détection d'appareil, cohérence des langues et de la coquille pré-cachée, et le
relai de signalisation de bout en bout. Le reste demande un appareil, et c'est dit.
