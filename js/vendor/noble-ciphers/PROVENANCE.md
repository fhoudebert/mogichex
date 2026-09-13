# @noble/ciphers — sous-ensemble embarqué

`@noble/ciphers` **2.4.0**, MIT (Paul Miller) — voir `LICENSE`.
Origine : <https://github.com/paulmillr/noble-ciphers>

Quatre fichiers du paquet publié, **copiés tels quels, sans retouche** :

| Fichier | Rôle |
|---|---|
| `chacha.js` | `xchacha20poly1305` — le seul export utilisé |
| `_arx.js` | noyau ChaCha, importé par `chacha.js` |
| `_poly1305.js` | l'authentificateur, importé par `chacha.js` |
| `utils.js` | fonctions communes, importées par les trois autres |

Ce sont exactement les fichiers atteignables depuis `chacha.js` : rien de plus,
et rien à retirer sans casser un import. Ils s'importent déjà entre eux en
relatif (`./utils.js`), donc aucune réécriture de chemin n'a été nécessaire —
c'est ce qui rend la mise à jour triviale : `npm pack @noble/ciphers`, recopier
les quatre fichiers, relancer `npm test`.

## Pourquoi du code tiers dans un projet qui n'en a pas

mogichex n'a aucune dépendance à l'exécution, et ce fichier explique pourquoi
il y a maintenant une exception.

**Le navigateur ne sait pas faire XChaCha.** `crypto.subtle` ne propose
qu'AES-GCM. Passer à AES-GCM aurait résolu la dépendance et **cassé
l'interopérabilité avec Tabulon**, qui scelle en XChaCha20-Poly1305 — or c'est
précisément l'interopérabilité qui justifie tout ce portage : lien
d'invitation, enveloppe de partie et relai sont déjà communs aux deux
applications, la discussion n'avait aucune raison de faire exception.

**Et il ne fallait pas l'écrire à la main.** ChaCha20 et Poly1305 sont
add-rotate-xor : pas une table, pas un branchement sur des données secrètes —
c'est ce qui en fait les bonnes primitives *en logiciel*, là où un AES écrit en
JS serait dangereux (tables, donc temps variable). Mais Poly1305 demande une
arithmétique par membres de 32 bits qui se rate **silencieusement** : elle rend
des résultats plausibles et un sceau qui ne protège rien. Une implémentation
auditée coûte 82 Ko non minifiés — à comparer aux 85 Mo de l'APK.

## Vérifié, pas supposé

`tests/test-mogichex.mjs` compare les octets produits à des **vecteurs de
libsodium** (`crypto_aead_xchacha20poly1305_ietf`). C'est ce que la caisse Rust
`chacha20poly1305` implémente aussi, donc un message scellé ici s'ouvre dans
Tabulon, et réciproquement. Un test de bout en bout sur la même machine ne
l'aurait pas prouvé : deux implémentations fausses de la même façon
s'accordent très bien entre elles.
