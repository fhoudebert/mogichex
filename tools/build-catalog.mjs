#!/usr/bin/env node
// Extraction du catalogue jocly2 -> app/catalog.json, a la compilation.
//
// Pourquoi : les metadonnees de jeu ne sont accessibles au navigateur que par
// Jocly.getGameConfig(), soit ~128 appels au demarrage. Les pre-calculer au
// build supprime ces appels, permet le filtre telephone/tablette et donne le
// tri module + alphabetique sans charger le moteur.
//
//   node tools/build-catalog.mjs --jocly ../jocly2 [--out app/catalog.json]
//
// Les index.js de jocly2 sont du CommonJS pur (exports.games = [...]) sans
// dependance : on les charge par require() plutot que de les analyser au
// motif regulier. C'est la seule facon d'etre exact si leur mise en forme
// change.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from './lib/catalog.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

function arg(name, def) {
    const i = process.argv.indexOf('--' + name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const joclyPath = path.resolve(arg('jocly', '../jocly2'));
const outPath = path.resolve(root, arg('out', 'app/catalog.json'));
const gamesDir = path.join(joclyPath, 'src', 'games');

if (!existsSync(gamesDir)) {
    console.error(`Introuvable : ${gamesDir}`);
    console.error('Indiquer un checkout de jocly2 avec --jocly <chemin>.');
    process.exit(2);
}

const modules = [];
for (const dir of readdirSync(gamesDir).sort()) {
    const index = path.join(gamesDir, dir, 'index.js');
    if (!existsSync(index)) continue;
    const loaded = require(index);
    modules.push({ module: dir, games: loaded.games || [] });
}

const ineligible = JSON.parse(
    readFileSync(path.join(root, 'data', 'phone-ineligible.json'), 'utf8')
).ineligible;

let commit = null;
try {
    commit = execFileSync('git', ['-C', joclyPath, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
    }).trim();
} catch {
    /* checkout sans git : le catalogue reste valable, la tracabilite en moins */
}

const { catalog, warnings } = buildCatalog(modules, {
    ineligible,
    source: { repo: 'jocly2', commit, builtAt: new Date().toISOString() },
});

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(catalog, null, 1) + '\n');

console.log(`${outPath}`);
console.log(
    `  ${catalog.counts.games} jeux / ${catalog.counts.modules} modules — ` +
    `telephone ${catalog.counts.phone}, tablette seule ${catalog.counts.tablet}, ` +
    `obsoletes ${catalog.counts.obsolete}`
);
for (const w of warnings) console.log(`  ! ${w}`);
