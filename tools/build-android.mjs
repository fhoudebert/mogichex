#!/usr/bin/env node
// Prepare le contenu web d'une application Android (Capacitor).
//
//   node tools/build-android.mjs --jocly ../jocly2 [--out android/www] [--no-3d]
//   node tools/build-android.mjs --jocly ../jocly2 --skip-jocly-build
//
// Ce script ne fabrique PAS l'APK : il produit le dossier `www` que Capacitor
// embarquera. La generation et la signature de l'APK restent independantes
// (script Gradle ou Android Studio) — voir android/README.md.
//
// Ce qu'il fait, dans l'ordre :
//   1. construit le dist jocly limite a chessbase, en production ;
//   2. le recopie en RETIRANT ce que mogichex ne demande jamais
//      (voir tools/lib/dist-trim.mjs : chaque retrait est justifie par une
//      mesure, et les captures citees par les regles sont conservees) ;
//   3. recopie l'application, catalogue reconstruit sur ce seul module ;
//   4. impose la configuration adaptee a une coquille native.
//
// Pourquoi chessbase seul : c'est le module qui porte les 80 variantes
// d'echecs, shogi et xiangqi. Les 12 modules complets ne tiennent pas dans un
// APK raisonnable.

import { execFileSync } from 'node:child_process';
import {
    readFileSync,
    writeFileSync,
    mkdirSync,
    readdirSync,
    copyFileSync,
    existsSync,
    statSync,
    rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keepFile, citedVisuals, summarize } from './lib/dist-trim.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv;
const arg = (n, d) => {
    const i = argv.indexOf('--' + n);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const flag = (n) => argv.includes('--' + n);

const joclyPath = path.resolve(arg('jocly', '../jocly2'));
const outDir = path.resolve(root, arg('out', 'android/www'));
const keep3d = !flag('no-3d');
const MODULE = 'chessbase';

if (!existsSync(path.join(joclyPath, 'gulpfile.js'))) {
    console.error(`jocly2 introuvable en ${joclyPath}. Utiliser --jocly <chemin>.`);
    process.exit(2);
}

// --- 1. dist jocly limite a chessbase -------------------------------------
const distSrc = path.join(joclyPath, 'dist', 'browser');
if (!flag('skip-jocly-build')) {
    console.log(`Construction du dist ${MODULE} (production)…`);
    execFileSync(
        'npx',
        ['gulp', '--no-default-games', '--modules', `src/games/${MODULE}`, 'build', '--prod'],
        { cwd: joclyPath, stdio: 'inherit' }
    );
}
if (!existsSync(path.join(distSrc, 'jocly.js'))) {
    console.error(`Dist absent ou incomplet : ${distSrc}`);
    process.exit(2);
}

// --- 2. quels visuels les regles citent-elles ? ----------------------------
// On LIT le HTML : une page peut citer le visuel d'un autre jeu, et une
// convention de nommage se serait trompee.
const moduleDir = path.join(distSrc, 'games', MODULE);
const referencedVisuals = new Set();
for (const f of readdirSync(moduleDir)) {
    if (!f.endsWith('.html')) continue;
    for (const v of citedVisuals(readFileSync(path.join(moduleDir, f), 'utf8'))) {
        referencedVisuals.add(v);
    }
}

// --- 3. copie filtree ------------------------------------------------------
function walk(dir, rel = '') {
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), r));
        else out.push(r);
    }
    return out;
}

const distOut = path.join(outDir, 'dist');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(distOut, { recursive: true });

const entries = [];
for (const rel of walk(distSrc)) {
    const verdict = keepFile(rel, { referencedVisuals, keep3d });
    const size = statSync(path.join(distSrc, rel)).size;
    entries.push({ rel, size, ...verdict });
    if (!verdict.keep) continue;
    const dest = path.join(distOut, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(distSrc, rel), dest);
}

// --- 4. application + catalogue limite au module ---------------------------
// LICENSE voyage avec l'application : distribuer un APK, c'est distribuer une
// oeuvre combinee sous AGPL-3.0, et le texte de la licence doit l'accompagner.
// (AGPL-3.0.txt du dist est conserve par le filtre, verifie separement.)
const APP_FILES = ['index.html', 'manifest.webmanifest', 'sw.js', 'LICENSE'];
const APP_DIRS = ['css', 'js', 'lang', 'i'];
for (const f of APP_FILES) copyFileSync(path.join(root, f), path.join(outDir, f));
for (const d of APP_DIRS) {
    for (const rel of walk(path.join(root, d))) {
        const dest = path.join(outDir, d, rel);
        mkdirSync(path.dirname(dest), { recursive: true });
        copyFileSync(path.join(root, d, rel), dest);
    }
}

const full = JSON.parse(readFileSync(path.join(root, 'app', 'catalog.json'), 'utf8'));
let games = full.games.filter((g) => g.module === MODULE);
if (!keep3d) {
    // Sans les ressources 3D, proposer encore des skins 3D donnerait des
    // options qui echouent au chargement. On les retire du catalogue plutot
    // que de laisser l'interface mentir. Tous les jeux de chessbase ont au
    // moins un skin 2D — verifie avant de filtrer, et le script s'arrete si
    // ce n'etait pas vrai.
    const orphelins = games.filter((g) => !g.skins.some((sk) => !sk.is3d));
    if (orphelins.length) {
        console.error(
            `--no-3d impossible : ${orphelins.length} jeu(x) sans skin 2D — ` +
                orphelins.map((g) => g.name).join(', ')
        );
        process.exit(2);
    }
    games = games.map((g) => {
        const skins = g.skins.filter((sk) => !sk.is3d);
        return { ...g, skins, defaultSkin: skins[0].name, defaultSkinIs2d: true };
    });
}
mkdirSync(path.join(outDir, 'app'), { recursive: true });
writeFileSync(
    path.join(outDir, 'app', 'catalog.json'),
    JSON.stringify(
        {
            ...full,
            counts: {
                games: games.length,
                modules: 1,
                phone: games.filter((g) => g.tier === 'phone').length,
                tablet: games.filter((g) => g.tier === 'tablet').length,
                obsolete: games.filter((g) => g.obsolete).length,
                byModule: { [MODULE]: games.length },
            },
            games,
        },
        null,
        1
    ) + '\n'
);

// --- 5. configuration imposee ---------------------------------------------
// Sous capacitor:// ou https://localhost, « . » ne designe pas le site : la
// recherche du relai n'aurait aucun sens. Le dist, lui, est embarque a cote
// de index.html, donc un chemin relatif suffit et reste juste.
writeFileSync(
    path.join(outDir, 'config-android.js'),
    `// Genere par tools/build-android.mjs — ne pas editer a la main.
// L'origine d'une application native n'est ni le site ni GitHub Pages : le
// relai doit etre nomme en absolu, et son origine autorisee dans
// signalconf.php (capacitor://localhost, https://localhost y figurent deja).
window.MOGICHEX_CONFIG = {
    distBase: 'dist/',
    relayUrl: 'https://biscandine.fr/variantes/mogichex',
};
`
);
const indexPath = path.join(outDir, 'index.html');
const html = readFileSync(indexPath, 'utf8');
if (!html.includes('config-android.js')) {
    writeFileSync(
        indexPath,
        html.replace(
            '<script type="module" src="js/app.js"></script>',
            '<script src="config-android.js"></script>\n    <script type="module" src="js/app.js"></script>'
        )
    );
}

// --- 6. compte rendu -------------------------------------------------------
const s = summarize(entries);
const mo = (b) => (b / 1048576).toFixed(1) + ' Mo';
console.log(`\n${outDir}`);
console.log(`  dist embarque : ${s.keptFiles} fichiers, ${mo(s.keptBytes)}`);
console.log(`  retire        : ${s.droppedFiles} fichiers, ${mo(s.droppedBytes)}`);
for (const [reason, v] of Object.entries(s.byReason)) {
    console.log(`    ${reason.padEnd(28)} ${String(v.files).padStart(4)} fichiers  ${mo(v.bytes)}`);
}
console.log(`  visuels conserves car cites par les regles : ${referencedVisuals.size}`);
console.log(`  jeux au catalogue : ${games.length}`);
console.log(`  3D : ${keep3d ? 'conservee' : 'retiree (--no-3d)'}`);
console.log(`\nEtape suivante : voir android/README.md (npx cap sync android, puis Gradle).`);
