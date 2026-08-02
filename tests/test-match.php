<?php
// Test des fichiers de partie, execute par le php-cli.
//
//   php tests/test-match.php
//
// COUVERT : validation de l'identifiant, refus des traversees, aller-retour
// de l'enveloppe joclymatch, JSON valide meme sur partie absente, plafond de
// charge, effacement, atomicite de l'ecriture sous concurrence.
// NON COUVERT : les limites de l'hebergeur (max_execution_time, nombre de
// processus). A verifier en ligne.

$failures = 0;
$tests = 0;
function check($label, $cond) {
    global $failures, $tests;
    $tests++;
    echo ($cond ? "ok   " : "FAIL ") . $label . "\n";
    if (!$cond) { $failures++; }
}

$tmp = sys_get_temp_dir() . '/mogichex-match-' . getmypid() . '/';
@mkdir($tmp, 0775, true);

// Les champs POST transitent par un fichier : un etat de partie realiste
// depasse la longueur maximale d'une ligne de commande.
function postFile($post) {
    global $tmp;
    $f = tempnam($tmp, 'post');
    file_put_contents($f, json_encode($post));
    return $f;
}

function request($post) {
    global $tmp;
    $f = postFile($post);
    $cmd = escapeshellcmd(PHP_BINARY) . ' ' . escapeshellarg(__DIR__ . '/match-runner.php') . ' '
        . escapeshellarg($f) . ' ' . escapeshellarg($tmp);
    $out = shell_exec($cmd);
    @unlink($f);
    return $out;
}

// --- identifiants refuses
$r = json_decode(request(array('action' => 'load', 'mid' => 'court')), true);
check('identifiant trop court refuse', isset($r['error']));
$r = json_decode(request(array('action' => 'load', 'mid' => '../../etc/passwd')), true);
check('traversee de repertoire refusee', isset($r['error']));
$r = json_decode(request(array('action' => 'load', 'mid' => 'avec.point')), true);
check('un point dans l\'identifiant est refuse', isset($r['error']));

$mid = '1754035200000-AbCdEfGhIjKlMn'; // format joclymatch reel

// --- partie jamais sauvegardee
$r = json_decode(request(array('action' => 'load', 'mid' => $mid)), true);
check('partie absente : JSON valide et vide, pas de corps nul', is_array($r) && count($r) === 0);

// --- aller-retour de l'enveloppe joclymatch
$env = array(
    'matchDetails' => array('matchId' => $mid, 'gameName' => 'classic-chess', 'nbTurns' => 3),
    'matchdata' => array('moves' => array('e4', 'e5'), 'state' => 'xyz'),
    'time' => 1754035200000,
    'key' => 'abcd1234',
);
$r = json_decode(request(array('action' => 'save', 'mid' => $mid, 'data' => json_encode($env))), true);
check('sauvegarde acceptee', isset($r['ok']) && $r['ok'] === true);

$back = json_decode(request(array('action' => 'load', 'mid' => $mid)), true);
check('enveloppe relue a l\'identique',
    $back['matchDetails']['gameName'] === 'classic-chess'
    && $back['matchDetails']['nbTurns'] === 3
    && $back['matchdata']['moves'][1] === 'e5'
    && $back['key'] === 'abcd1234');

// --- charge non-JSON refusee
$r = json_decode(request(array('action' => 'save', 'mid' => $mid, 'data' => 'pas du json')), true);
check('charge non-JSON refusee', isset($r['error']));
$back = json_decode(request(array('action' => 'load', 'mid' => $mid)), true);
check('une charge refusee n\'ecrase pas la partie', $back['matchDetails']['nbTurns'] === 3);

// --- plafond
$big = json_encode(array('x' => str_repeat('a', 1100000)));
$r = json_decode(request(array('action' => 'save', 'mid' => $mid, 'data' => $big)), true);
check('charge de plus d\'1 Mo refusee', isset($r['error']));

// --- attente longue : rien de neuf, reponse quand meme valide
$t0 = microtime(true);
$r = json_decode(request(array('action' => 'load', 'mid' => $mid, 'since' => time() + 60)), true);
$elapsed = microtime(true) - $t0;
check('attente longue bornee (>= 15 s, < 30 s)', $elapsed >= 15 && $elapsed < 30);
check('apres attente sans changement, JSON toujours valide', is_array($r));

// --- ecriture atomique sous concurrence : jamais de fichier a moitie ecrit
// Sans rename() atomique, un load() concurrent lit un fichier vide ou tronque.
// Mesure de reference sur une copie privee de l'atomicite : 4 lectures
// incompletes sur ~1100 ; avec rename() : 0 sur ~1100. Le test ne vaut que
// parce qu'il DISCRIMINE — une premiere version, qui ignorait les lectures
// vides, passait dans les deux cas et ne prouvait rien.
$flag = $tmp . 'GO';
@unlink($flag);
$procs = array();
$files = array();
for ($i = 0; $i < 6; $i++) {
    $env['matchDetails']['nbTurns'] = $i;
    $env['matchdata']['pad'] = str_repeat('x', 200000); // assez gros pour etre coupable
    $f = postFile(array('action' => 'save', 'mid' => $mid, 'data' => json_encode($env)));
    $files[] = $f;
    $cmd = escapeshellcmd(PHP_BINARY) . ' ' . escapeshellarg(__DIR__ . '/match-runner.php') . ' '
        . escapeshellarg($f) . ' ' . escapeshellarg($tmp) . ' > /dev/null 2>&1 &';
    $procs[] = popen($cmd, 'r');
}
$bad = 0;
$reads = 0;
$until = microtime(true) + 3;
while (microtime(true) < $until) {
    // Le fichier VIDE compte comme lecture incomplete : c'est exactement
    // l'etat qu'un fopen('wb') expose entre la troncature et la fin de
    // l'ecriture, et c'est ce que rename() supprime.
    clearstatcache(true, matchFileForTest($tmp, $mid));
    if (file_exists(matchFileForTest($tmp, $mid))) {
        $reads++;
        $raw = @file_get_contents(matchFileForTest($tmp, $mid));
        if ($raw === false || json_decode($raw, true) === null) { $bad++; }
    }
    usleep(2000);
}
foreach ($procs as $ph) { pclose($ph); }
foreach ($files as $f) { @unlink($f); }
check("$reads lectures pendant 6 ecritures concurrentes : aucune tronquee", $reads > 0 && $bad === 0);

function matchFileForTest($dir, $mid) { return $dir . $mid . '.json'; }

// --- effacement
request(array('action' => 'drop', 'mid' => $mid));
$r = json_decode(request(array('action' => 'load', 'mid' => $mid)), true);
check('partie effacee', is_array($r) && count($r) === 0);

// --- rien n'est ecrit hors du repertoire prevu
// (le depot contient deja package.json a la racine : on regarde deploy/,
// seul endroit ou match.php pourrait creer son stockage par defaut)
check('aucun fichier de partie ecrit dans deploy/',
    !file_exists(__DIR__ . '/../deploy/matches') && count(glob(__DIR__ . '/../deploy/*.json')) === 0);

array_map('unlink', glob($tmp . '*'));
@rmdir($tmp);
echo "\n$tests tests, $failures echec(s)\n";
exit($failures === 0 ? 0 : 1);
