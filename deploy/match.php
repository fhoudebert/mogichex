<?php
// match.php — fichiers de partie de mogichex.
//
// A deposer a cote de signal.php sur l'hebergement mutualise. mogichex a ses
// PROPRES fichiers de partie : il ne partage pas le stockage de joclymatch.
// Deux applications qui ecrivent dans le meme repertoire, ce sont deux
// formats qui doivent rester d'accord pour toujours, et une purge de l'une
// qui efface les parties de l'autre.
//
// L'ENVELOPPE, elle, reste celle de joclymatch —
// { matchDetails, matchdata, time, key } — pour que les deux applications
// restent lisibles l'une par l'autre le jour ou on le voudra.
//
// Protocole (POST, application/x-www-form-urlencoded) :
//   action=save mid=<id> data=<json>            -> ecrit l'etat
//   action=load mid=<id> [since=<mtime>]        -> lit ; avec since, ATTEND
//                                                  un changement (20 s max)
//   action=drop mid=<id>                        -> efface
// Reponse : toujours du JSON valide. L'en-tete X-Match-Mtime porte la date de
// derniere ecriture, a renvoyer telle quelle en `since` au tour suivant.
//
// Trois lecons deja payees, appliquees ici comme dans signal.php :
//   - AUCUNE balise fermante PHP, nulle part, pas meme en commentaire : elle
//     ferme le bloc et le reste du fichier part en texte brut ;
//   - tout ce que la configuration locale pourrait afficher est jete sous
//     tampon avant qu'un octet de JSON ne parte ;
//   - un identifiant qui devient un nom de fichier est valide par motif
//     regulier avant tout usage.

ob_start();
if (file_exists(__DIR__ . '/matchconf.php')) {
    require __DIR__ . '/matchconf.php';
} elseif (file_exists(__DIR__ . '/signalconf.php')) {
    // Un seul fichier de configuration suffit si on veut : signal.php et
    // match.php partagent les memes reglages d'origines autorisees.
    require __DIR__ . '/signalconf.php';
}
ob_end_clean();

if (!isset($matchPath)) {
    $matchPath = __DIR__ . '/matches/';
}
// Une partie abandonnee ne doit pas rester indefiniment. 30 jours laisse le
// temps de reprendre une partie par correspondance.
if (!isset($matchTTL)) {
    $matchTTL = 30 * 24 * 3600;
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

function fail($msg, $code = 400) {
    http_response_code($code);
    echo json_encode(array('error' => $msg));
    exit;
}

$action = isset($_POST['action']) ? $_POST['action'] : '';
$mid = isset($_POST['mid']) ? $_POST['mid'] : '';

// Format joclymatch : <horodatage>-<14 caracteres>. On accepte plus large
// (6 a 64 alphanumeriques, tiret et souligne) sans jamais laisser passer un
// point ni une barre : ce serait une traversee de repertoire.
if (!preg_match('/^[A-Za-z0-9_-]{6,64}$/', $mid)) {
    fail('bad match id');
}

if (!is_dir($matchPath)) {
    @mkdir($matchPath, 0775, true);
}
if (!is_dir($matchPath)) {
    fail('storage unavailable', 500);
}

function matchFile($mid) {
    global $matchPath;
    return $matchPath . $mid . '.json';
}

// Menage opportuniste, borne : pas de cron sur un mutualise.
function sweep() {
    global $matchPath, $matchTTL;
    $dh = @opendir($matchPath);
    if (!$dh) {
        return;
    }
    $seen = 0;
    while (($f = readdir($dh)) !== false && $seen < 40) {
        if (substr($f, -5) !== '.json') {
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

$fn = matchFile($mid);

if ($action === 'save') {
    $data = isset($_POST['data']) ? $_POST['data'] : '';
    // Un etat de partie complet (match.save()) reste petit, mais un plateau
    // 16x16 avec un long historique n'est pas minuscule non plus.
    if (strlen($data) > 1048576) {
        fail('payload too large', 413);
    }
    if (json_decode($data) === null) {
        fail('data is not valid json');
    }
    // Ecriture ATOMIQUE : un load() concurrent ne doit jamais lire un fichier
    // a moitie ecrit. Meme protection que fileio.php de joclymatch.
    $tmp = $fn . '.tmp' . uniqid('', true);
    $fp = @fopen($tmp, 'wb');
    if ($fp === false) {
        fail('cannot write match file', 500);
    }
    fwrite($fp, $data);
    fclose($fp);
    if (!@rename($tmp, $fn)) {
        @unlink($tmp);
        fail('cannot commit match file', 500);
    }
    clearstatcache(true, $fn);
    $mtime = filemtime($fn);
    header('X-Match-Mtime: ' . $mtime);
    sweep();
    echo json_encode(array('ok' => true, 'mtime' => $mtime));
    exit;
}

if ($action === 'load') {
    // Attente longue optionnelle : si le client envoie `since`, on ne repond
    // qu'une fois le fichier plus recent que cette date. Bornee a 20 s, sous
    // le max_execution_time habituel d'un mutualise. Sans `since`, reponse
    // immediate — c'est le comportement au premier chargement.
    if (isset($_POST['since']) && is_numeric($_POST['since'])) {
        $since = (int) $_POST['since'];
        $deadline = microtime(true) + 20;
        while (microtime(true) < $deadline) {
            clearstatcache(true, $fn);
            if (file_exists($fn) && filemtime($fn) > $since) {
                break;
            }
            usleep(300000);
        }
    }
    clearstatcache(true, $fn);
    if (file_exists($fn)) {
        $mtime = filemtime($fn);
        header('X-Match-Mtime: ' . $mtime);
        $raw = @file_get_contents($fn);
        // On renvoie l'enveloppe telle quelle, mais jamais un corps qui ne
        // serait pas du JSON : le client fait JSON.parse sans filet.
        if ($raw !== false && json_decode($raw) !== null) {
            echo $raw;
        } else {
            echo '{}';
        }
    } else {
        // Partie jamais sauvegardee : {} plutot qu'un corps vide, pour que le
        // client n'ait pas a distinguer « absent » de « illisible ».
        header('X-Match-Mtime: 0');
        echo '{}';
    }
    exit;
}

if ($action === 'drop') {
    @unlink($fn);
    echo json_encode(array('ok' => true));
    exit;
}

fail('unknown action');
