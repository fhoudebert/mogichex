# mogichex pour Android (Capacitor)

Ce dossier accueille le projet Capacitor. **Le contenu web est produit par un script** ;
la génération et la signature de l'APK restent indépendantes, par Gradle ou Android Studio.

---

## 1. Préparer le contenu web

```sh
# depuis la racine de mogichex
npm run android            # dist chessbase + application → android/www
npm run android:light      # idem, sans les ressources 3D
```

Le script (`tools/build-android.mjs`) :

1. construit le dist Jocly **limité à chessbase**, en production —
   `gulp --no-default-games --modules src/games/chessbase build --prod` ;
2. le recopie en retirant ce que mogichex ne demande jamais ;
3. recopie l'application avec un catalogue restreint à ce module ;
4. écrit `config-android.js` (chemin du dist, URL absolue du relai).

`--skip-jocly-build` réutilise un dist déjà construit. `--jocly <chemin>` si jocly2 n'est pas
dans `../jocly2`.

### Ce qui est retiré, et pourquoi

Mesuré sur jocly2 `545225a`, dist chessbase en production = **113 Mo** :

| Retiré | Poids | Justification |
|---|---|---|
| `res/visuals` non cité | 11,8 Mo | 151 captures 600×600 promotionnelles. mogichex ne les affiche jamais — ses vignettes viennent de `res/rules/`. **Mais 32 pages de règles en citent 24** : celles-là sont conservées. |
| `scan/` | 10,3 Mo | Le moteur de dames. Les 80 jeux de chessbase n'utilisent que `uct` et `fairy-stockfish` — vérifié sur le catalogue. |
| `res/vr` | 5,6 Mo | Réalité virtuelle, sans emploi sur téléphone. |
| `.gltf/.bin/.obj/.mtl` | 18,4 Mo | **Seulement avec `--no-3d`.** |

| Variante | `www` |
|---|---|
| complète | **85 Mo** |
| `--no-3d` | **67 Mo** |

Deux pièges rencontrés en construisant ce filtre, et corrigés :

- **`three.js` reste embarqué même sans 3D.** Jocly le charge sans condition, y compris pour un
  skin 2D : le retirer donnait un `404 dist/three.js` et un plateau vide.
- **On filtre la 3D par extension, jamais par dossier.** `res/fairy` mélange modèles `.gltf` et
  planches de sprites **2D** ; retirer le dossier faisait disparaître
  `wikipedia-fairy-sprites.png`, dont les skins 2D ont besoin.

Avec `--no-3d`, les skins 3D sont aussi retirés du **catalogue** : proposer une option qui
échouerait au chargement serait pire que ne pas la proposer. Le script s'arrête si un jeu se
retrouvait sans aucun skin 2D.

---

## 2. Créer le projet Capacitor (une seule fois)

```sh
npm install --save-dev @capacitor/cli @capacitor/core @capacitor/android
npx cap init mogichex fr.biscandine.mogichex --web-dir android/www
npx cap add android
```

`capacitor.config.json` doit contenir :

```json
{
  "appId": "fr.biscandine.mogichex",
  "appName": "mogichex",
  "webDir": "android/www",
  "android": { "allowMixedContent": false }
}
```

**L'origine de l'application native n'est ni le site ni GitHub Pages.** Le relai doit donc
autoriser `https://localhost` (Android) en CORS — c'est déjà le cas dans
`deploy/signalconf.php.example`. `config-android.js` fixe l'URL absolue du relai ; le dist, lui,
est embarqué à côté de `index.html` et reste en relatif.

---

## 3. Synchroniser puis construire

```sh
npm run android          # régénère android/www
npx cap sync android     # copie www dans le projet natif
cd android && ./gradlew assembleDebug
```

APK de debug : `android/app/build/outputs/apk/debug/app-debug.apk`.

### APK signé

```sh
keytool -genkey -v -keystore mogichex.keystore -alias mogichex \
        -keyalg RSA -keysize 2048 -validity 10000

cd android && ./gradlew assembleRelease
```

avec, dans `android/app/build.gradle`, un bloc `signingConfigs` renseigné par un
`keystore.properties` **hors dépôt** (`.gitignore` couvre déjà `android/`).

Android Studio fait la même chose par *Build → Generate Signed Bundle / APK*.

---

## Licence : ce que l'APK doit embarquer

mogichex est sous **AGPL-3.0 ou ultérieure**, la bibliothèque Jocly sous AGPL-3.0, le moteur
Fairy-Stockfish sous GPL-3.0, et les illustrations de `chessbase/res` sous **CC BY-SA 3.0**.
Distribuer un APK, c'est distribuer cette œuvre combinée — trois obligations en découlent :

- **le texte des licences voyage avec le paquet.** `AGPL-3.0.txt` est déjà à la racine du dist et
  le script le conserve (vérifié) ; le `LICENSE` de mogichex est copié avec l'application ;
- **l'offre de code source doit rester accessible depuis l'application.** Les liens de la section
  *À propos* la constituent : ne pas les retirer pour alléger l'écran ;
- **l'attribution CC BY-SA** des illustrations doit apparaître — elle est dans *À propos*.

Sur les magasins : Google Play s'accommode du GPL et de l'AGPL. L'App Store d'Apple pose un
conflit connu avec ces licences, si un portage iOS devait suivre un jour.

## Ce qui n'a pas été vérifié ici

L'environnement ne dispose ni du SDK Android ni de Gradle : **aucun APK n'a été construit ni
installé**. Ce qui l'a été, c'est le contenu de `android/www`, servi et sondé dans un navigateur
mobile : un seul module, tous les groupes repliés, vignettes 10/10, règles 8/8 images, skins 2D
seuls en mode `--no-3d`, partie jouable, **zéro requête en échec**.

Restent à constater sur appareil : la taille réelle de l'APK après compression, le comportement
de la WebView Android (isolation cross-origin pour le niveau Expert, WebRTC), et l'accès au relai
depuis l'origine native.
