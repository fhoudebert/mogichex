// Orientation de l'ecran — reglage « Automatique / Portrait / Paysage ».
//
// CE QUE CE MODULE NE FAIT PAS : rendre la rotation automatique. Elle l'est
// deja, sans lui :
//   - en PWA, manifest.webmanifest declare "orientation": "any" ;
//   - sous Capacitor, le gabarit Android ne pose AUCUN android:screenOrientation
//     sur l'activite, et declare configChanges="orientation|screenSize|…" :
//     l'activite n'est pas recreee, la WebView est simplement redimensionnee,
//     et jocly (jocly.embed.js, ecouteur « resize ») reinscrit le plateau.
// Dans les deux cas l'application suit le telephone… tant que la rotation
// automatique du SYSTEME est active. C'est le comportement Android attendu.
//
// CE QU'IL FAIT : permettre l'inverse — FIGER l'application en portrait ou en
// paysage quand on prefere jouer ainsi, ce que ni le manifeste ni le gabarit
// ne savent faire a la demande. Il passe par le greffon natif
// @capacitor/screen-orientation, expose par la passerelle Capacitor sous
// window.Capacitor.Plugins.ScreenOrientation (le natif injecte un mandataire
// par greffon installe : aucun import, aucun empaquetage necessaire).
//
// « Automatique » appelle unlock(), qui sur Android remet
// SCREEN_ORIENTATION_UNSPECIFIED : exactement l'etat d'origine, donc la
// rotation suit le reglage du systeme. Le greffon n'offre pas « fullSensor »
// (tourner MALGRE le verrou du systeme) ; c'est voulu ici — passer outre le
// choix fait dans les parametres rapides du telephone surprend plus qu'il ne
// sert. Voir android/README.md pour qui le voudrait quand meme.
//
// Hors Capacitor (navigateur, PWA) le reglage n'est pas propose :
// screen.orientation.lock() n'y est accepte qu'en plein ecran, et une option
// qui ne fait rien sans le dire se lit comme une panne.

export const ORIENTATION_KEY = 'orientation';
export const ORIENTATIONS = ['auto', 'portrait', 'landscape'];

/** Valeur memorisee → valeur sure ; toute valeur inconnue redevient 'auto'. */
export function sanitizeOrientation(value) {
    return ORIENTATIONS.includes(value) ? value : 'auto';
}

/**
 * Le moyen de figer l'orientation, ou null s'il n'y en a pas.
 * `win` est injectable pour les tests.
 */
export function orientationBackend(win = globalThis) {
    const plugin = win && win.Capacitor && win.Capacitor.Plugins && win.Capacitor.Plugins.ScreenOrientation;
    if (!plugin || typeof plugin.lock !== 'function' || typeof plugin.unlock !== 'function') return null;
    return {
        lock: (orientation) => plugin.lock({ orientation }),
        unlock: () => plugin.unlock(),
    };
}

/**
 * Applique le choix. Rend true si quelque chose a ete demande au systeme,
 * false s'il n'y a pas de moyen de le faire. Une erreur du greffon est
 * avalee : un ecran qui ne se fige pas ne doit pas empecher de jouer.
 */
export async function applyOrientation(choice, backend) {
    if (!backend) return false;
    const c = sanitizeOrientation(choice);
    try {
        if (c === 'auto') await backend.unlock();
        else await backend.lock(c);
        return true;
    } catch {
        return false;
    }
}
