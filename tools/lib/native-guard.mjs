// Reconnaitre un projet Android natif, pour ne jamais l'effacer.
//
// tools/build-android.mjs efface son repertoire de sortie avant de le remplir.
// Pointe par erreur sur android/ (--out android, ou un webDir mal choisi), il
// detruirait la configuration Gradle et la signature.
//
// Le marqueur est `app/build.gradle`, PAS le dossier `app/` : le contenu web
// produit par le script contient lui-meme un dossier app/ (le catalogue,
// app/catalog.json). Avec `app` comme marqueur, le script refusait d'ecraser
// son propre www/ des le deuxieme lancement.
import { existsSync } from 'node:fs';
import path from 'node:path';

export const NATIVE_MARKERS = ['build.gradle', 'gradlew', 'settings.gradle', 'app/build.gradle'];

export function looksLikeNativeProject(dir) {
    return existsSync(dir) && NATIVE_MARKERS.some((m) => existsSync(path.join(dir, m)));
}
