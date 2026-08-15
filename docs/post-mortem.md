# Post-mortem — Music Runes (prototype gelé le 2026-08-14)

**Statut : prototype gelé** sur décision du designer, après 5 playtests, un
audit de game design et un pivot complet du scoring — le feeling de jeu n'est
pas venu. Tag : `v0-prototype`. Le jeu reste jouable et le code cannibalisable.

## La question posée, et la réponse

**Question** : un deckbuilder musical où l'on compose des mix en posant des
cartes-samples (le concept DropMix, revisité solo/mobile) peut-il produire un
vrai *jeu* — tension, enjeu, accomplissement — et pas seulement un jouet
sonore agréable ?

**Réponse du prototype : non, pas avec cet acte central.** Le verdict est
tombé alors que tous les correctifs classiques étaient en place — c'est ce qui
rend la réponse fiable.

## Chronologie des hypothèses

| Étape | Hypothèse | Résultat en playtest |
|---|---|---|
| M0-M4 : boucle de base (plateau persistant, scoring par paires, mix temps réel) | Le noyau GDD suffit à créer l'intérêt | « Rigolo mais on est livré à soi-même » — pas d'objectif incarné |
| M5 : tournée, scènes, tutoriel progressif, économie/boutique | La progression EST la récompense | Structure appréciée, mais « on pose en vrac » persiste |
| Leads 4 mesures + climax, écho, 8-bit, progression d'accords Am→F→C→G | La musique générique est une cause du désintérêt | Musique « un peu mieux » — le fond du problème est ailleurs |
| Pictos de consigne, liens entre disques, réactions à la pose | C'est un déficit de LISIBILITÉ | Nécessaire mais pas suffisant : « pas l'impression de gérer un puzzle » |
| M6 : destruction, échanges limités, jauge d'attention, valeurs | C'est un déficit d'ENJEU (audit : rien ne coûte, rien n'échoue) | La tension existe sur le papier, pas dans les mains |
| Verdict du Public : mains poker nommées × envie, envies secrètes mastermind | C'est un déficit de GRAMMAIRE et d'enjeu caché | « Mieux, mais pas de gros feeling de jeu » → gel |

## Le diagnostic final

Le concept repose sur une contradiction structurelle, identifiée par le
designer dès son analyse initiale de DropMix et confirmée par le prototype :

> Pour que la musique sonne toujours bien (la promesse du jouet), toute
> combinaison doit être valide. Pour que le jeu se sente comme un jeu, les
> combinaisons doivent pouvoir échouer. **L'acte central — poser un disque —
> ne peut pas échouer intrinsèquement**, donc chaque itération a réintroduit
> l'échec par l'extérieur (temps, ressources, information cachée). L'enjeu
> ainsi plaqué se voit : le joueur sent que le cœur, lui, « marche à tous les
> coups ».

Précédent industriel concordant : DropMix (Harmonix/Hasbro, samples de tubes
sous licence, mode versus, matériel dédié) s'est heurté au même mur et a été
abandonné commercialement.

## Ce que ce prototype ne pouvait PAS tester

À consigner honnêtement, sans en faire un plaidoyer pour continuer :

- **Le game feel** : une app DOM avec quantification à la mesure et du
  chiptune placeholder a un plafond de sensation bas. Ce banc d'essai testait
  des *systèmes*, pas des *sensations* — les deux questions ne se répondent
  pas avec le même outil.
- **Le contenu réel** : l'identité musicale de DropMix venait de morceaux
  connus. Les stems synthétiques, même enrichis (progression, climax, timbres
  par carte), ne peuvent pas créer d'attachement aux cartes.

## Ce qui est réutilisable

- `scripts/generate-stems.mjs` : générateur de boucles chiptune déterministe
  (progression d'accords, walking bass, climax, écho circulaire, crush 8-bit,
  stéréo Haas, stingers) — autonome, zéro dépendance.
- `src/audio/` : moteur de mix Tone.js — 56 voies synchronisées, remplacement
  quantifié sans glitch, ducking, préchargement à extensions multiples.
- `src/state/` + `src/rules/` : machine à états de manche (slots progressifs,
  destruction, mulligan, jauge), méta-progression persistée (scènes, économie,
  collection), scoring à mains nommées — purs, testés (71 tests).
- La coquille : jeu web mobile (drag tactile robuste, artefacts anti-soft-lock)
  + pipeline GitHub Pages.
- La méthode : GDD → playtests datés → audit → pivots actés. À rejouer telle
  quelle sur le prochain concept.

## Si l'idée renaît un jour

Trois portes laissées ouvertes, par ordre de promesse :

1. **Changer l'acte central** : faire du *geste rythmique* (poser EN rythme,
   scratcher, couper/relancer une piste au bon moment) l'acte faillible — le
   skill remplace la sélection comme cœur, la sélection devient la stratégie.
2. **Tester le feel, pas les systèmes** : maquette dédiée aux sensations
   (moteur natif ou canvas, latence audio serrée, vrais samples du designer).
3. **Assumer le jouet** : abandonner le scoring, faire un *instrument-jouet*
   narratif (le robot en tournée comme fil, sans échec) — un autre produit,
   honnête sur sa nature.

---

*Bien eu raison vite, et vérifié proprement.*
