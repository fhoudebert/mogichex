<?php
// Execute UN appel a deploy/match.php dans un processus isole.
// match.php se termine par exit() : il ne peut pas etre inclus deux fois dans
// le meme processus. Utilise par tests/test-match.php.
//
//   php tests/match-runner.php <fichier-json-des-champs-POST> <repertoire>
//
// Les champs POST passent par un FICHIER et non par la ligne de commande :
// un etat de partie realiste depasse la longueur maximale d'une commande
// (« Argument list too long »), ce qui rendait le test de concurrence
// inexecutable.

$_POST = json_decode(file_get_contents($argv[1]), true);
$_SERVER['REQUEST_METHOD'] = 'POST';
$matchPath = $argv[2];
$matchTTL = 3600;
$signalOrigins = array();
require __DIR__ . '/../deploy/match.php';
