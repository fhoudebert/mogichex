<?php
// Execute UN appel a deploy/fileio.php dans un processus isole.
// Meme raison que match-runner.php : le script se termine par exit(), il ne
// peut donc pas etre inclus deux fois dans le meme processus. Et fileio.php
// delegue a match.php, qui a la meme propriete.
//
//   php tests/fileio-runner.php <fichier-json-des-champs-POST> <repertoire>
//
// Les champs POST passent par un FICHIER et non par la ligne de commande : un
// etat de partie realiste depasse la longueur maximale d'une commande.
//
// Le code de reponse est ecrit sur la SORTIE D'ERREUR : en CLI, header() est
// sans effet et headers_list() reste vide, donc c'est le seul moyen de le
// verifier sans monter un vrai serveur. Les EN-TETES, eux, ne sont pas
// observables ici — ils le sont dans la sonde HTTP.

$_POST = json_decode(file_get_contents($argv[1]), true);
$_SERVER['REQUEST_METHOD'] = 'POST';
$matchPath = $argv[2];
$matchTTL = 3600;
$signalOrigins = array();

register_shutdown_function(function () {
    fwrite(STDERR, 'HTTP ' . http_response_code() . "\n");
});

require __DIR__ . '/../deploy/fileio.php';
