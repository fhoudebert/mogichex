#!/usr/bin/env node
// Serveur de developpement. Aucune dependance : le module http suffit.
//
//   node tools/serve.mjs [--port 8080] [--coi]
//
// Deux raisons de ne pas se contenter de `python3 -m http.server` :
//   - les modules ES et le service worker exigent des types MIME corrects ;
//   - --coi ajoute COOP/COEP, pour reproduire EN LOCAL les en-tetes qui
//     conditionnent l'isolation cross-origin (et donc fairy-stockfish
//     multi-thread). Sans cela on ne decouvre le probleme qu'en production.
//
// Ce fichier n'est PAS destine a la production : voir deploy/.htaccess.

import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv;
const port = parseInt(argv[argv.indexOf('--port') + 1], 10) || 8080;
const coi = argv.includes('--coi');

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.wasm': 'application/wasm',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.glb': 'model/gltf-binary',
};

createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(root, rel);
    // Garde anti-traversee : jamais servir hors de l'arborescence du projet.
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('404 ' + rel);
    }
    const headers = { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' };
    if (coi) {
        headers['Cross-Origin-Opener-Policy'] = 'same-origin';
        headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
        headers['Cross-Origin-Resource-Policy'] = 'same-origin';
    }
    // Le service worker doit pouvoir controler toute la portee.
    if (rel.endsWith('/sw.js')) headers['Service-Worker-Allowed'] = '/';
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
}).listen(port, () => {
    console.log(`http://localhost:${port}/  (coi ${coi ? 'actif' : 'inactif'})`);
    console.log('Rappel : le dist jocly doit etre present dans ./dist (voir README).');
});
