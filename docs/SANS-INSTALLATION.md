# Jouer sans rien installer

Ce fichier existe parce que l'installation de l'APK a échoué sur le téléphone de l'autre joueur,
et qu'on ne peut pas déboguer ça à distance. `dist/chess-standalone.html` supprime l'installation,
le serveur et le réseau du chemin critique : **un seul fichier, ouvert dans n'importe quel
navigateur.**

Aucune installation. Aucun hotspot. Aucune connexion. Aucun compte.

## Deux façons de jouer

### À deux sur un seul téléphone
Ouvrez le fichier → **Sur un seul téléphone**. Vous jouez à tour de rôle sur le même écran, et le
plateau se retourne tout seul à chaque coup pour être toujours dans le bon sens.

### Chacun sur son téléphone
Chacun ouvre le fichier de son côté → **Sur deux téléphones** → chacun choisit sa couleur (l'un
les blancs, l'autre les noirs).

Ensuite, à chaque fois que vous jouez, l'app affiche en gros le coup à annoncer — par exemple
**e4**. Vous le dites à voix haute, l'autre le saisit dans son champ, et les deux plateaux
restent identiques.

La saisie accepte ce qu'un joueur dit naturellement :

| Vous dites | Écrivez |
| --- | --- |
| « e4 » | `e4` |
| « Cavalier f3 » | `Cf3` (ou `Nf3`) |
| « Petit roque » | `O-O` (ou `0-0`) |
| Les deux cases | `g1f3` |

Un coup impossible est refusé avec un message — la partie ne peut pas se désynchroniser.

## Ce que le fichier sait faire

Toutes les règles, sans exception : roque, prise en passant, promotion (avec choix de la pièce),
échec et mat, pat, triple répétition, règle des 50 coups, matériel insuffisant. Plus les points de
coups légaux, la surbrillance du dernier coup, le roi en échec marqué en rouge, la liste des coups
en notation, l'annulation et le retournement manuel du plateau.

## Comment l'ouvrir

**Android** — enregistrez le fichier, puis ouvrez-le depuis **Fichiers** ou **Téléchargements**.
Il s'ouvre dans Chrome. Pour un accès rapide : menu ⋮ → **Ajouter à l'écran d'accueil**.

**iPhone** — le plus simple est d'ouvrir le lien de la version en ligne **une seule fois** pendant
que vous avez encore du réseau, puis **Partager → Sur l'écran d'accueil**. Safari le garde en
cache et il s'ouvre ensuite en plein écran.

> Pourquoi pas le fichier directement sur iPhone : l'aperçu de l'app Fichiers n'exécute pas le
> JavaScript de façon fiable. Passer par Safari une fois règle le problème.

## Le reconstruire

```sh
node tools/build-standalone.mjs   # → dist/chess-standalone.html + dist/chess-artifact.html
node test/standalone.mjs          # 35 vérifications, dont « zéro requête réseau »
```

Le fichier est assemblé depuis `web/standalone/template.html` : chess.js et le sprite des pièces y
sont intégrés en dur. Le script de build **échoue** si le résultat contient la moindre référence
externe, `fetch`, `XMLHttpRequest` ou `WebSocket` — c'est ce qui garantit qu'il fonctionne hors
ligne pour toujours.
