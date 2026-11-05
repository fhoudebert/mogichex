# mogichex pour Android (Capacitor)

Ce dossier **est** le projet Capacitor, versionné. **Le contenu web est produit par un script** ;
l'APK est assemblé et signé par Gradle (ou Android Studio), sur le poste comme dans le CI.

Trois sections : ce qu'il faut savoir, comment mettre en place l'environnement une fois pour
toutes (signature et CI compris), puis les commandes prêtes à l'emploi.

---

# 1. Informations générales

## Trois variantes, nommées par ce qu'elles contiennent

Le nom de chaque variante dit les deux choix qu'elle fait : **jeu à distance ou non**
(`multiplayer` / `offline`), **pièces 3D ou non** (`3d` / `2d`). Le même nom sert au script npm,
au choix du workflow (§2.6), au fichier APK produit par le CI
(`mogichex-<version>-<variante>.apk`) et au compte rendu du script (`variante : …`).

| Variante | Commande | Jeu à distance | 3D | `www` | APK attendu |
|---|---|---|---|---|---|
| **`multiplayer-2d`** (publiée) | `npm run android:multiplayer-2d` | oui | non | ~47 Mo | **~35 Mo** |
| `multiplayer-3d` | `npm run android:multiplayer-3d` | oui | **oui** | ~69 Mo | ~52 Mo |
| `offline-2d` | `npm run android:offline-2d` | **non** | non | ~47 Mo | ~35 Mo |

Les anciens noms `android`, `android:3d`, `android:light` et `android:offline` n'existent plus :
`android` et `android:light` ne disaient pas si la 3D était incluse, de quoi construire une
variante en croyant faire l'autre et ne s'en apercevoir qu'à la taille du paquet. Correspondance :
`android:light` → `android:multiplayer-2d`, `android` et `android:3d` → `android:multiplayer-3d`,
`android:offline` → `android:offline-2d`.

On reconnaît d'ailleurs une variante déjà construite à sa taille : **l'APK multijoueur publié en
1.10 pèse 38,1 Mo**, soit `multiplayer-2d`. *Réglages › À propos* ne dit rien de la 3D.

Appelé directement, `node tools/build-android.mjs` garde la 3D par défaut ; `--3d` et `--no-3d`
le disent explicitement.

`--3d` et `--no-3d` ensemble sont une contradiction, pas un ordre de priorité à deviner : le
script s'arrête.

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
npm run android:multiplayer-2d -- --site https://exemple.fr/mogichex
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

| Variante | `www` | compressé |
|---|---|---|
| complète | **69,1 Mo** | ~51,5 Mo |
| `--no-3d` | **47,4 Mo** | ~34,7 Mo |

Mesuré sur le catalogue courant. La colonne compressée approche la charge utile de l'APK : c'est
elle qu'il faut comparer au poids du fichier téléchargé.

Deux pièges rencontrés en construisant ce filtre, et corrigés :

- **`three.js` reste embarqué même sans 3D.** Jocly le charge sans condition, y compris pour un
  skin 2D : le retirer donnait un `404 dist/three.js` et un plateau vide.
- **On filtre la 3D par extension, jamais par dossier.** `res/fairy` mélange modèles `.gltf` et
  planches de sprites **2D** ; retirer le dossier faisait disparaître
  `wikipedia-fairy-sprites.png`, dont les skins 2D ont besoin.

Avec `--no-3d`, les skins 3D sont aussi retirés du **catalogue** : proposer une option qui
échouerait au chargement serait pire que ne pas la proposer. Le script s'arrête si un jeu se
retrouvait sans aucun skin 2D.

## Rotation de l'écran

**La rotation est automatique sans rien installer.** Le gabarit Android de Capacitor ne pose aucun
`android:screenOrientation` sur l'activité et déclare `configChanges="orientation|screenSize|…"` :
quand on tourne le téléphone, l'activité n'est pas recréée, la WebView est redimensionnée, et
Jocly réinscrit le plateau. En paysage, l'écran de partie passe la barre et le statut dans une
colonne à gauche pour laisser toute la hauteur au plateau (mesuré sur 844 × 390 : plateau de
390 px de côté au lieu de 304).

Cela suit **le réglage de rotation automatique du téléphone** : si l'utilisateur l'a verrouillé
dans les paramètres rapides, l'application reste en portrait — comme toute application Android.

Le greffon **`@capacitor/screen-orientation`** sert à l'inverse : *Réglages › Orientation de
l'écran* propose **Automatique / Portrait / Paysage**, pour figer l'application. « Automatique »
appelle `unlock()`, qui rend exactement l'état d'origine. Le réglage n'apparaît **que** si le
greffon est présent dans l'APK : il est en `devDependencies`, et `npx cap sync android` l'ajoute
au projet natif — un projet créé avant ce changement n'a besoin que de cette resynchronisation.

Pour tourner **malgré** le verrou du système (déconseillé : cela contredit un choix explicite de
l'utilisateur), il faudrait `android:screenOrientation="fullSensor"` sur l'`<activity>` de
`android/app/src/main/AndroidManifest.xml` — le greffon ne sait pas le demander.

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

Prérequis : **Node.js 26**, **JDK 21**, et le SDK Android 36. Le gabarit de Capacitor 8.5 fixe
AGP 8.13 et Gradle 8.14 : ne pas les monter à la main en 9.x, c'est Capacitor 9 qui les
accompagnera. Toutes les commandes se lancent **depuis la racine du projet**, jamais depuis
`android/`.

## 2.1 Le projet natif est versionné

`android/` (projet Gradle, manifeste, icône) et `capacitor.config.json` font partie du dépôt :
le poste et le CI construisent le même APK. Un clone neuf n'a donc **ni `npx cap init` ni
`npx cap add android` à faire** — ce dernier refuserait d'ailleurs, puisque `android/` existe.

Ne sont **pas** versionnés, parce que générés ou propres à une machine : le contenu web
(`www/`, et sa copie `android/app/src/main/assets/public/` faite par `cap sync`),
`capacitor-cordova-android-plugins/`, les sorties `build/` et `.gradle/`, `.idea/`,
`local.properties` (chemin du SDK de la machine), les APK, et tout ce qui touche à la signature.

`app/build.gradle` est le gabarit de Capacitor, avec R8 activé en release (`minifyEnabled`,
`shrinkResources` ; `proguard-rules.pro`, versionné, ne contient que les commentaires du gabarit) et, en **dernière** ligne,
`apply from: 'mogichex.gradle'`. Tout ce qui touche à la signature et à la version est dans
**`app/mogichex.gradle`** : une mise à jour de Capacitor qui régénère `build.gradle` ne demande
que de remettre R8 et cette ligne. `npx cap sync` ne touche ni à l'un ni à l'autre (vérifié) ; il
réécrit seulement `capacitor.build.gradle` et `capacitor.settings.gradle`, qui sont versionnés
et ne changent que si l'on ajoute ou retire un greffon — **lancer `npm install` avant**, sinon
le greffon `screen-orientation` disparaît de ces deux fichiers, et le réglage d'orientation de
l'APK avec lui.

Fichiers indispensables à un clone neuf, et donc au CI : `gradlew`, `gradle/wrapper/*`,
`gradle.properties` (porte `android.useAndroidX=true` : sans lui la construction échoue) et
`app/proguard-rules.pro`.

## 2.2 Version de l'APK

`versionName` est **lu dans `package.json`** et `versionCode` en est déduit :
`MAJEUR×10000 + MINEUR×100 + CORRECTIF`, soit `1.01.0` → `10100`. Changer la version, c'est
changer `package.json`, et nulle part ailleurs.

Android refuse une mise à jour dont le `versionCode` est **inférieur** à celui qui est
installé. L'APK 1.0 publié porte `versionCode 1` (valeur du gabarit) : tout APK construit
désormais le dépasse. `MOGICHEX_VERSION_CODE` (propriété Gradle ou variable d'environnement)
force une valeur, pour un cas particulier.

## 2.3 Le keystore

Un APK de *debug* se signe tout seul et suffit pour essayer. Un APK **distribuable** demande
votre propre clé — et **la même pour toutes les mises à jour** : Android refuse d'installer une
mise à jour signée par une autre clé. Perdre ce fichier, c'est perdre la possibilité de mettre à
jour l'application chez ceux qui l'ont installée.

La clé de l'APK publié existe déjà ; son certificat a pour empreinte SHA-256

```
de787442e861debd11c519a6049ee4edaacfb20b4b9a8f6ca37d334b0777ecec
```

(CN=F. Houdebert). Pour vérifier qu'un keystore est le bon :

```sh
keytool -list -v -keystore ~/secrets/mogichex.keystore -alias mogichex | grep SHA256
```

Pour en créer un (nouvelle application seulement) :

```sh
keytool -genkey -v -keystore ~/secrets/mogichex.keystore -alias mogichex \
        -keyalg RSA -keysize 2048 -validity 10000
```

**Rangez-le hors du dépôt.** `.gitignore` ignore `*.keystore` et `*.jks` partout — le
`.gitignore` du gabarit Capacitor, lui, laisse cette règle en commentaire — mais maintenant
qu'`android/` est versionné, un keystore qui y dort n'est qu'à un `git add -f` du dépôt public.

## 2.4 Déclarer la signature : `keystore.properties` sur le poste, l'environnement dans le CI

`app/mogichex.gradle` prend la signature dans **une** des deux sources suivantes, jamais dans
un mélange des deux :

1. **les réglages `MOGICHEX_*`**, lus dans les propriétés Gradle (`-PNOM=…`, ou
   `~/.gradle/gradle.properties`), sinon dans les variables d'environnement du même nom.
   C'est ce que fait le CI ;
2. à défaut, **`android/keystore.properties`**, au format historique, inchangé :

```properties
storeFile=../mogichex.keystore
storePassword=…
keyAlias=mogichex
keyPassword=…
```

`storeFile` reste relatif à `android/app/`, d'où le `../` pour un keystore rangé dans
`android/`. Ce fichier et le keystore sont **ignorés par git** (`keystore.properties`,
`*.keystore`, `*.jks` dans `.gitignore`, vérifié par `git check-ignore`). Le CI n'en a pas ;
si un poste a les deux sources, **l'environnement l'emporte**, ce qui permet de signer une fois
avec une autre clé sans toucher au fichier.

| Réglage `MOGICHEX_*` | équivalent dans `keystore.properties` | |
|---|---|---|
| `MOGICHEX_KEYSTORE_FILE` | `storeFile` | chemin du keystore : relatif à `android/` (resp. `android/app/`), ou absolu |
| `MOGICHEX_KEYSTORE_PASSWORD` | `storePassword` | mot de passe du magasin |
| `MOGICHEX_KEY_ALIAS` | `keyAlias` | défaut `mogichex` |
| `MOGICHEX_KEY_PASSWORD` | `keyPassword` | défaut : celui du magasin (règle du PKCS12) |

**Pas dans `android/gradle.properties`** : ce fichier-là est versionné. La construction s'arrête
si elle y trouve un mot de passe de signature, plutôt que de le laisser partir au prochain
commit.

Comportement, vérifié pour chaque cas :

| Situation | Résultat |
|---|---|
| aucune source | debug normal ; release **non signée** (`app-release-unsigned.apk`) avec un avertissement |
| `keystore.properties` seul | `app-release.apk` signé ; ligne `mogichex : release signée avec … (via android/keystore.properties)` |
| `MOGICHEX_*` (avec ou sans `keystore.properties`) | `app-release.apk` signé ; ligne `… (via MOGICHEX_KEYSTORE_FILE)` |
| keystore introuvable, ou mot de passe absent | arrêt immédiat, message qui nomme la source en cause |
| mauvais mot de passe | `assembleRelease` échoue (« keystore password was incorrect ») ; `assembleDebug` passe |

La ligne `via …` dit toujours quelle source a servi. Android Studio (*Build → Generate Signed
Bundle / APK*) reste possible et ne demande aucun de ces réglages.

## 2.5 Vérifier que tout est en place

```sh
npm run android:offline-2d   # la variante la plus rapide
npx cap sync android
cd android && ./gradlew assembleRelease && cd ..
```

La ligne `mogichex : release signée avec …` doit apparaître, et
`apksigner verify --print-certs android/app/build/outputs/apk/release/app-release.apk` doit
afficher l'empreinte du §2.3.

## 2.6 Construire dans le CI (GitHub Actions)

`.github/workflows/android.yml` construit un APK **à la demande** : onglet *Actions* ›
*APK Android* › *Run workflow*, avec la variante (`multiplayer-2d` par défaut, celle qui est publiée, `multiplayer-3d` ou
`offline-2d`),
`--site`, la branche ou le commit de jocly2, et facultativement une release à laquelle joindre
l'APK. Il est aussi téléchargeable 30 jours depuis la page de l'exécution.

Chaque variante y appelle le script npm du même nom (`npm run android:<variante>`) : le CI et le
poste construisent la même chose. Il reprend ensuite exactement les commandes du §3, puis vérifie l'empreinte du certificat : un APK signé
par une autre clé **fait échouer le job** au lieu d'être publié.

**L'environnement `android-release`**, à créer une fois (*Settings › Environments › New
environment*) :

- *Deployment branches* : **`main` seulement** — un workflow modifié sur une autre branche ne
  pourra pas lire les secrets ;
- facultatif : *Required reviewers*, pour approuver chaque construction ;
- ses secrets et sa variable :

```sh
base64 -w0 ~/secrets/mogichex.keystore | gh secret set ANDROID_KEYSTORE_BASE64 --env android-release
gh secret set ANDROID_KEYSTORE_PASSWORD --env android-release
gh secret set ANDROID_KEY_ALIAS        --env android-release --body mogichex
# ANDROID_KEY_PASSWORD seulement s'il diffère de celui du magasin
gh variable set ANDROID_CERT_SHA256 --env android-release \
   --body de787442e861debd11c519a6049ee4edaacfb20b4b9a8f6ca37d334b0777ecec
```

Le keystore est décodé dans le répertoire temporaire du runner et effacé à la fin, même en cas
d'échec ; les mots de passe n'arrivent à Gradle que par l'environnement de l'étape qui en a
besoin. **Un secret GitHub ne se relit pas** : ce n'est pas une sauvegarde du keystore, gardez-en
une copie ailleurs.

---

# 3. Une fois démarré : les commandes

## En local : `npm run android:…` ou Gradle ? Les deux, dans cet ordre

Ce ne sont pas deux façons de faire la même chose : chaque outil fait **une** étape, et un APK
demande les trois.

| Étape | Commande | Ce qu'elle produit | Ce qu'elle ne fait pas |
|---|---|---|---|
| 1. contenu web | `npm run android:multiplayer-2d` (ou `android:multiplayer-3d`, `android:offline-2d`) | `www/` : dist Jocly filtré + application + `config-android.js` | **aucun APK** |
| 2. copie | `npx cap sync android` | `www/` recopié dans `android/app/src/main/assets/public/` | rien de compilé |
| 3. APK | `cd android && ./gradlew assembleRelease` | `app/build/outputs/apk/release/app-release.apk`, signé | ne régénère **pas** `www/` |

- **`npm run android:multiplayer-2d` seul ne fabrique pas d'APK** : il prépare le contenu web et s'arrête
  en rappelant les deux commandes suivantes.
- **`./gradlew` seul réassemble ce qui a été copié la dernière fois** : sans les étapes 1 et 2,
  l'APK porte l'ancien contenu web, quelle que soit la variante voulue. C'est le contenu web qui
  décide de la variante (3D ou non, jeu à distance ou non, `--site`), jamais Gradle.
- Inutile de vider `www/` à la main : le script l'efface lui-même avant de le remplir.
- La signature vient de `android/keystore.properties` sur le poste, ou des réglages `MOGICHEX_*`
  (§2.4). Sans l'un ni l'autre, l'étape 3 produit `app-release-unsigned.apk`.
- `./gradlew assembleDebug` à l'étape 3 donne un APK de debug, sans keystore, pour essayer.

Le CI (§2.6) enchaîne **exactement** ces trois étapes, et ses variantes portent les mêmes noms
que les scripts : la variante `multiplayer-2d` du workflow lance `npm run android:multiplayer-2d`,
et ainsi de suite.

Le champ `site` du workflow vaut par défaut la même adresse que le script
(`https://www.biscandine.fr/variantes/mogichex`) ; pour une autre, ajouter
`-- --site <adresse>` en local.

**Toujours les trois étapes, et toujours depuis la racine.** Le contenu web est figé dans le
paquet : changer une option du script sans resynchroniser ni réassembler ne change rien à l'APK.

## `multiplayer-2d` — jeu à distance, sans 3D (variante publiée)

```sh
npm run android:multiplayer-2d   # régénère www : jeu à distance, pièces 2D
npx cap sync android             # copie www dans le projet natif
cd android && ./gradlew assembleRelease
cd ..                            # ← revenir à la racine avant la prochaine variante
```

~35 Mo, contre ~52 avec la 3D.

## `multiplayer-2d` sur votre propre hébergement

```sh
npm run android:multiplayer-2d -- --site https://exemple.fr/mogichex
npx cap sync android
cd android && ./gradlew assembleRelease
cd ..
```

Le `--` est nécessaire : il dit à npm de passer ce qui suit au script plutôt que de l'interpréter.
`--site` s'ajoute de la même façon à `android:multiplayer-3d`.

## `multiplayer-3d` — jeu à distance, avec 3D

```sh
npm run android:multiplayer-3d   # régénère www, pièces 3D comprises
npx cap sync android
cd android && ./gradlew assembleRelease
cd ..
```

## `offline-2d` — sans jeu à distance, sans 3D

```sh
npm run android:offline-2d       # aucune requête sortante
npx cap sync android
cd android && ./gradlew assembleRelease
cd ..
```

`--site` n'a aucun effet ici : sans jeu à distance, il n'y a ni relai ni invitation.

## Variantes du contenu web

Le tableau des commandes et des tailles est en tête de ce document. Deux options utiles au script, après `--` : `--skip-jocly-build` réutilise un dist déjà construit,
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
Normal : le projet natif est versionné, il n'y a pas à l'ajouter. Ne pas accepter la suppression
de `./android` qui serait proposée — elle emporterait l'icône, le manifeste et `mogichex.gradle`.

**Le script refuse d'écrire dans un projet natif.** `tools/build-android.mjs` efface son dossier
de sortie avant de le remplir. Si on le pointe sur `android/`, il s'arrête au lieu d'emporter la
configuration Gradle et la signature.

**L'APK est plus léger que prévu, ou plus lourd.** C'est la 3D. Le compte rendu du script donne
la taille du contenu web à chaque build (`contenu web : …`) ; ~69 Mo avec, ~47 Mo sans. Rien dans
l'application ne le dit une fois installée.

**Le lien d'invitation commence par `https://localhost`.** Le contenu web n'a pas été
resynchronisé après le build, ou l'APK date d'avant `--site`. Réglages › À propos dit quelle
adresse le paquet porte réellement.
