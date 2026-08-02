<?php
// signal.php — boite aux lettres de signalisation WebRTC pour mogichex.
//
// A deposer a cote de joclymatch sur l'hebergement mutualise. Ne remplace pas
// fileio.php : celui-ci porte l'ETAT de la partie (un blob par match), alors
// que la signalisation a besoin de DEUX boites independantes par salon (une
// par pair) et d'un ajout en fin de boite pour les candidats ICE. Les faire
// cohabiter dans le meme fichier ferait s'ecraser les deux pairs.
//
// Protocole (POST, application/x-www-form-urlencoded) :
//   action=post  room=<id> box=<a|b> data=<json>   -> ajoute un message
//   action=fetch room=<id> box=<a|b> since=<n>     -> messages d'index >= n
//                                                     (attend si aucun, 20 s)
//   action=drop  room=<id>                          -> efface le salon
// Reponse : {"messages":[...],"next":<n>} — toujours du JSON valide.
//
// On lit la boite de l'AUTRE pair et on ecrit dans la sienne.
//
// Trois lecons deja payees ailleurs, appliquees ici :
//   - JAMAIS la sequence de fermeture PHP dans un commentaire (elle ferme le
//     bloc et le reste du fichier part en texte brut) ; ce fichier n'a pas de
//     balise fermante du tout, ce qui supprime aussi le risque de ligne vide
//     parasite devant le JSON ;
//   - tout ce que la configuration locale pourrait afficher est jete sous
//     tampon avant qu'un seul octet de JSON ne parte ;
//   - les identifiants qui deviennent des noms de fichier sont valides par
//     motif regulier avant tout usage (traversee de repertoire).

ob_start();
if (file_exists(__DIR__ . '/signalconf.php')) {
    require __DIR__ . '/signalconf.php';
}
ob_end_clean();

// Repertoire de stockage. A placer HORS de la racine web si l'hebergeur le
// permet ; sinon proteger par le .htaccess fourni.
if (!isset($signalPath)) {
    $signalPath = __DIR__ . '/signals/';
}
// Duree de vie d'un salon. La signalisation est breve : passe ce delai le
// salon est un dechet, et le menage se fait a l'ecriture (pas de cron sur un
// hebergement mutualise).
if (!isset($signalTTL)) {
    $signalTTL = 3600;
}
// Origines autorisees. L'application peut etre servie depuis le meme domaine
// (aucun CORS necessaire), depuis GitHub Pages, ou depuis une coquille NATIVE
// dont l'origine n'est ni l'un ni l'autre (capacitor://localhost sous iOS,
// https://localhost sous Android, http://localhost en developpement).
// Sans cette liste, l'application embarquee recevrait un refus CORS.
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
$room   = isset($_POST['room']) ? $_POST['room'] : '';
$box    = isset($_POST['box']) ? $_POST['box'] : '';

// Le nom du salon devient un nom de fichier : motif strict, longueur bornee.
if (!preg_match('/^[A-Za-z0-9_-]{6,64}$/', $room)) {
    fail('bad room');
}
if ($action !== 'drop' && $box !== 'a' && $box !== 'b') {
    fail('bad box');
}

if (!is_dir($signalPath)) {
    @mkdir($signalPath, 0775, true);
}
if (!is_dir($signalPath)) {
    fail('storage unavailable', 500);
}

function boxFile($room, $box) {
    global $signalPath;
    return $signalPath . $room . '-' . $box . '.json';
}

// Menage opportuniste : quelques salons perimes a chaque ecriture. Borne a 40
// entrees pour ne pas transformer un POST en balayage de repertoire.
function sweep() {
    global $signalPath, $signalTTL;
    $dh = @opendir($signalPath);
    if (!$dh) {
        return;
    }
    $seen = 0;
    while (($f = readdir($dh)) !== false && $seen < 40) {
        if (substr($f, -5) !== '.json') {
            continue;
        }
        $seen++;
        $p = $signalPath . $f;
        if (@filemtime($p) < time() - $signalTTL) {
            @unlink($p);
        }
    }
    closedir($dh);
}

if ($action === 'post') {
    $data = isset($_POST['data']) ? $_POST['data'] : '';
    // Un message de signalisation est une description de session ou un
    // candidat ICE : quelques kilo-octets. Au-dela, ce n'est pas un usage
    // normal et le fichier n'a pas a grossir.
    if (strlen($data) > 16384) {
        fail('payload too large', 413);
    }
    if (json_decode($data) === null && trim($data) !== 'null') {
        fail('data is not valid json');
    }
    $fn = boxFile($room, $box);
    // Verrou exclusif : les deux pairs ecrivent des candidats ICE en rafale et
    // presque simultanement. Sans verrou, deux ajouts concurrents en perdent un.
    $fp = @fopen($fn, 'c+');
    if ($fp === false) {
        fail('cannot open box', 500);
    }
    flock($fp, LOCK_EX);
    $raw = stream_get_contents($fp);
    $msgs = $raw === '' ? array() : json_decode($raw, true);
    if (!is_array($msgs)) {
        $msgs = array();
    }
    // Garde-fou : un salon qui recoit des centaines de messages est un salon
    // qui tourne mal (ou qu'on abuse). On plafonne plutot que de laisser
    // grossir un fichier indefiniment.
    if (count($msgs) >= 200) {
        flock($fp, LOCK_UN);
        fclose($fp);
        fail('too many messages', 429);
    }
    $msgs[] = json_decode($data, true);
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($msgs));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    sweep();
    echo json_encode(array('ok' => true, 'next' => count($msgs)));
    exit;
}

if ($action === 'fetch') {
    $since = isset($_POST['since']) && is_numeric($_POST['since']) ? (int) $_POST['since'] : 0;
    $fn = boxFile($room, $box);
    // Attente longue, bornee a 20 s : sous le max_execution_time habituel des
    // hebergements mutualises (30 s), et assez court pour qu'un proxy ne
    // coupe pas la reponse. Le client rappelle en boucle.
    $deadline = microtime(true) + 20;
    do {
        clearstatcache(true, $fn);
        $msgs = array();
        if (file_exists($fn)) {
            $raw = @file_get_contents($fn);
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                $msgs = $decoded;
            }
        }
        if (count($msgs) > $since) {
            echo json_encode(array(
                'messages' => array_slice($msgs, $since),
                'next' => count($msgs),
            ));
            exit;
        }
        usleep(300000);
    } while (microtime(true) < $deadline);
    // Rien de neuf : reponse vide, le client rappelle. 'next' inchange.
    echo json_encode(array('messages' => array(), 'next' => $since));
    exit;
}

if ($action === 'drop') {
    @unlink(boxFile($room, 'a'));
    @unlink(boxFile($room, 'b'));
    echo json_encode(array('ok' => true));
    exit;
}

fail('unknown action');
