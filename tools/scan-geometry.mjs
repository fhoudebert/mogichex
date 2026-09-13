#!/usr/bin/env node
// Aide a la MAINTENANCE de data/phone-ineligible.json. Ne participe pas au
// build : le tier est decide par la liste, pas par ce script.
//
//   node tools/scan-geometry.mjs --jocly ../jocly2 [--max 12]
//
// La taille de plateau n'est pas une metadonnee jocly : c'est un argument
// litteral dans le code du modele (ex. cbBoardGeometryGrid(8,8)). On la lit
// donc au motif regulier dans les scripts declares par chaque jeu. C'est
// une HEURISTIQUE, faillible par construction :
//   - un modele partage par plusieurs jeux peut etre parametre ailleurs ;
//   - les dimensions calculees (variables) ne sont pas vues ;
//   - hexagones, cylindres, cubiques et multiplans n'ont pas de « w x h ».
// D'ou le rapport en trois colonnes : ce que le scan croit voir, ce que la
// liste dit, et les DESACCORDS — seuls ceux-ci demandent une decision.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

function arg(name, def) {
    const i = process.argv.indexOf('--' + name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const joclyPath = path.resolve(arg('jocly', '../jocly2'));
const maxSide = parseInt(arg('max', '12'), 10);
const gamesDir = path.join(joclyPath, 'src', 'games');

const GRID = /cbBoardGeometryGrid\s*\(\s*(\d+)\s*,\s*(\d+)/g;
const OTHER = /cbBoardGeometry(Hex|Multiplan|Cylinder|Cubic|Smess)\s*\(/g;

function inspect(moduleDir, scripts) {
    let width = 0, height = 0, kinds = new Set();
    for (const rel of scripts || []) {
        const file = path.join(gamesDir, moduleDir, rel);
        if (!existsSync(file)) continue;
        const src = readFileSync(file, 'utf8');
        for (const m of src.matchAll(GRID)) {
            width = Math.max(width, +m[1]);
            height = Math.max(height, +m[2]);
            kinds.add('grid');
        }
        for (const m of src.matchAll(OTHER)) kinds.add(m[1].toLowerCase());
    }
    return { width, height, kinds: [...kinds] };
}

const ineligible = new Set(
    JSON.parse(readFileSync(path.join(root, 'data', 'phone-ineligible.json'), 'utf8')).ineligible
);

const rows = [];
for (const dir of readdirSync(gamesDir).sort()) {
    const index = path.join(gamesDir, dir, 'index.js');
    if (!existsSync(index)) continue;
    for (const g of require(index).games || []) {
        const geo = inspect(dir, (g.config && g.config.model && g.config.model.js) || []);
        const big = geo.width > maxSide || geo.height > maxSide;
        const exotic = geo.kinds.some((k) => k === 'cubic' || k === 'multiplan' || k === 'cylinder');
        // Aucun motif reconnu : le scan n'a RIEN lu de ce jeu. Ce n'est pas la
        // meme chose qu'un petit plateau, et c'est la distinction qui manquait
        // — go19 (19x19) passait pour eligible faute d'etre vu.
        const muet = !geo.width && geo.kinds.length === 0;
        rows.push({
            name: g.name, module: dir, geo, muet,
            suspect: big || exotic, listed: ineligible.has(g.name),
        });
    }
}

const disagree = rows.filter((r) => r.suspect !== r.listed);
const fmt = (r) =>
    `${r.name.padEnd(22)} ${r.module.padEnd(11)} ` +
    `${r.geo.width ? r.geo.width + 'x' + r.geo.height : '-'} ${r.geo.kinds.join(',') || '?'}`;

console.log(`Scan de ${rows.length} jeux (seuil ${maxSide}x${maxSide}).\n`);
console.log(`— Suspects par le scan mais ABSENTS de la liste (a examiner) :`);
const a = disagree.filter((r) => r.suspect && !r.listed);
console.log(a.length ? a.map(fmt).join('\n') : '  (aucun)');
console.log(`\n— Dans la liste mais NON suspects par le scan (justifie ? geometrie non lue ?) :`);
const b = disagree.filter((r) => !r.suspect && r.listed);
console.log(b.length ? b.map(fmt).join('\n') : '  (aucun)');
console.log(`\n— Accord sur ${rows.length - disagree.length} jeux.`);

// LA LIGNE LA PLUS IMPORTANTE DE CETTE SORTIE. « Accord sur N jeux » se lit
// spontanement comme « N jeux verifies », alors que le scan ne lit que des
// LITTERAUX : un module qui construit sa taille par parametre — Go('go19', 19)
// — ne laisse aucune trace, et son plateau de 19x19 passe pour petit. C'est
// exactement ainsi que go19 s'est retrouve eligible sur telephone.
const muets = rows.filter((r) => r.muet);
const lus = rows.length - muets.length;
console.log(
    `\n— Couverture : geometrie lue pour ${lus} jeux sur ${rows.length}. ` +
    `${muets.length} ILLISIBLES,\n  sur lesquels le scan ne dit rien — ni « petit », ni « sûr ».`
);
if (muets.length) {
    if (process.argv.includes('--illisibles')) {
        console.log(muets.map((r) => `  ${r.name.padEnd(22)} ${r.module}`).join('\n'));
    } else {
        const parModule = [...new Set(muets.map((r) => r.module))].sort().join(', ');
        console.log(`  Modules concernes : ${parModule}`);
        console.log(`  Liste complete : --illisibles`);
    }
}

console.log(
    `\nRappel : les desaccords ne sont pas des erreurs. fantasticXIII-chess (13x13),\n` +
    `les jeux cylindriques, go9 et go13 sont volontairement acceptes sur telephone ;\n` +
    `voir le commentaire de data/phone-ineligible.json.`
);
