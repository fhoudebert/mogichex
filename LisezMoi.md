# mogichex

**mo**bile · shō**gi** · **chex** — **plus de 120 jeux de plateau, jouables du pouce.**

🇬🇧 [English version](README.md)

**mogichex, c'est [joclymatch](https://github.com/fhoudebert/joclymatch) repensé pour le
téléphone.** La même bibliothèque de jeux [Jocly](https://github.com/fhoudebert/jocly2) — les
échecs et leurs quatre-vingts variantes, le shogi, le xiangqi, les dames, des jeux de type go, le
tafl, la marelle et bien d'autres — dans une interface conçue pour un petit écran et un pouce.

- **📱 Pensé mobile, et hébergeable sur un mutualisé.** Des fichiers statiques et trois petits
  scripts PHP : ni Node, ni base de données, ni démon sur le serveur. Un hébergement web ordinaire
  suffit.
- **👥 Jouer et discuter avec de vraies personnes.** Envoyez un lien d'invitation, votre adversaire
  le touche, la partie commence. Échangez par messages en un geste, affichés dans la langue de
  chacun, ou en texte libre chiffré de bout en bout. Vous pouvez aussi affronter l'ordinateur, ou
  vous passer le téléphone.
- **🤖 Aussi une application Android.** Des APK prêts à installer, dont une version hors ligne qui
  ne touche jamais au réseau. Ou installez simplement l'application web depuis le navigateur
  (Android et iOS).

**▶ [Jouer maintenant](https://biscandine.fr/variantes/mogichex/)** ·
**▶ [APK Android](https://github.com/fhoudebert/mogichex/releases/latest/)** ·
**▶ [L'héberger soi-même](#lhéberger-soi-même)**

---

## Ce qu'on y trouve

- **Plus de 120 jeux en une douzaine de familles**, avec une recherche insensible aux accents et à
  la langue (`echecs` trouve *Échecs* comme *Chess*), et des favoris épinglés en tête de liste.
- **Fait pour le téléphone** : plateaux en 2D par défaut, téléchargement léger ; les quelques jeux
  qui exigent un très grand plateau sont masqués sur téléphone — un interrupteur les fait revenir.
- **Des règles illustrées** pour chaque jeu, avant et pendant la partie.
- **Trois adversaires** : l'ordinateur (jusqu'au niveau **Expert**, confié à
  [Fairy-Stockfish](https://github.com/fairy-stockfish/Fairy-Stockfish)), un ami sur le même
  appareil, ou un joueur à distance.
- **Le jeu à distance s'entend avec la famille** : les invitations suivent le format joclymatch,
  un joueur [Tabulon](https://github.com/fhoudebert/tabulon) ou joclymatch peut donc rejoindre
  votre partie — discussion comprise.
- **Discuter sans langue commune** : *bien joué*, *à vous de jouer*, *je m'absente*… chacun les lit dans sa
  langue. Le texte libre est chiffré sur le téléphone ; le serveur ne stocke que des octets
  illisibles.
- **Une relance discrète** : prévenez votre adversaire que c'est son tour, avec un délai de cinq
  minutes intégré.
- **Le confort habituel** : reprise de coup, liste des coups, pendule avec incrément (parties
  locales), sons, notation, styles de plateau, vue depuis l'un ou l'autre camp.
- **Français et anglais** ; ajouter une langue, c'est déposer un fichier dans `lang/`.

## L'installer

- **Application web** — ouvrez le [lien](https://biscandine.fr/variantes/mogichex/), puis *Ajouter
  à l'écran d'accueil* (Android/Chrome) ou *Partager → Sur l'écran d'accueil* (iOS/Safari). Les
  jeux déjà joués restent disponibles hors ligne.
- **APK Android** — sur la [page des versions](https://github.com/fhoudebert/mogichex/releases) :
  **multiplayer-2d** (jeu à distance) ou **offline-2d** (aucun accès réseau). Pour construire le
  vôtre, pointé vers votre propre serveur : [android/README.md](android/README.md).

## L'héberger soi-même

1. Copiez ce dépôt à côté d'une construction de [Jocly](https://github.com/fhoudebert/jocly2) :

   ```
   votre-site/
   ├── mogichex/          ← ce dépôt
   └── jocly/dist/        ← jocly2 construit avec : npx gulp build
   ```

2. Copiez les fichiers de `deploy/` (y compris `.htaccess`) dans le dossier mogichex, et renommez
   `signalconf.php.example` en `signalconf.php`.

C'est tout : l'application trouve seule le moteur de jeu et le relai. Votre serveur peut aussi
héberger les parties des joueurs Tabulon.

`.htaccess` est un fichier caché : vérifiez que votre outil de transfert le copie bien, sinon le
niveau Expert et les liens d'invitation ne fonctionneront pas.

## Documentation

| | |
|---|---|
| [README.md](README.md) | cette page, en anglais |
| [android/README.md](android/README.md) | construire et signer son propre APK |
| [DEVELOPMENT.md](DEVELOPMENT.md) | notes techniques : relai, pair-à-pair, chiffrement, construction, tests, pièges connus |

---

## Crédits

mogichex repose sur **Jocly**, créé par M. Gutierrez / J. Choain, aujourd'hui maintenu sous le nom
**[jocly2](https://github.com/fhoudebert/jocly2)**. Le niveau Expert utilise
[Fairy-Stockfish](https://github.com/fairy-stockfish/Fairy-Stockfish) de Fabian Fichter, dérivé de
Stockfish. L'interface suit celle de [joclymatch](https://github.com/fhoudebert/joclymatch).
Les illustrations sous `chessbase/res` sont sous licence **CC BY-SA 3.0**.

## Licence

**mogichex est un logiciel libre sous [GNU Affero General Public License v3](LICENSE) ou
ultérieure.** Il livre la bibliothèque Jocly à ses côtés (ou à l'intérieur, pour Android) ;
l'ensemble forme une seule œuvre AGPL-3.0. Fairy-Stockfish est sous GPL-3.0, compatible avec
l'AGPL-3.0.
