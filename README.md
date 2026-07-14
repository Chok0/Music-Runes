# Music Runes *(nom provisoire)*

> Un deckbuilder musical où l'on compose des mix en temps réel en posant des cartes-samples sur des slots limités, avec des synergies cachées à découvrir.

Un jeu mobile / session courte (rounds de 2-5 minutes) où chaque partie est un concert : on écoute son mix se construire pendant qu'on le joue.

*« Music Runes » est un nom de travail proposé pour ce dépôt — le GDD indique « [Nom provisoire] », le nom définitif reste à trouver.*

---

## Le concept en bref

### La boucle de jeu

1. Le joueur reçoit une **requête/objectif** (recette, commande, scène à jouer)
2. Il pioche une main de cartes-samples depuis son deck
3. Il pose des cartes sur des **slots limités** → le mix se construit en temps réel, audible
4. Il cherche des **synergies** entre cartes pour maximiser le score
5. Le mix est évalué → score, récompense, déblocage de nouvelles cartes
6. Il enrichit son deck (deckbuilding) et passe à la requête suivante

### Les 4 slots

Le plateau comporte **4 slots fixes** (retenus pour le MVP) : 🥁 **Rythme** · 🎸 **Basse** · 🎹 **Harmonie** · 🎤 **Lead / voix**. Poser une carte sur un slot occupé **remplace** la carte en place — pas d'empilement : c'est cette contrainte qui force un vrai choix à chaque pose.

### Tags : Genre + Énergie

Deux paramètres visibles pilotent le puzzle et le scoring, lisibles sans aucune oreille musicale :

- **Genre** → encodé par la **forme** de la carte (Cercle = Techno, Losange = Metal, Carré = Pop, Triangle = Jazz, Hexagone = Ambient)
- **Énergie** → encodée par la **couleur**, sur un gradient à 3 niveaux (Bleu = Calme, Gris = Neutre, Noir/Rouge = Intense)

Deux axes orthogonaux — genre = *quoi*, énergie = *comment* — suffisent à générer les synergies (cohérence de genre, contraste d'énergie) et les tensions du jeu.

### Le glyphe : l'identité audio de chaque carte

Deux cartes peuvent partager le même Genre et la même Énergie tout en sonnant différemment. Chaque carte porte donc un **glyphe unique**, purement identitaire, qui **n'entre jamais dans le calcul de synergie/score** : il relie la carte à ses **4 variantes audio réelles** (une par slot). Une même carte est un petit « motif musical » interprété différemment selon le slot où elle est posée — mais ses tags, eux, ne changent jamais. Tags = ce qui compte pour le calcul ; glyphe = ce qui compte pour le son.

### Le moteur central : recette vs synergie

Le vrai sel du jeu n'est pas de « réussir une synergie », c'est la **tension entre ce que demande la recette et ce que permet naturellement le système de tags**. Une recette « Techno Romantique » est intéressante précisément parce que ces tags ne synergisent pas nativement : le joueur doit arbitrer entre cohérence du mix et satisfaction de l'objectif, et un **bonus de « résolution audacieuse »** récompense le fait d'avoir fait cohabiter des tags opposés. La contradiction n'est pas un problème à éliminer — c'est la mécanique organisatrice du jeu.

### Le robot musicien en tournée

Le joueur incarne un **robot musicien** qui se déplace de scène en scène pour se faire connaître. Chaque public formule sa demande comme une commande passée à un robot — ce qui rend la mécanique de recette diégétique. **L'humour** fait partie intégrante du ton : le décalage d'un robot interprétant des demandes humaines absurdes ou contradictoires (« Techno Romantique », « Metal pour bébé »…) est une source naturelle de comédie, et donne une raison logique aux recettes délibérément contradictoires.

### Structure d'une partie : le « set »

La partie n'est pas une suite de rounds indépendants, mais **une séquence continue sur un plateau persistant** : le joueur pose ses 4 premières cartes (drop, requête #1 scorée), puis à chaque nouvelle requête, le plateau garde les cartes en place — le joueur pioche un complément de main et remplace tout ou partie des cartes avant le drop suivant. Le remplacement n'est pas une action à coût séparé : **c'est le cœur même de la boucle**. Le score cumulé des N requêtes forme la valeur du set (le score de la scène).

---

## État du projet

**Phase de démarrage.** Le Game Design Document est rédigé et fait office d'unique source de vérité ; le prototype reste entièrement à construire. Prochaine étape : un MVP jouable pour valider la boucle solo (12 cartes, 8 recettes, scoring de base).

---

## Carte du dépôt

| Fichier | Rôle |
|---|---|
| [`GDD-jeu-mix-cartes.md`](GDD-jeu-mix-cartes.md) | **Le Game Design Document** — source de vérité de toutes les décisions de design |
| [`docs/architecture-technique.md`](docs/architecture-technique.md) | Architecture du prototype : stack, moteur audio, structure du code |
| [`docs/roadmap-mvp.md`](docs/roadmap-mvp.md) | Roadmap vers le MVP jouable, jalon par jalon |
| [`docs/modele-de-donnees.md`](docs/modele-de-donnees.md) | Modèle de données : cartes, recettes, scoring |
| [`data/cards.json`](data/cards.json) | Les 12 cartes du set MVP (section 9 du GDD) |
| [`data/recipes.json`](data/recipes.json) | Les 8 recettes de test (section 10 du GDD) |
| [`data/scoring.json`](data/scoring.json) | Paramètres de scoring (Proposition 1 du GDD) |

---

## Démarrer

Le point d'entrée pour contribuer est le **jalon M0** de la [roadmap MVP](docs/roadmap-mvp.md).

Stack pressentie (parti pris de démarrage, à valider — ce n'est pas une décision du GDD) : **application web TypeScript + Vite, audio via Web Audio API / Tone.js**, jouable au navigateur desktop et mobile tactile — un packaging mobile natif (ex. Capacitor) reste une option post-MVP si le prototype web valide le concept. Détail et justification dans [`docs/architecture-technique.md`](docs/architecture-technique.md).

---

## Points encore ouverts

Ces points sont explicitement laissés ouverts par le GDD — ils seront tranchés en playtest, pas dans la doc :

1. **Formule de scoring** : choisir entre les 3 propositions de la section 4 après premiers tests in-game — ou en garder deux en A/B test. *(Parti pris de démarrage : la Proposition 1 — somme pondérée — pour le premier test, conformément à la recommandation du GDD ; les Propositions 2 et 3 restent en réserve.)*
2. **Chiffrage du bonus de contraste** : annoncé par le GDD (section 3, Option A ✅) et testé par la recette « Contraste assumé », mais chiffré par aucune des 3 propositions de scoring — une incohérence interne que le GDD acte lui-même. *(Parti pris de démarrage : +2 par paire Calme↔Intense — `contrast_pair_bonus` dans [`data/scoring.json`](data/scoring.json), remettable à 0 pour la Proposition 1 stricte.)*
3. **Remplacement libre vs limité** par requête (section 11). *(Parti pris de démarrage : libre, le plus simple à coder — la variante limitée reste à comparer en playtest.)*
4. **Ton exact de l'humour** du robot musicien, et comment les requêtes/dialogues sont écrits et affichés à l'écran.
5. **Nombre de requêtes par « set »** (5 ? 8 ?) et **taille de la main / du deck de départ** pour le MVP. *(Valeurs par défaut à tester : 6 requêtes par set, main de départ de 6 cartes, pioche de 2 cartes par nouvelle requête, deck = les 12 cartes du GDD.)*
