<?php
// Test du relai vu par un client joclymatch (Tabulon), execute par le php-cli.
//
//   php tests/test-fileio.php
//
// COUVERT : traduction du dialecte gameioaction/gameid/gamedata vers
// action/mid/data, validation de l'identifiant sur CE chemin aussi, fil de
// discussion ajoute ligne par ligne, refus d'une ligne multiligne, plafond du
// fil, effacement du fil avec la partie, tolerance aux lignes abimees.
// NON COUVERT : les en-tetes de reponse (X-File-Mtime) — header() est sans
// effet en CLI. Ils se verifient avec un vrai serveur ; voir la sonde HTTP.

$failures = 0;
$tests = 0;
function check($label, $cond) {
    global $failures, $tests;
    $tests++;
    echo ($cond ? "ok   " : "FAIL ") . $label . "\n";
    if (!$cond) { $failures++; }
}

$tmp = sys_get_temp_dir() . '/mogichex-fileio-' . getmypid() . '/';
@mkdir($tmp, 0775, true);

function postFile($post) {
    global $tmp;
    $f = tempnam($tmp, 'post');
    file_put_contents($f, json_encode($post));
    return $f;
}

/** Rend array(corps, code http). */
function request($post) {
    global $tmp;
    $f = postFile($post);
    $cmd = escapeshellcmd(PHP_BINARY) . ' ' . escapeshellarg(__DIR__ . '/fileio-runner.php') . ' '
        . escapeshellarg($f) . ' ' . escapeshellarg($tmp) . ' 2>' . escapeshellarg($f . '.err');
    $out = shell_exec($cmd);
    $err = @file_get_contents($f . '.err');
    @unlink($f);
    @unlink($f . '.err');
    $code = preg_match('/HTTP (\d+)/', (string) $err, $m) ? (int) $m[1] : 0;
    return array($out, $code);
}

$mid = '1754035200000-AbCdEfGhIjKlMn'; // format joclymatch reel

// --- l'identifiant est valide sur CE chemin aussi -----------------------------
//
// La traduction a lieu avant la delegation : si elle n'etait pas gardee ici,
// ce fichier ouvrirait une porte que match.php ferme.
list($body, $code) = request(array('gameioaction' => 'load', 'gameid' => '../../etc/passwd'));
$r = json_decode($body, true);
check('traversee de repertoire refusee', isset($r['error']) && $code === 400);
list($body,) = request(array('gameioaction' => 'load', 'gameid' => 'court'));
check('identifiant trop court refuse', isset(json_decode($body, true)['error']));
list($body,) = request(array('chatioaction' => 'load', 'gameid' => 'avec.point'));
check('et sur le chemin de la discussion aussi',
    isset(json_decode($body, true)['error']));

// --- traduction du dialecte ---------------------------------------------------
$env = array(
    'matchDetails' => array('matchId' => $mid, 'gameName' => 'classic-chess', 'nbTurns' => 3),
    'matchdata' => array('playedMoves' => array('e4', 'e5')),
    'time' => 1754035200000,
    'key' => 'tabulon',
);
list($body,) = request(array('gameioaction' => 'save', 'gameid' => $mid, 'gamedata' => json_encode($env)));
$r = json_decode($body, true);
check('sauvegarde acceptee en dialecte joclymatch', isset($r['ok']) && $r['ok'] === true);
check('elle ecrit le fichier de match.php', file_exists($tmp . $mid . '.json'));

list($body,) = request(array('gameioaction' => 'load', 'gameid' => $mid));
$back = json_decode($body, true);
check('relue a l\'identique par le meme dialecte',
    $back['matchDetails']['gameName'] === 'classic-chess' && $back['matchDetails']['nbTurns'] === 3);

// Et l'autre dialecte lit la meme partie : c'est tout l'interet — un joueur
// mogichex et un joueur Tabulon dans la MEME partie.
$cmd = escapeshellcmd(PHP_BINARY) . ' ' . escapeshellarg(__DIR__ . '/match-runner.php') . ' '
    . escapeshellarg(postFile(array('action' => 'load', 'mid' => $mid))) . ' ' . escapeshellarg($tmp);
$back2 = json_decode(shell_exec($cmd), true);
check('et le dialecte de mogichex lit la meme partie',
    isset($back2['matchDetails']) && $back2['matchDetails']['nbTurns'] === 3);

// --- la discussion ------------------------------------------------------------
$m1 = json_encode(array('data' => array('msg' => 'bonjour', 'player' => 1, 'time' => 1, 'key' => 'aa')));
$m2 = json_encode(array('data' => array('msg' => 'salut', 'player' => -1, 'time' => 2, 'key' => 'bb')));

list($body,) = request(array('chatioaction' => 'load', 'gameid' => $mid));
check('fil absent : JSON valide et vide', json_decode($body, true) === array());

list($body,) = request(array('chatioaction' => 'save', 'gameid' => $mid, 'chatmsg' => $m1));
check('premier message accepte', isset(json_decode($body, true)['ok']));
list($body,) = request(array('chatioaction' => 'save', 'gameid' => $mid, 'chatmsg' => $m2));
check('second message accepte', isset(json_decode($body, true)['ok']));

list($body,) = request(array('chatioaction' => 'load', 'gameid' => $mid));
$fil = json_decode($body, true);
check('les DEUX joueurs sont dans le meme fil',
    isset($fil['messages']) && count($fil['messages']) === 2
    && $fil['messages'][0]['data']['msg'] === 'bonjour'
    && $fil['messages'][1]['data']['player'] === -1);
check('le fil est un fichier a part, pas la cle de la partie',
    file_exists($tmp . $mid . '-chat.jsonl') && file_exists($tmp . $mid . '.json'));

// --- une ligne de trop casserait le fil pour les DEUX joueurs ------------------
list($body, $code) = request(array('chatioaction' => 'save', 'gameid' => $mid,
    'chatmsg' => '{"data":{"msg":"deux' . "\n" . 'lignes"}}'));
check('un message multiligne est refuse', isset(json_decode($body, true)['error']) && $code === 400);
list($body,) = request(array('chatioaction' => 'save', 'gameid' => $mid, 'chatmsg' => 'pas du json'));
check('un message qui n\'est pas du JSON est refuse', isset(json_decode($body, true)['error']));
list($body,) = request(array('chatioaction' => 'load', 'gameid' => $mid));
check('et le fil est intact apres ces refus',
    count(json_decode($body, true)['messages']) === 2);

// --- une ligne abimee ne rend pas tout le fil illisible ------------------------
file_put_contents($tmp . $mid . '-chat.jsonl', "{\"data\":{\"msg\":\"tronq\n", FILE_APPEND);
list($body,) = request(array('chatioaction' => 'load', 'gameid' => $mid));
$fil = json_decode($body, true);
check('une ligne abimee est sautee, le reste passe',
    is_array($fil) && isset($fil['messages']) && count($fil['messages']) === 2);

// --- plafond ------------------------------------------------------------------
// On remplit jusqu'au plafond, puis on verifie que le message SUIVANT est
// refuse plutot que le debut du fil tronque : perdre le debut d'une
// conversation sans le dire serait pire que refuser la suite en le disant.
$gros = $mid . '-plein';
$bourrage = json_encode(array('data' => array('msg' => str_repeat('x', 4000), 'player' => 1,
    'time' => 1, 'key' => 'cc')));
$acceptes = 0;
for ($i = 0; $i < 80; $i++) {
    list($body,) = request(array('chatioaction' => 'save', 'gameid' => $gros, 'chatmsg' => $bourrage));
    $rep = json_decode($body, true);
    if (isset($rep['error'])) { break; }
    $acceptes++;
}
check('le fil se remplit puis refuse', $acceptes > 0 && $acceptes < 80);
list($body, $code) = request(array('chatioaction' => 'save', 'gameid' => $gros, 'chatmsg' => $bourrage));
check('le refus est un 413 nomme', $code === 413
    && json_decode($body, true)['error'] === 'chat log full');
list($body,) = request(array('chatioaction' => 'load', 'gameid' => $gros));
check('et ce qui etait dit reste lisible',
    count(json_decode($body, true)['messages']) === $acceptes);

// --- effacement ---------------------------------------------------------------
list($body,) = request(array('gameioaction' => 'drop', 'gameid' => $mid));
check('effacement accepte', isset(json_decode($body, true)['ok']));
check('la partie est effacee', !file_exists($tmp . $mid . '.json'));
check('et le fil avec elle', !file_exists($tmp . $mid . '-chat.jsonl'));

// --- actions inconnues --------------------------------------------------------
list($body,) = request(array('gameid' => $mid));
check('une requete sans action est refusee', isset(json_decode($body, true)['error']));
list($body,) = request(array('chatioaction' => 'inconnue', 'gameid' => $mid));
check('une action de discussion inconnue est refusee',
    isset(json_decode($body, true)['error']));

// --- menage -------------------------------------------------------------------
foreach (glob($tmp . '*') as $f) { @unlink($f); }
@rmdir($tmp);

echo "\n$tests verifications, $failures echec(s)\n";
exit($failures ? 1 : 0);
