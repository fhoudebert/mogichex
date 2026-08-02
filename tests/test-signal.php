<?php
// Test du relai de signalisation, execute par le php-cli : on simule des
// requetes en remplissant $_POST et en capturant la sortie, sans serveur web.
//
//   php tests/test-signal.php
//
// Ce que ce test COUVRE : boites independantes par pair, ordre et index de
// reprise, validation du salon et de la charge, JSON valide en toute
// circonstance, effacement. Ce qu'il NE COUVRE PAS : le comportement sous
// concurrence reelle (deux processus PHP simultanes) et les limites propres a
// l'hebergeur (max_execution_time, nombre de processus). A verifier en ligne.

$failures = 0;
$tests = 0;

function check($label, $cond) {
    global $failures, $tests;
    $tests++;
    if ($cond) {
        echo "ok   $label\n";
    } else {
        $failures++;
        echo "FAIL $label\n";
    }
}

$tmp = sys_get_temp_dir() . '/mogichex-signal-' . getmypid() . '/';

// signal.php appelle exit() : on ne peut pas l'inclure plusieurs fois dans le
// meme processus. Chaque appel passe donc par un sous-processus php-cli.
function request($post) {
    global $tmp;
    $runner = __DIR__ . '/signal-runner.php';
    $cmd = escapeshellcmd(PHP_BINARY) . ' ' . escapeshellarg($runner) . ' '
        . escapeshellarg(json_encode($post)) . ' ' . escapeshellarg($tmp);
    return shell_exec($cmd);
}

@mkdir($tmp, 0775, true);

// --- salon invalide
$r = json_decode(request(array('action' => 'post', 'room' => 'x', 'box' => 'a', 'data' => '{}')), true);
check('salon trop court refuse', isset($r['error']));

$r = json_decode(request(array('action' => 'post', 'room' => '../evil-room', 'box' => 'a', 'data' => '{}')), true);
check('traversee de repertoire refusee', isset($r['error']));

// --- boite inconnue
$r = json_decode(request(array('action' => 'post', 'room' => 'room-0001', 'box' => 'c', 'data' => '{}')), true);
check('boite inconnue refusee', isset($r['error']));

// --- charge non-JSON
$r = json_decode(request(array('action' => 'post', 'room' => 'room-0001', 'box' => 'a', 'data' => 'pas du json')), true);
check('charge non-JSON refusee', isset($r['error']));

// --- depot et relecture
request(array('action' => 'post', 'room' => 'room-0001', 'box' => 'a', 'data' => '{"type":"offer"}'));
request(array('action' => 'post', 'room' => 'room-0001', 'box' => 'a', 'data' => '{"type":"candidate","n":1}'));
$r = json_decode(request(array('action' => 'fetch', 'room' => 'room-0001', 'box' => 'a', 'since' => 0)), true);
check('deux messages relus dans l\'ordre',
    count($r['messages']) === 2
    && $r['messages'][0]['type'] === 'offer'
    && $r['messages'][1]['n'] === 1);
check('index de reprise rendu', $r['next'] === 2);

// --- reprise partielle
$r = json_decode(request(array('action' => 'fetch', 'room' => 'room-0001', 'box' => 'a', 'since' => 1)), true);
check('reprise a l\'index rend le seul message neuf',
    count($r['messages']) === 1 && $r['messages'][0]['n'] === 1);

// --- boites independantes : ecrire en b ne touche pas a
request(array('action' => 'post', 'room' => 'room-0001', 'box' => 'b', 'data' => '{"type":"answer"}'));
$a = json_decode(request(array('action' => 'fetch', 'room' => 'room-0001', 'box' => 'a', 'since' => 0)), true);
$b = json_decode(request(array('action' => 'fetch', 'room' => 'room-0001', 'box' => 'b', 'since' => 0)), true);
check('les deux pairs ne s\'ecrasent pas',
    count($a['messages']) === 2 && count($b['messages']) === 1
    && $b['messages'][0]['type'] === 'answer');

// --- attente longue : rien de neuf => JSON valide et vide (borne a 20 s, on
// verifie surtout la forme de la reponse, pas la duree)
$t0 = microtime(true);
$r = json_decode(request(array('action' => 'fetch', 'room' => 'room-0002', 'box' => 'a', 'since' => 0)), true);
$elapsed = microtime(true) - $t0;
check('salon vide : reponse JSON valide et vide', is_array($r) && $r['messages'] === array() && $r['next'] === 0);
check('l\'attente est effectivement longue (>= 15 s) et bornee (< 30 s)', $elapsed >= 15 && $elapsed < 30);

// --- charge trop grosse
$big = json_encode(array('x' => str_repeat('a', 20000)));
$r = json_decode(request(array('action' => 'post', 'room' => 'room-0001', 'box' => 'a', 'data' => $big)), true);
check('charge de 20 Ko refusee', isset($r['error']));

// --- concurrence reelle : 40 depots au meme instant, aucun perdu
// C'est LA raison d'etre du verrou exclusif : les deux pairs emettent leurs
// candidats ICE en rafale. Le test ne DISCRIMINE que si les processus partent
// vraiment ensemble -- lances en sequence, ils s'echelonnent assez pour que la
// course ne se produise pas. D'ou le fichier drapeau qui leur sert de top.
// Mesure de reference sur une copie privee de flock : 1 message sur 40
// conserve ; avec le verrou : 40 sur 40.
$flag = $tmp . 'GO';
@unlink($flag);
$raceRunner = __DIR__ . '/signal-race-runner.php';
$procs = array();
for ($i = 0; $i < 40; $i++) {
    $post = json_encode(array('action' => 'post', 'room' => 'room-0003', 'box' => 'a',
        'data' => json_encode(array('n' => $i))));
    $cmd = escapeshellcmd(PHP_BINARY) . ' ' . escapeshellarg($raceRunner) . ' '
        . escapeshellarg($post) . ' ' . escapeshellarg($tmp) . ' ' . escapeshellarg($flag)
        . ' > /dev/null 2>&1 &';
    $procs[] = popen($cmd, 'r');
}
sleep(3);
touch($flag);
foreach ($procs as $ph) { pclose($ph); }
sleep(3);
$r = json_decode(request(array('action' => 'fetch', 'room' => 'room-0003', 'box' => 'a', 'since' => 0)), true);
check('40 depots simultanes : aucun message perdu (verrou exclusif)',
    count($r['messages']) === 40);

// --- effacement
request(array('action' => 'drop', 'room' => 'room-0001'));
$r = json_decode(request(array('action' => 'fetch', 'room' => 'room-0001', 'box' => 'b', 'since' => 0)), true);
check('salon efface : plus aucun message', count($r['messages']) === 0);

// --- menage : rien ne subsiste hors du repertoire prevu
check('aucun fichier ecrit hors du repertoire de signalisation',
    !file_exists(__DIR__ . '/../evil-room-a.json') && !file_exists(__DIR__ . '/../deploy/evil-room-a.json'));

array_map('unlink', glob($tmp . '*'));
@rmdir($tmp);

echo "\n$tests tests, $failures echec(s)\n";
exit($failures === 0 ? 0 : 1);
