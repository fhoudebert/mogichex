// Classe d'appareil : 'phone' ou 'tablet'.
//
// Detection par capacite (taille du viewport + finesse du pointeur) et non par
// user-agent : l'user-agent ment, se perime, et ne dit rien d'une fenetre
// redimensionnee. Un pointeur grossier (doigt) sur un petit cote < 600 px =
// telephone.
//
// Ce n'est qu'un DEFAUT : le reglage « afficher tous les jeux » prime toujours
// (etude §4.3). Un filtre qu'on ne peut pas desactiver est vecu comme une panne.

export const PHONE_MAX_SHORT_SIDE = 600;

/** Pure, donc testable : on lui passe les mesures plutot que de les lire. */
export function classify({ shortSide, coarsePointer }) {
    if (!coarsePointer) return 'tablet'; // souris = ecran de bureau
    return shortSide < PHONE_MAX_SHORT_SIDE ? 'phone' : 'tablet';
}

export function detectTier(win = window) {
    const shortSide = Math.min(win.innerWidth, win.innerHeight);
    const coarsePointer = !!(win.matchMedia && win.matchMedia('(pointer: coarse)').matches);
    return classify({ shortSide, coarsePointer });
}
