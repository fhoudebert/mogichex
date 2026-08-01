<?php
// Execute UN appel a deploy/signal.php dans un processus isole.
// signal.php se termine par exit() : il ne peut pas etre inclus deux fois
// dans le meme processus. Utilise par tests/test-signal.php.
//
//   php tests/signal-runner.php '<json des champs POST>' '<repertoire>'

$_POST = json_decode($argv[1], true);
$_SERVER['REQUEST_METHOD'] = 'POST';
$signalPath = $argv[2];
$signalTTL = 3600;
$signalOrigins = array();
require __DIR__ . '/../deploy/signal.php';
