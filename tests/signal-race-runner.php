<?php
// Depose UN message dans le relai, mais seulement apres l'apparition d'un
// fichier drapeau : c'est ce qui permet a N processus de partir VRAIMENT en
// meme temps. Sans ce top commun, les demarrages s'echelonnent et la course
// ne se produit pas (mesure : 12/12 messages conserves meme SANS verrou).
// Avec le top : 1/40 sans verrou, 40/40 avec.
//
//   php tests/signal-race-runner.php '<json POST>' '<repertoire>' '<drapeau>'

$_POST = json_decode($argv[1], true);
$_SERVER['REQUEST_METHOD'] = 'POST';
$signalPath = $argv[2];
$signalTTL = 3600;
$signalOrigins = array();
$flag = $argv[3];
$deadline = microtime(true) + 30;
while (!file_exists($flag) && microtime(true) < $deadline) {
    usleep(1000);
}
require __DIR__ . '/../deploy/signal.php';
