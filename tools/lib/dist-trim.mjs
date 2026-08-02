// Quels fichiers du dist embarquer dans l'APK — decisions PURES.
//
// Un dist jocly complet pese plus de 100 Mo ; un APK de cette taille ne se
// telecharge pas sur un forfait mobile. On n'embarque donc qu'un dist
// chessbase construit en production, dont on retire ce qui n'est jamais
// demande par mogichex.
//
// MESURES sur jocly2 545225a, `gulp --no-default-games --modules
// src/games/chessbase build --prod` :
//
//   dist/browser complet                        113 Mo
//   - res/visuals non cite par les regles       -13 Mo
//   - scan/ (moteur de dames)                   -11 Mo
//   - res/vr                                    -5,7 Mo
//   ------------------------------------------------
//   reste                                        ~83 Mo   (option --no-3d : ~20 Mo de moins)
//
// Chaque retrait est justifie par une mesure, pas par une intuition :
//
// - res/visuals : 151 fichiers, des captures 600x600 promotionnelles.
//   mogichex ne les affiche JAMAIS (ses vignettes viennent du champ
//   `thumbnail`, qui pointe vers res/rules/). MAIS 32 pages de regles en
//   citent 24 : les supprimer toutes casserait ces pages. On garde donc
//   exactement les 24 citees et on retire les 127 autres.
//
// - scan/ : le moteur de dames (scan.wasm + ses donnees). Les 80 jeux de
//   chessbase n'utilisent que les IA `uct` et `fairy-stockfish` — verifie sur
//   le catalogue — donc scan n'est jamais charge.
//
// - res/vr : les ressources de realite virtuelle, sans emploi sur telephone.
//
// - 3D (option) : chessbase declare 82 skins 3D pour 92 skins 2D, et TOUS ses
//   jeux ont au moins un skin 2D. Se limiter au 2D evite aussi three.js.
//   Ce n'est pas le defaut : c'est un choix a faire en connaissance de cause,
//   puisque l'utilisateur perd la possibilite de basculer en 3D.

/** Dossiers retires en entier, chemins relatifs a la racine du dist. */
export const DROP_DIRS = ['scan', 'res/vr'];

/**
 * Ressources purement 3D, retirees seulement avec l'option --no-3d.
 *
 * On filtre par EXTENSION et jamais par dossier : res/fairy melange les
 * modeles 3D (.gltf) et des planches de sprites 2D. Retirer le dossier entier
 * faisait disparaitre wikipedia-fairy-sprites.png, dont les skins 2D ont
 * besoin — mesure : 404 en pleine partie.
 */
export const EXT_3D = ['.gltf', '.bin', '.obj', '.mtl'];

/** Dossier des captures promotionnelles, filtre au cas par cas. */
export const VISUALS_DIR = 'games/chessbase/res/visuals';

function underDir(relPath, dir) {
    return relPath === dir || relPath.startsWith(dir + '/');
}

/**
 * Faut-il embarquer ce fichier ?
 *
 * @param {string} relPath chemin relatif a la racine du dist, avec des « / »
 * @param {{referencedVisuals:Set<string>, keep3d?:boolean}} opts
 *   referencedVisuals contient les chemins relatifs (res/visuals/xxx.jpg)
 *   effectivement cites par une page de regles.
 * @returns {{keep:boolean, reason:string}}
 */
export function keepFile(relPath, opts) {
    const refs = opts.referencedVisuals || new Set();
    const keep3d = opts.keep3d !== false;

    for (const dir of DROP_DIRS) {
        if (underDir(relPath, dir)) return { keep: false, reason: 'dossier-inutile:' + dir };
    }

    if (underDir(relPath, VISUALS_DIR)) {
        // Le chemin cite dans les regles est relatif au module, pas au dist.
        const asCited = relPath.slice('games/chessbase/'.length);
        return refs.has(asCited)
            ? { keep: true, reason: 'visuel-cite-par-les-regles' }
            : { keep: false, reason: 'visuel-non-cite' };
    }

    if (!keep3d) {
        for (const ext of EXT_3D) {
            if (relPath.endsWith(ext)) return { keep: false, reason: 'ressource-3d' };
        }
        // three.js reste EMBARQUE meme sans 3D : jocly le charge sans
        // condition, y compris pour un skin 2D. Le retirer casse toute
        // partie — mesure : « 404 dist/three.js » puis plateau vide. Il ne
        // pese que 2 Mo, c'est le prix d'un dist qui fonctionne.
    }

    return { keep: true, reason: 'garde' };
}

/**
 * Extrait les chemins « res/visuals/... » cites dans une page de regles.
 * On lit le HTML plutot que de deviner : une page peut citer un visuel d'un
 * autre jeu, et une convention de nommage se serait trompee.
 */
export function citedVisuals(html) {
    const out = new Set();
    for (const m of String(html).matchAll(/res\/visuals\/[A-Za-z0-9._-]+/g)) out.add(m[0]);
    return out;
}

/** Resume lisible d'un filtrage, pour que le script dise ce qu'il a fait. */
export function summarize(entries) {
    const kept = entries.filter((e) => e.keep);
    const dropped = entries.filter((e) => !e.keep);
    const byReason = {};
    for (const e of dropped) {
        byReason[e.reason] = byReason[e.reason] || { files: 0, bytes: 0 };
        byReason[e.reason].files++;
        byReason[e.reason].bytes += e.size || 0;
    }
    return {
        keptFiles: kept.length,
        keptBytes: kept.reduce((t, e) => t + (e.size || 0), 0),
        droppedFiles: dropped.length,
        droppedBytes: dropped.reduce((t, e) => t + (e.size || 0), 0),
        byReason,
    };
}
