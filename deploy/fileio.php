<?php
// fileio.php — le relai de mogichex, vu par un client joclymatch.
//
// A deposer a cote de match.php et signal.php. Ce fichier ne stocke rien de
// nouveau : il traduit le dialecte de joclymatch vers celui de match.php, qui
// garde seul la responsabilite des fichiers de partie.
//
// POURQUOI CE NOM, ET PAS UNE OPTION DANS match.php. Tabulon deduit l'adresse
// du relai en remplacant le dernier segment du lien d'invitation par
// « fileio.php », en dur (parseInvitationUrl). Un lien mogichex
// (.../mogichex/index.html?game=...) mene donc a .../mogichex/fileio.php. Il
// FAUT un fichier de ce nom ; autant que ce soit la traduction. Resultat : un
// joueur Tabulon rejoint une partie mogichex sans une ligne de changement de
// son cote.
//
// Deux roles, et un seul est une traduction :
//
//   gameioaction=save|load|drop  gameid=<id>  gamedata=<json>  [sinceMtime=…]
//       -> traduit en action/mid/data/since et DELEGUE a match.php
//   chatioaction=save|load       gameid=<id>  chatmsg=<ligne json>
//       -> servi ici : match.php n'a pas de point d'entree de discussion
//
// La discussion est un AJOUT COTE SERVEUR, une ligne par message, comme chez
// joclymatch. C'est ce qui permet aux deux joueurs d'ecrire dans le meme
// fichier sans se marcher dessus — la ou le format « un fil par joueur »
// oblige a reecrire le fil entier a chaque message, et isole celui qui
// l'emploie.
//
// Memes trois lecons que match.php et signal.php :
//   - AUCUNE balise fermante PHP, nulle part, pas meme en commentaire ;
//   - tout ce que la configuration locale pourrait afficher est jete sous
//     tampon, sinon un BOM ou une ligne vide passe devant le JSON ;
//   - l'identifiant sert a construire un nom de fichier : il est valide avant
//     tout usage.

ob_start();
if (file_exists(__DIR__ . '/matchconf.php')) {
    require __DIR__ . '/matchconf.php';
} elseif (file_exists(__DIR__ . '/signalconf.php')) {
    require __DIR__ . '/signalconf.php';
}
ob_end_clean();

if (!isset($matchPath)) {
    $matchPath = __DIR__ . '/matches/';
}
if (!isset($matchTTL)) {
    $matchTTL = 30 * 24 * 3600;
}
// Le fil est en ajout : sans borne il grossit tant que la partie dure. Meme
// valeur que joclymatch, soit environ 1 500 messages scelles.
if (!isset($chatMaxBytes)) {
    $chatMaxBytes = 262144;
}
/*
 * ET UNE FOIS PLEIN ? ON FAIT DE LA PLACE.
 *
 * Le fil etait alors FERME : tout message suivant recevait un 413, et les deux
 * joueurs se retrouvaient avec une conversation figee au milieu d'une partie
 * qui, elle, continuait. Pour une partie par correspondance qui dure des
 * semaines, c'est la fin normale du fichier, pas un cas rare — mesure : sur un
 * plafond de 3 Ko, 36 messages passent et les suivants sont refuses.
 *
 * Les messages les plus anciens sont donc retires pour loger les nouveaux. La
 * conversation vivante compte plus que son debut. Meme regle que joclymatch,
 * et le fil etant commun aux deux, il ne pouvait pas en aller autrement : deux
 * relais qui se comporteraient differemment sur le meme format seraient un
 * piege pour qui change d'hebergement.
 *
 * $chatTrimOldest = false retablit l'ancien refus, pour un hebergement qui
 * prefererait archiver.
 */
if (!isset($chatTrimOldest)) {
    $chatTrimOldest = true;
}
/*
 * On ne descend pas JUSTE sous la borne : le fichier entier serait alors
 * reecrit a chaque message des qu'il est plein. On retire un quart d'un coup,
 * et la reecriture n'a lieu qu'une fois par quart.
 */
if (!isset($chatTrimTo)) {
    $chatTrimTo = (int) ($chatMaxBytes * 0.75);
}
if (!isset($signalOrigins)) {
    $signalOrigins = array(
        'https://fhoudebert.github.io',
        'capacitor://localhost',
        'ionic://localhost',
        'https://localhost',
        'http://localhost:8080',
    );
}

$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
if ($origin !== '' && in_array($origin, $signalOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Max-Age: 600');
    http_response_code(204);
    exit;
}

header('Content-Type: application/json');
header('Cache-Control: no-store');

function fioFail($msg, $code = 400) {
    http_response_code($code);
    echo json_encode(array('error' => $msg));
    exit;
}

// Meme motif que match.php : ni point ni barre, jamais, sous peine de
// traversee de repertoire. Verifie ICI parce que la traduction se fait avant
// la delegation — sinon ce chemin ouvrirait une porte que l'autre ferme.
$gameid = isset($_POST['gameid']) ? $_POST['gameid'] : '';
if (!preg_match('/^[A-Za-z0-9_-]{6,64}$/', $gameid)) {
    fioFail('bad match id');
}

function fioChatFile($id) {
    global $matchPath;
    // .jsonl et non .json : le contenu est UNE LIGNE PAR MESSAGE, pas un
    // document JSON. Nommer honnetement evite qu'un outil — ou un futur
    // lecteur — le prenne pour un fichier a parser d'un bloc.
    return $matchPath . $id . '-chat.jsonl';
}

// Menage opportuniste des fils, borne, sur le modele de match.php : celui-ci
// ne balaie que les .json et laisserait donc les fils derriere lui. Un fil
// disparait aussi avec sa partie (voir l'action drop plus bas) ; ceci ne
// couvre que les parties abandonnees sans jamais etre effacees.
function fioSweepChat() {
    global $matchPath, $matchTTL;
    $dh = @opendir($matchPath);
    if (!$dh) {
        return;
    }
    $seen = 0;
    while (($f = readdir($dh)) !== false && $seen < 40) {
        if (substr($f, -6) !== '.jsonl') {
            continue;
        }
        $seen++;
        $p = $matchPath . $f;
        if (@filemtime($p) < time() - $matchTTL) {
            @unlink($p);
        }
    }
    closedir($dh);
}

// ── Discussion ───────────────────────────────────────────────────────────────

if (isset($_POST['chatioaction'])) {
    $action = $_POST['chatioaction'];
    $fn = fioChatFile($gameid);

    if ($action === 'save') {
        if (!isset($_POST['chatmsg'])) {
            fioFail('chatmsg missing');
        }
        $msg = $_POST['chatmsg'];
        // UN MESSAGE EST UNE LIGNE. Le fichier est relu ligne par ligne puis
        // recolle en JSON : un saut de ligne DANS le message couperait celui
        // de son auteur en deux fragments invalides, et le fil deviendrait
        // illisible POUR LES DEUX JOUEURS — durablement, le fichier etant en
        // ajout. On refuse plutot que d'abimer le fil sans retour.
        if (strpos($msg, "\n") !== false || strpos($msg, "\r") !== false) {
            fioFail('chat message must be a single line');
        }
        if (json_decode($msg) === null) {
            fioFail('chat message is not valid json');
        }
        if (!is_dir($matchPath)) {
            @mkdir($matchPath, 0775, true);
        }
        $line = $msg . "\n";
        // Un message a lui seul plus gros que le fil entier : rien a retirer
        // n'y changerait quoi que ce soit. C'est le seul refus qui reste, et
        // il porte sur CE message et non sur le fil — d'ou un libelle
        // different, les deux n'appelant pas la meme reaction : raccourcir,
        // ou rien.
        if (strlen($line) > $chatMaxBytes) {
            fioFail('chat message too large', 413);
        }
        /*
         * TOUT SOUS UN VERROU EXCLUSIF.
         *
         * L'ajout seul pouvait s'en passer : une ecriture courte en mode 'a'
         * est atomique. Retirer les premiers messages ne l'est pas — c'est
         * lire, recomposer, reecrire — et un ajout de l'adversaire tombant au
         * milieu serait perdu. Le meme verrou couvre donc les deux. La lecture
         * du fil ne le prend pas : elle ne fait que lire.
         *
         * 'c+' ouvre en lecture-ecriture sans tronquer et cree le fichier au
         * besoin : c'est ce qui permet de prendre le verrou AVANT de decider
         * quoi que ce soit.
         */
        $fp = @fopen($fn, 'c+');
        if ($fp === false) {
            fioFail('cannot write chat file', 500);
        }
        @flock($fp, LOCK_EX);
        $stat = fstat($fp);
        $size = $stat ? $stat['size'] : 0;
        $dropped = 0;
        if ($size + strlen($line) > $chatMaxBytes) {
            if (!$chatTrimOldest) {
                @flock($fp, LOCK_UN);
                fclose($fp);
                fioFail('chat log full', 413);
            }
            $target = $chatTrimTo;
            if ($target > $chatMaxBytes - strlen($line)) {
                $target = $chatMaxBytes - strlen($line);
            }
            if ($target < 0) {
                $target = 0;
            }
            rewind($fp);
            $content = stream_get_contents($fp);
            $lines = array();
            foreach (explode("\n", $content) as $one) {
                if ($one !== '') {
                    $lines[] = $one;
                }
            }
            // On retire par le DEBUT, un message a la fois, jusqu'a tenir sous
            // la cible. Un message est une ligne : le fil reste lisible a tout
            // moment, jamais coupe au milieu d'un JSON.
            $kept = $size;
            while ($kept > $target && count($lines) > 0) {
                $gone = array_shift($lines);
                $kept -= strlen($gone) + 1;
                $dropped++;
            }
            $rewritten = count($lines) ? implode("\n", $lines) . "\n" : '';
            ftruncate($fp, 0);
            rewind($fp);
            fwrite($fp, $rewritten);
        }
        fseek($fp, 0, SEEK_END);
        fwrite($fp, $line);
        fflush($fp);
        @flock($fp, LOCK_UN);
        fclose($fp);
        fioSweepChat();
        // `trimmed` : combien de messages ont ete retires pour loger celui-ci.
        // Un client qui l'ignore ne perd rien.
        echo json_encode(array('ok' => true, 'trimmed' => $dropped));
        exit;
    }

    if ($action === 'load') {
        clearstatcache(true, $fn);
        if (!file_exists($fn)) {
            // Pas encore de fil : {} plutot qu'un corps vide, pour que le
            // client n'ait pas a distinguer « absent » de « illisible ».
            echo '{}';
            exit;
        }
        $msgs = array();
        $fp = @fopen($fn, 'rb');
        if ($fp !== false) {
            while (($line = fgets($fp)) !== false) {
                $line = rtrim($line, "\r\n");
                if ($line === '') {
                    continue;
                }
                // Une ligne abimee — ecriture interrompue, disque plein — ne
                // doit pas rendre tout le fil illisible : on la saute.
                if (json_decode($line) === null) {
                    continue;
                }
                $msgs[] = $line;
            }
            fclose($fp);
        }
        echo '{"messages":[' . implode(',', $msgs) . ']}';
        exit;
    }

    fioFail('unknown chat action');
}

// ── Partie : traduction, puis delegation a match.php ─────────────────────────

if (!isset($_POST['gameioaction'])) {
    fioFail('unknown action');
}

$_POST['action'] = $_POST['gameioaction'];
$_POST['mid'] = $gameid;
if (isset($_POST['gamedata'])) {
    $_POST['data'] = $_POST['gamedata'];
}
// L'attente longue porte le meme sens des deux cotes. Tabulon ne s'en sert pas
// (buildLoadBody n'envoie que l'action et l'identifiant) : la traduction est
// donc pour les autres clients du dialecte, pas pour lui.
if (isset($_POST['sinceMtime'])) {
    $_POST['since'] = $_POST['sinceMtime'];
}

// Un drop efface AUSSI le fil : c'est la fin de vie normale d'une partie, et
// laisser la conversation derriere elle obligerait a attendre le menage.
// Un drop passe directement a match.php, lui, ne connait pas le fil — il
// restera au balayage. C'est assume : match.php n'a pas a apprendre un format
// qu'il ne sert pas.
if ($_POST['action'] === 'drop') {
    @unlink(fioChatFile($gameid));
}

// match.php emet X-Match-Mtime ; le dialecte joclymatch lit X-File-Mtime. On
// pose l'alias juste avant l'envoi des en-tetes plutot que de dupliquer la
// logique de match.php — c'est elle qui connait la date d'ecriture, et la
// dupliquer voudrait dire la tenir a jour en deux endroits pour toujours.
if (function_exists('header_register_callback')) {
    header_register_callback(function () {
        foreach (headers_list() as $h) {
            if (stripos($h, 'X-Match-Mtime:') === 0) {
                header('X-File-Mtime: ' . trim(substr($h, strlen('X-Match-Mtime:'))));
                return;
            }
        }
    });
}

require __DIR__ . '/match.php';
