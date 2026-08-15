# Audit game design — « c'est rigolo mais il ne se passe pas grand chose »

*Commandé après le playtest #3 (2026-08-14). Grilles utilisées : décisions
intéressantes (Meier), MDA/8 plaisirs (LeBlanc), flow (Csikszentmihalyi),
fun = apprentissage (Koster), incertitude (Costikyan), théorie de la décision.*

## 0. Le verdict en une phrase

Music Runes est aujourd'hui un **jouet** (au sens noble : un mixeur sonore
délicieux à manipuler) surmonté d'un **habillage de jeu** (scores, étoiles,
scènes) — mais il ne contient pas encore de **jeu** : aucune décision n'a de
coût, aucun échec n'est possible, aucune horloge ne presse. C'est exactement
le syndrome DropMix : le jouet est si bon qu'on croit longtemps que le jeu
est là.

## 1. Diagnostic — pourquoi « il ne se passe rien » (théorie de la décision)

Une décision est intéressante quand elle combine : des options aux valeurs
**différentes**, une **incertitude** partiellement lisible, un **coût
d'opportunité** (choisir A ferme B), une **irréversibilité** qui engage, et
une **pression** (temps, ressource, adversaire). État des lieux :

### 1.1 Recherche gratuite : le puzzle est énumérable
La pose est infiniment réversible avant le drop, rien n'est dépensé, et
l'interface calcule désormais les deltas à la place du joueur. Avec 4-6
cartes en main et 4 slots, l'espace des choix s'énumère en quelques secondes.
Formellement : problème d'optimisation mono-agent, information parfaite,
recherche à coût nul → la stratégie dominante se trouve trivialement.
**Ce n'est pas une partie, c'est un tri.**

### 1.2 Rien ne peut être perdu
Pas de ressource consommée (les cartes reviennent en main), cachet garanti,
score plancher à 0, aucun seuil d'échec : toutes les branches mènent à
« gagné ». La tension est l'écart ressenti entre le résultat espéré et sa
probabilité — sans possibilité de perte, cet écart est nul par construction.
Les étoiles n'ont **aucune conséquence** (ni porte, ni récompense modulée) :
elles notent, elles n'enjeux pas.

### 1.3 L'incertitude ne mord pas
La pioche est aléatoire mais la main contient presque tout le deck (petite
collection) ; la séquence de recettes est fixe ; les valeurs sont affichées.
Costikyan : un jeu vit de son incertitude — ici, passé le tutoriel, il n'en
reste aucune. Nuance importante : le travail de lisibilité (pictos, liens)
n'était PAS une erreur — la tension sans lisibilité produit de la
frustration, pas du challenge. Mais la lisibilité doit porter sur les
**règles**, pendant que l'incertitude doit venir des **tirages, de l'avenir,
de l'horloge** — pas de règles opaques.

### 1.4 Une seule décision par « moment de jeu »
Chaque requête = un unique point de décision statique, puis un drop. Entre
deux drops : rien n'évolue, rien ne menace, rien n'expire. « Il ne se passe
pas grand chose » est littéralement exact : la densité décisionnelle est de
~1 décision/2 minutes, sans conséquence inter-requêtes (remplacement libre
→ chaque requête repart de zéro stratégiquement, même si le plateau persiste
physiquement).

### 1.5 La musique n'a aucun rôle mécanique
Le constat le plus profond : **on peut jouer en muet sans rien perdre.** Le
mix audible est la récompense sensorielle (voulu, GDD §5) mais n'entre dans
aucune boucle de décision — ni pression, ni information, ni bonus. C'était
aussi vrai de DropMix solo ; DropMix ne devenait un jeu qu'en versus (lutte
pour les platines, niveaux de cartes, économie de tours) et en mode party
chronométré. Nous n'avons ni l'un ni l'autre.

## 2. Lecture par les grilles du fun

- **MDA / 8 plaisirs** : servis = Sensation (le mix), Fantasy (le robot),
  Découverte (première heure). Absents = **Challenge** (pas d'échec),
  **Submission/flow** (pas de courbe), Expression (deck trop petit pour des
  « builds »), Fellowship (solo). Caillois : on est en *paidia* (jeu libre)
  décoré de *ludus* (règles) — le ludus ne contraint rien.
- **Flow** : après 10 minutes, défi ≪ compétence → ennui mécanique. Aucun
  levier ne remonte le défi (les recettes « contradictoires » se résolvent
  aussi par énumération).
- **Koster** : le fun est l'apprentissage de motifs ; l'espace de motifs
  (14 cartes, 2 axes, bonus de paires) s'épuise en une session. Le plafond
  de maîtrise est atteint immédiatement → le cerveau classe le jeu « fini ».

## 3. Les leviers de tension, classés

Par rapport coût/effet, sachant que le GDD contient déjà ses propres remèdes
(c'est une force : rien ici ne trahit le design d'origine).

### Levier 1 — Remplacement limité + requête suivante visible (GDD §11)
Le GDD posait la question « remplacement libre vs limité (max 2 slots) » ;
les playtests ont utilisé « libre » (le plus simple à coder). **C'est le
levier le plus systémique.** Limiter à 2 remplacements par requête crée d'un
coup : coût d'opportunité (lesquels ?), engagement (les 2 autres slots
pèsent sur la requête suivante), et — si on affiche la **prochaine requête**
(le « next piece » de Tetris) — un vrai jeu d'anticipation séquentiel où les
cartes polyvalentes acquièrent une valeur d'option. Transforme N requêtes
isolées en une partie continue.

### Levier 2 — Étoiles à conséquence (échec possible)
Cachet multiplié par les étoiles ; 0★ = concert raté, à rejouer. La boutique
devient un budget de performance (mal jouer = ne pas pouvoir s'offrir le
disque convoité). Coût d'implémentation minimal, transforme la nature de
chaque drop.

### Levier 3 — L'horloge musicale (GDD §4, axe 3 « timing »)
Chaque requête se joue en un temps musical borné (ex. 8 mesures), auto-drop
à l'échéance ; bonus si les poses tombent en rythme. C'est LE levier qui
donne enfin un rôle mécanique à la musique : elle devient le chronomètre
qu'on entend monter. À calibrer doucement (mode « zen » sans horloge en
option d'accessibilité).

### Levier 4 — Main en lots de 4 non rechargeable (proposition playtest #2)
Pioche de 4 exactement par requête, pas de rappel : la main devient une
ressource, pas un menu. Combiné au levier 1, fait émerger la gestion de
rareté inter-requêtes (garder sa Techno Calme pour « Le Rappel » ?).

### Levier 5 — Scoring en mains de poker (proposition playtest #2)
Paire/brelan/carré/couleur/suite sur les axes forme/couleur : rend les
objectifs nommables et les succès partiels lisibles. Important : sans les
leviers 1-4, le poker reste de la lisibilité ; **avec** eux, il devient du
gambling (courir le carré = un pari, car la pioche est finie et l'horloge
tourne). À faire après ou avec, pas avant.

### Levier 6 — Perturbations et rival (plus tard)
Le public qui change d'avis en cours de requête (idée playtest #1), un DJ
rival qui pose sur les mêmes platines. Ne poser ce levier qu'une fois la
tension de base installée — sinon c'est du bruit sur un système sans enjeu.

## 4. Ordonnance — jalon M6 « la tension » — ✅ implémenté (version révisée)

Révisée avec le designer après l'audit (ses pistes : consommables, valeurs
sur les disques, jauge d'attention façon Mastermind) :

1. ✅ **Remplacement destructeur** : le disque éjecté d'une platine est
   PERDU pour le set. Fusionne « consommables » et la question « libre vs
   limité » du GDD §11 : la destruction est la limite (économique, pas
   réglementaire), et le plateau reste persistant — le mix continu est
   préservé. Le réagencement slot↔slot reste gratuit.
2. ✅ **Échanges de main limités (mulligan)** : 3 par set, en glissant un
   disque de la main sur la pioche (défausse destructrice + repioche).
   Refusé sur pioche vide (pas de défausse sèche → pas de soft-lock).
   Compteurs visibles : pioche restante + pastilles d'échanges.
3. ✅ **Jauge d'attention du public** : draine 1/mesure en phase de jeu
   (la musique est l'horloge), −8 par condition ratée au drop, +5 sur un
   sans-faute. À zéro : la salle se vide, concert raté, scène à rejouer
   (l'état d'échec qui manquait). La scène tutorielle est plus indulgente
   (attention 140 — « c'est tes potes »).
4. ✅ **Valeurs sur les disques (1-3)** : ajoutées au score du set au drop,
   PAS aux étoiles — étoiles = qualité artistique (tags/recette), valeur =
   cash. Le dilemme « gros disque qui casse ma cohérence » vit dans cet
   écart.
5. À venir : **conditions cachées révélées par la foule** (mastermind-lite),
   **poker hands** (relecture du scoring), **deck élargi tiré par 4**,
   bonus de pose en rythme, mode zen.

Critère de réussite du jalon, à vérifier en playtest #4 : le joueur doit
pouvoir dire « j'ai raté et je sais pourquoi » et « j'ai eu chaud » — les
deux phrases qui manquaient.

---

## 5. Post-playtest #4 — « on a empilé des systèmes » : l'aveu et le plan

Verdict du playtest #4 : toujours « l'impression de poser en vrac ». Le
designer le formule exactement : *« on a empilé des systèmes et des concepts
de game design sans résoudre le fond de la tension ni la lisibilité de
l'enjeu caché ou de la logique interne des assemblages »*. C'est vrai, et
c'est le diagnostic le plus utile de la série.

Les couches ajoutées (tournée, économie, destruction, jauge) sont de la
STRUCTURE autour du tour de jeu — mais l'INTÉRIEUR du tour n'a jamais changé :
poser 4 cartes qui, quoi qu'il arrive, produisent un mix qui marche et un
score qui tombe. L'outil créatif flexible (tout se superpose, par
construction musicale) tue l'enjeu si la RÈGLE ne recrée pas de l'improbable.

### Les trois manques sont UN seul redesign du tour de jeu

1. **La logique interne des assemblages** → des mains NOMMÉES façon poker
   (Paire, Brelan, Carré de formes ; Camaïeu d'énergie, Gradient complet…) :
   une hiérarchie universellement lisible de ce qu'est un « bon » assemblage,
   à la place de la soupe de ±2.
2. **L'enjeu caché / deviner la combinaison** → l'ENVIE SECRÈTE du public :
   en plus de la recette affichée, 1-2 préférences cachées (un genre adoré,
   une énergie détestée…) qui ne se découvrent QUE par ses réactions aux
   poses. Le « deviner » du Mastermind, sans solution unique.
3. **La réaction comme boussole** → chaque pose provoque une réaction
   immédiate, sonore et visuelle, qui EST l'information du point 2 (posé en
   partie : émotes + stingers).

Ensemble : poser = lancer un dé (réaction incertaine), lire = déduire
(l'envie cachée), viser = assembler (une main nommée). Nom de travail du
redesign : **« Le Verdict du Public »** — validé par le designer (« go
verdict », avec deux cadrages : mastermind TOUT-OU-RIEN — l'envie est
entièrement affichée ou entièrement cachée — et identité sonore par carte
lisible dans le langage visuel) et **✅ implémenté** : scoring v2
(data/scoring.json), envies secrètes dans scenes.json (Salon R2, Grand Mix
R1-R2), réactions de pose pilotées par l'envie (le canal d'information du
mastermind), deltas/verdict masqués en mode secret (l'arithmétique ne doit
pas résoudre l'énigme), révélation au drop, annonce de main en grand, liens
d'affinité épurés (plein = même Forme, pointillé = même Couleur), timbres
par carte seedés dans le générateur.

### Correctifs immédiats livrés avec ce constat

- Anti-soft-lock : une destruction est refusée (et expliquée) si elle rendait
  une requête restante infinissable — le tutoriel est couvert d'office.
- Régression réparée : le fantôme de drag ne suivait plus le doigt (un
  `position: relative` tardif écrasait le `position: fixed` du fantôme).
- Main en format compact (forme + couleur + valeur) sur une ligne ; zones de
  pose vides plus affirmées.
- Réactions du public à chaque pose : émote flottante + stinger 8-bit
  (arpège montant / buzz déçu / gimmick interrogatif) — le début du point 3.

### Sur « toutes les cartes se valent » musicalement

En partie structurel : même tempo, même tonalité, même progression — c'est le
prix de la superposabilité (DropMix payait le même, mais avec des samples de
morceaux CONNUS : l'identité venait du contenu, pas du système). Pistes par
coût croissant : timbres dédiés PAR CARTE (pas par genre) dans le générateur ;
motifs signatures plus contrastés ; et à terme les vrais samples du designer,
que l'architecture attend déjà (remplacer les WAV, tout suit).
