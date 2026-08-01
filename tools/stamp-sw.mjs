#!/usr/bin/env node
// Estampille SHELL_VERSION dans sw.js.
//
// Un service worker n'est reinstalle par le navigateur que si son OCTET change.
// Laisser 'dev' en production, c'est servir eternellement l'ancienne coquille
// aux visiteurs deja venus. Ce script est donc appele par `npm run build`, pas
// laisse a la discipline de qui livre.
//
//   node tools/stamp-sw.mjs [--version <chaine>]
//
// Par defaut : date compacte + abrege du commit mogichex si disponible.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const swPath = path.join(root, 'sw.js');

function arg(name) {
    const i = process.argv.indexOf('--' + name);
    return i >= 0 ? process.argv[i + 1] : null;
}

let version = arg('version');
if (!version) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
    let short = '';
    try {
        short = '-' + execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], {
            encoding: 'utf8',
        }).trim();
    } catch {
        /* pas de git : l'horodatage suffit a distinguer deux livraisons */
    }
    version = stamp + short;
}

const src = readFileSync(swPath, 'utf8');
const re = /^const SHELL_VERSION = '[^']*';$/m;
if (!re.test(src)) {
    console.error('sw.js : ligne SHELL_VERSION introuvable — estampillage annule.');
    process.exit(2);
}
writeFileSync(swPath, src.replace(re, `const SHELL_VERSION = '${version}';`));
console.log('sw.js : SHELL_VERSION =', version);
