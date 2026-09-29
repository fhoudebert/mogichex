# mogichex pour Android (Capacitor)

Ce dossier accueille le projet Capacitor. **Le contenu web est produit par un script** ; la
génération et la signature de l'APK restent indépendantes, par Gradle ou Android Studio.

Trois sections : ce qu'il faut savoir, comment mettre en place l'environnement une fois pour
toutes, puis les commandes prêtes à l'emploi.

---

# 1. Informations générales

## Deux variantes, deux usages

| Commande | Jeu à distance | 3D | `www` |
|---|---|---|---|
| `npm run android` | oui | oui | **~75 Mo** |
| `npm run android:light` | oui | non | **~52 Mo** |
| `npm run android:offline` | non | non | **~52 Mo** |

Les APK publiés sont la variante **multijoueur** et la variante **hors ligne**.

`--offline` retire l'adversaire **« un autre joueur par Internet »** : l'option disparaît de la
liste, aucun relai n'est cherché, et l'application n'émet **aucune requête sortante**. Une
préférence déjà mémorisée sur « par Internet » retombe sur l'ordinateur au lieu de bloquer
l'écran.

Des APK déjà construits sont publiés sur la
[page des versions](https://github.com/fhoudebert/mogichex/releases).

## `--site` : l'adresse publique, et pourquoi elle est nécessaire

**C'est le réglage qu'on oublie, et il ne se voit qu'au moment d'envoyer une invitation — trop
tard, et chez l'invité.**

Sous Capacitor, la page est servie depuis `https://localhost`. C'est une origine parfaitement
valide et sécurisée, mais elle **ne désigne rien chez le destinataire** : un lien d'invitation
`https://localhost/?game=…` se copie, s'envoie, et n'ouvre rien.

`--site` donne donc l'adresse publique du déploiement. `tools/build-android.mjs` en tire les deux
valeurs de `config-android.js` :

- `relayUrl` — le relai qui porte les parties ; `.` ne désigne rien sous `capacitor://` ;
- `inviteBase` — la base des liens d'invitation.

Une seule valeur suffit parce que `match.php` vit dans le répertoire de mogichex.

```sh
npm run android -- --site https://exemple.fr/mogichex
```

Par défaut : `https://www.biscandine.fr/variantes/mogichex`. L'adresse est **vérifiée avant le
build** — une adresse relative ou un `localhost` est refusé tout de suite, pas après une minute de
gulp — et **affichée à la fin** :

```
  relai          : https://exemple.fr/mogichex
  liens d'invitation : https://exemple.fr/mogichex/index.html
```

Si vous hébergez votre propre sélection de jeux, c'est **votre** adresse qu'il faut donner ici, et
les fichiers de `deploy/` doivent être en place chez vous (voir le README principal, *Host it
yourself*).

**Pour vérifier un APK déjà installé :** Réglages › À propos affiche le relai et la base des liens
réellement employés. Et corriger l'outil ne suffit pas — le contenu web est figé dans le paquet :
il faut refaire le contenu, resynchroniser, puis réassembler.

## L'origine native et le relai

L'origine de l'application n'est ni le site ni GitHub Pages : c'est `https://localhost`. Le relai
doit donc l'autoriser en CORS — c'est déjà le cas dans `deploy/signalconf.php.example`. Le dist,
lui, est embarqué à côté de `index.html` et reste en relatif. Avec `--offline`, aucun relai n'est
utilisé du tout.

## Ce que le script retire, et pourquoi

`tools/build-android.mjs` :

1. construit le dist Jocly **limité à chessbase**, en production —
   `gulp --no-default-games --modules src/games/chessbase build --prod` ;
2. le recopie en retirant ce que mogichex ne demande jamais ;
3. recopie l'application avec un catalogue restreint à ce module ;
4. écrit `config-android.js` (chemin du dist, adresses du relai et des invitations).

| Retiré | Poids | Justification |
|---|---|---|
| `res/visuals` non cité | 11,8 Mo | 151 captures 600×600 promotionnelles. mogichex ne les affiche jamais — ses vignettes viennent de `res/rules/`. **Mais 32 pages de règles en citent 24** : celles-là sont conservées. |
| `scan/` | 10,3 Mo | Le moteur de dames. Les jeux de chessbase n'utilisent que `uct` et `fairy-stockfish` — vérifié sur le catalogue. |
| `res/vr` | 5,6 Mo | Réalité virtuelle, sans emploi sur téléphone. |
| `.gltf/.bin/.obj/.mtl` | 18,4 Mo | **Seulement avec `--no-3d`.** |
| textures 3D de `chessbase/res` | 15,4 Mo | **Seulement avec `--no-3d`** : `*normalmap.jpg`, `*diffusemap.jpg`, `*normal.jpg`, `*diffuse.jpg` et les répertoires `*diffusemaps`. Elles ne sont référencées que depuis des blocs `mesh` + `materials` des `*-view.js`, c'est-à-dire des pièces tridimensionnelles. |

| Variante | `www` |
|---|---|
| complète | **~75 Mo** |
| `--no-3d` | **~52 Mo** |

Deux pièges rencontrés en construisant ce filtre, et corrigés :

- **`three.js` reste embarqué même sans 3D.** Jocly le charge sans condition, y compris pour un
  skin 2D : le retirer donnait un `404 dist/three.js` et un plateau vide.
- **On filtre la 3D par extension, jamais par dossier.** `res/fairy` mélange modèles `.gltf` et
  planches de sprites **2D** ; retirer le dossier faisait disparaître
  `wikipedia-fairy-sprites.png`, dont les skins 2D ont besoin.

Avec `--no-3d`, les skins 3D sont aussi retirés du **catalogue** : proposer une option qui
échouerait au chargement serait pire que ne pas la proposer. Le script s'arrête si un jeu se
retrouvait sans aucun skin 2D.

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

---

# 2. Comment démarrer

À faire **une seule fois**, dans cet ordre. Toutes les commandes se lancent **depuis la racine du
projet**, jamais depuis `android/`.

## 2.1 Créer le projet Capacitor

La plateforme se crée **avant** la première génération du contenu web : Capacitor refuse
d'ajouter la plateforme si `android/` contient déjà un projet, et propose de supprimer
`./android` — ce qui détruirait tout.

```sh
npm install --save-dev @capacitor/cli @capacitor/core @capacitor/android
npx cap init mogichex fr.biscandine.mogichex --web-dir www
npx cap add android
```

`capacitor.config.json`, à la racine :

```json
{
  "appId": "fr.biscandine.mogichex",
  "appName": "mogichex",
  "webDir": "www",
  "android": { "allowMixedContent": false }
}
```

`webDir` est `www`, **à la racine et non sous `android/`** : le script de construction efface son
dossier de sortie avant de le remplir, et le pointer sur `android/` emporterait la configuration
Gradle et la signature. Il s'y refuse, d'ailleurs.

## 2.2 Créer le keystore

Un APK de *debug* se signe tout seul et suffit pour essayer. Un APK **distribuable** demande votre
propre clé — et **la même pour toutes les mises à jour** : Android refuse d'installer une mise à
jour signée par une autre clé. Perdre ce fichier, c'est perdre la possibilité de mettre à jour
l'application chez ceux qui l'ont installée.

```sh
cd android
keytool -genkey -v -keystore mogichex.keystore -alias mogichex \
        -keyalg RSA -keysize 2048 -validity 10000
cd ..
```

## 2.3 Déclarer le keystore à Gradle

`android/keystore.properties` — **hors dépôt** : `.gitignore` couvre déjà `*.keystore`,
`keystore.properties` et le contenu généré de `android/`.

```properties
storeFile=../mogichex.keystore
storePassword=…
keyAlias=mogichex
keyPassword=…
```

Le chemin est relatif à `android/app/`, d'où le `../` pour un keystore rangé dans `android/`.

Puis, dans `android/app/build.gradle`, **avant** le bloc `android { … }` :

```gradle
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
```

et **dans** le bloc `android { … }` :

```gradle
    signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
```

Le `if` n'est pas une précaution de style : sans lui, un clone du dépôt sans `keystore.properties`
échoue à la **configuration** de Gradle, donc sur toutes les cibles — y compris `assembleDebug`,
qui n'a pourtant besoin d'aucune signature.

Android Studio fait la même chose par *Build → Generate Signed Bundle / APK*, sans toucher au
`build.gradle`.

## 2.4 Vérifier que tout est en place

```sh
npm run android:offline      # la variante la plus rapide
npx cap sync android
cd android && ./gradlew assembleDebug && cd ..
```

L'APK est dans `android/app/build/outputs/apk/debug/app-debug.apk`.

---

# 3. Une fois démarré : les commandes

**Toujours les trois étapes, et toujours depuis la racine.** Le contenu web est figé dans le
paquet : changer une option du script sans resynchroniser ni réassembler ne change rien à l'APK.

## Multijoueur — déploiement de référence

```sh
npm run android              # régénère www
npx cap sync android         # copie www dans le projet natif
cd android && ./gradlew assembleRelease
cd ..                        # ← revenir à la racine avant la prochaine variante
```

## Multijoueur — votre propre hébergement

```sh
npm run android -- --site https://exemple.fr/mogichex
npx cap sync android
cd android && ./gradlew assembleRelease
cd ..
```

Le `--` est nécessaire : il dit à npm de passer ce qui suit au script plutôt que de l'interpréter.

## Hors ligne

```sh
npm run android:offline      # sans 3D et SANS jeu à distance
npx cap sync android
cd android && ./gradlew assembleRelease
cd ..
```

`--site` n'a aucun effet ici : sans jeu à distance, il n'y a ni relai ni invitation.

## Variantes du contenu web

Le tableau des tailles est en tête de ce document. Deux options utiles au script, après `--` : `--skip-jocly-build` réutilise un dist déjà construit,
et `--jocly <chemin>` si jocly2 n'est pas dans `../jocly2`.

## L'APK produit

| | |
|---|---|
| debug | `android/app/build/outputs/apk/debug/app-debug.apk` |
| release | `android/app/build/outputs/apk/release/app-release.apk` |

---

## Pièges

**« android platform has not been added yet » alors que la plateforme existe.**
Les commandes `npx cap` se lancent **depuis la racine du projet**. Depuis `android/`, Capacitor
cherche `android/android/` et ne trouve rien. Le message ne dit pas cela, d'où la confusion —
d'autant que `npm run …` fonctionne, lui, depuis n'importe quel sous-répertoire : npm remonte
jusqu'au `package.json` et s'exécute depuis la racine. Reproduit et vérifié.

Le cas typique : la ligne `cd android && ./gradlew assembleRelease` laisse le terminal dans
`android/`. La variante suivante échoue alors sur `cap sync`, sans que rien n'ait changé au
projet. D'où le `cd ..` à la fin de chaque recette ci-dessus.

**`npx cap add android` répond « android platform already exists ».**
La plateforme est déjà là : passez à l'étape suivante. Ne pas accepter la suppression de
`./android` qui serait proposée — elle emporterait la configuration Gradle et la signature.

**Le script refuse d'écrire dans un projet natif.** `tools/build-android.mjs` efface son dossier
de sortie avant de le remplir. Si on le pointe sur `android/`, il s'arrête au lieu d'emporter la
configuration Gradle et la signature.

**Le lien d'invitation commence par `https://localhost`.** Le contenu web n'a pas été
resynchronisé après le build, ou l'APK date d'avant `--site`. Réglages › À propos dit quelle
adresse le paquet porte réellement.
