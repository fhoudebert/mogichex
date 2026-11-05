// Genere par tools/build-android.mjs — ne pas editer a la main.
// L'origine d'une application native n'est ni le site ni GitHub Pages : le
// relai doit etre nomme en absolu, et son origine autorisee dans
// signalconf.php (capacitor://localhost, https://localhost y figurent deja).
//
// inviteBase, pour la meme raison : la page est servie depuis
// https://localhost, une origine valide qui ne designe RIEN chez le
// destinataire. Sans cette ligne, le lien d'invitation vaudrait
// « https://localhost/?game=… » — il se copie, il s'envoie, et il n'ouvre rien.
window.MOGICHEX_CONFIG = {
    distBase: 'dist/',
    relayUrl: 'https://www.biscandine.fr/variantes/mogichex',
    inviteBase: 'https://www.biscandine.fr/variantes/mogichex/index.html',
};
