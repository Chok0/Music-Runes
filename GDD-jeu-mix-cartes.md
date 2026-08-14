# [Nom provisoire] — Jeu de mix musical par cartes

## Pitch en une ligne
Un deckbuilder musical où l'on compose des mix en temps réel en posant des cartes-samples sur des slots limités, avec des synergies cachées à découvrir.

---

## 1. Boucle de jeu (game loop)

1. Le joueur reçoit une **requête/objectif** (recette, commande, scène à jouer)
2. Il pioche une main de cartes-samples depuis son deck
3. Il pose des cartes sur des **slots limités** → le mix se construit en temps réel, audible
4. Il cherche des **synergies** entre cartes pour maximiser le score
5. Le mix est évalué → score, récompense, déblocage de nouvelles cartes
6. Le joueur enrichit son deck (deckbuilding) et passe à la requête suivante

Ce cycle doit durer 2-5 minutes par "round" pour rester dans le format mobile/session courte.

---

## 2. Les slots (le socle de la contrainte)

Proposition de départ : **4 slots fixes** ✅ **Retenu pour le MVP**
- 🥁 Rythme
- 🎸 Basse / harmonie basse
- 🎹 Harmonie / accords
- 🎤 Lead / voix

Une carte posée dans un slot déjà occupé **remplace** la précédente (pas d'empilement libre). C'est ce qui force le choix à chaque pose — sans ça, le joueur empile sans réfléchir et le mix devient vite une bouillie sonore sans plus aucune décision intéressante.

*(L'idée d'un nombre de slots évolutif comme axe de progression reste une piste post-MVP, pas une priorité de départ.)*

---

## 3. Synergies entre cartes — comment on les établit

C'est la question la plus structurante. Plusieurs approches possibles, non exclusives :

### Option A — Synergies par tags/attributs ✅ **Retenue**
Chaque carte a des **tags** (genre, humeur, tonalité, énergie, décennie fictive, "faction musicale"...). Des règles combinent les tags :
- 2 cartes du même tag "genre" → bonus de cohérence
- 1 carte "énergie haute" + 1 carte "énergie basse" → bonus de contraste (tension dramatique)
- Cartes de la même "faction/collection" → combo de set, comme dans un TCG classique (Magic, Hearthstone)

Avantage : lisible, extensible, facile à équilibrer et à afficher au joueur ("cette carte synergise avec : genre Techno, tag Sombre").

### Option B — Synergies narratives/thématiques
Certaines paires de cartes ont une synergie "écrite" à la main (comme les combos emblématiques d'un TCG) plutôt que calculée par règle générale — ex. la carte "Sirène des abysses" + "Écho radar" déclenchent un effet spécial unique nommé. Ça crée des moments mémorables et des cartes "chasées" par les joueurs, mais ne scale pas bien (travail manuel par paire).

**Décision** : le système repose sur l'option A (tags) comme squelette systémique, avec quelques combos narratifs façon option B saupoudrés sur les cartes rares/légendaires pour le charme et le "sel" collectible.

---

## 3bis. Taxonomie retenue — Genre + Énergie, et l'identité propre de chaque carte

**Deux paramètres visibles, utilisés pour le puzzle et le scoring :**
- **Genre** → encodé par la **forme** de la carte (ex. Losange = Metal, Cercle = Techno, Carré = Pop, Triangle = Jazz, Hexagone = Ambient)
- **Énergie** → encodée par la **couleur**, sur un gradient à 3 niveaux (ex. Bleu = Calme, Gris = Neutre, Noir/Rouge = Intense)

**Décision** : on retire "humeur" comme tag séparé. Elle faisait doublon avec le genre (Metal porte déjà sa propre connotation émotionnelle) et complexifiait la lecture sans ajouter de vraie dimension de jeu. L'énergie est gardée seule comme second axe, parce que c'est un gradient exploitable directement par le bonus de contraste (section 3) — deux axes orthogonaux (genre = *quoi*, énergie = *comment*) suffisent à générer la tension recherchée.

**Le problème de l'identité** : deux cartes peuvent partager exactement le même genre + la même énergie (ex. deux Losanges Noirs = Metal Intense) tout en étant censées jouer des lignes de basse, de batterie, etc. différentes une fois posées. Genre + énergie ne peuvent donc pas être les seuls identifiants — il faut un **troisième repère, purement identitaire, qui n'entre jamais dans le calcul de synergie/score** :

- **Glyphe/motif unique** imprimé sur chaque carte (un petit symbole, un totem, une silhouette liée à l'univers du robot musicien) — sert uniquement à distinguer visuellement deux cartes de même forme/couleur, et est relié en interne aux 4 variantes audio réelles de la carte (une par slot)
- Chaque carte est donc en réalité un **petit "motif musical"** qui a une interprétation différente selon le slot où elle est posée (ex. la carte "Loup Statique" posée en Basse joue une ligne de sub grave, posée en Lead joue une mélodie robotique) — mais ses tags Genre/Énergie restent fixes quel que soit le slot choisi, donc son rôle dans le calcul de synergie ne change pas selon où elle est posée

Cette distinction (tags = ce qui compte pour le calcul / glyphe = ce qui compte pour le son réel) est ce qui permet d'avoir un système de scoring simple et lisible tout en gardant une vraie richesse de contenu audio.

---

## 4. Scoring — comment on évalue un mix

Trois axes de score possibles, cumulables :

1. **Score de cohérence** (système) : calculé automatiquement à partir des synergies actives (tags qui matchent, contrastes qui matchent) + respect du tempo/tonalité globale
2. **Score d'objectif** (recette) : le mix répond-il à la requête donnée en début de round ? (ex. "140 BPM minimum", "au moins 1 carte du tag Mélancolie", "pas de carte Bruyant") → note binaire ou graduée
3. **Score de timing** (skill optionnel, cf. idée précédente) : bonus si les cartes sont posées en rythme sur le beat plutôt qu'à n'importe quel moment

Un score total combine les trois, affiché en fin de round avec un feedback clair ("+12 synergie, +8 objectif, +5 timing"). Le joueur doit comprendre *pourquoi* il a bien ou mal scoré, sinon il ne progresse pas dans sa compréhension du système.

### Trois formules à tester en jeu

**Proposition 1 — Somme pondérée (la plus simple à coder)**
- Cohérence = +2 par paire de cartes au même Genre, +1 par paire à Énergie identique, -2 par paire en contradiction de Genre non demandée par la recette
- Objectif = +5 par condition de la recette remplie (ex. "au moins 1 carte Techno" = +5 si présent)
- Bonus résolution audacieuse = +10 flat si une contradiction *demandée par la recette* est effectivement posée, malgré la pénalité de cohérence qu'elle génère
- Total = somme brute → mappée sur 1-3 étoiles via des paliers (ex. ≥80% du score max théorique = 3★, ≥50% = 2★, ≥25% = 1★)
- Avantage : simple, réglable carte par carte. Inconvénient : nécessite d'équilibrer beaucoup de petits chiffres à la main.

**Proposition 2 — Multiplicateur de combo**
- Chaque paire de cartes qui matche (Genre ou Énergie) augmente un multiplicateur (x1.2, x1.4, x1.6...)
- Une contradiction non voulue reset le multiplicateur à x1
- Score final = points d'objectif × multiplicateur final
- Avantage : sensation de "combo" satisfaisante, très lisible en temps réel. Inconvénient : punit plus durement les contradictions, moins hospitalier pour les "résolutions audacieuses" — pourrait décourager l'expérimentation, à surveiller en test.

**Proposition 3 — Deux jauges séparées (fidèle à la section 7)**
- Une jauge "Objectif" (la recette est-elle satisfaite, oui/non ou en %) et une jauge "Cohérence" (qualité du mix indépendamment de la recette), affichées séparément sans être fusionnées en un seul nombre
- Le round est réussi (pass) dès que la jauge Objectif atteint son seuil minimum ; la jauge Cohérence détermine ensuite le nombre d'étoiles (1★ = objectif atteint tout juste, 3★ = objectif + cohérence maximale)
- Avantage : colle exactement à l'idée de tension recette/synergie sans jamais les confondre dans un seul chiffre — plus lisible pédagogiquement. Inconvénient : demande une UI à deux jauges, un peu plus de travail d'interface qu'un simple score.

**Recommandation pour le premier test in-game** : commencer par la Proposition 1 (rapide à coder, facile à itérer), comparer ensuite avec la Proposition 3 si le retour "je ne comprends pas pourquoi j'ai ce score" revient souvent en test.

---

## 5. Rendre la sélection de carte "puzzle" pour un non-mélomane

Le risque : si le joueur doit "entendre" que deux cartes sont harmoniquement compatibles, on exclut tous ceux qui n'ont pas d'oreille musicale. Il faut donc **traduire l'info musicale en information visuelle/symbolique lisible sans écouter**.

Pistes concrètes :

- **Code couleur** : chaque tonalité/gamme = une couleur. Deux cartes de couleurs compatibles (comme un cercle chromatique simplifié) se "voient" compatibles avant même d'être posées — exactement comme Wingspan ou Dominion codent leurs synergies par icônes plutôt que par texte à lire.
- **Formes/silhouettes de carte** : une carte "rythme" a une forme de puzzle-piece qui s'emboîte visuellement avec les cartes "basse" compatibles. **Point important tranché** : la pose reste toujours possible même si les formes ne s'emboîtent pas — le joueur peut "forcer" une combinaison non naturelle, mais paie une pénalité de score. C'est le même principe qu'une main de poker : rien n'empêche de tenter une quinte flush improbable, mais si elle échoue, la main vaut moins qu'un jeu plus sûr. Ici, forcer un mauvais emboîtement est un pari assumé, pas un mur bloquant — ce qui laisse la porte ouverte aux résolutions "audacieuses" de recettes contradictoires (cf. section 7).
- ~~Icônes d'énergie/tempo~~ *(piste écartée pour l'instant — pas assez convaincante, à revisiter plus tard si besoin)*
- **Preview sonore courte au survol** : sans obliger à l'écoute analytique, un aperçu de 1-2 secondes au moment de sélectionner la carte aide à se faire une impression rapide, complément au visuel plutôt que substitut. **Validé.**
- **Feedback visuel du mix en cours** : le plateau lui-même change d'apparence selon la cohérence du mix (harmonieux = formes qui s'alignent, dissonant = formes qui se chevauchent/tremblent) — le joueur "voit" la qualité de son mix autant qu'il l'entend.

L'idée centrale : toute information nécessaire à la décision doit être lisible **sur la carte**, sans oreille musicale requise. La musique reste la récompense sensorielle, pas l'outil de décision.

---

## 6. Piste narrative retenue — le robot musicien en tournée

**Décision** : hybride des deux pistes évoquées — le joueur incarne un **robot musicien** qui se déplace de scène en scène pour se faire connaître. Ça fusionne naturellement les deux idées de départ :
- L'arc de progression et l'identification de la piste "carrière" (scènes, public, popularité, déblocages) — cf. ancienne piste A
- Le cadre "requête à satisfaire" de la piste IA (cf. ancienne piste B) devient diégétique : chaque scène/public formule sa demande comme une commande à un robot ("joue-moi un truc Techno Romantique"), ce qui justifie nativement la mécanique de recette sans avoir besoin d'un habillage séparé

**L'humour** est identifié comme un ingrédient à part entière du ton : le décalage d'un robot qui tente d'interpréter des demandes humaines parfois absurdes ou contradictoires ("Techno Romantique", "Metal pour bébé", etc.) est une source naturelle de comédie — le contenu des recettes elles-mêmes peut être écrit pour faire sourire, pas juste pour poser une contrainte mécanique. Ça donne aussi une raison logique aux recettes délibérément contradictoires (section 7) : un public capricieux ou un robot qui interprète mal sont des sources d'humour cohérentes avec le concept.

*(Reste à définir : ton exact de l'humour — absurde/second degré/tendre —, et comment les dialogues/requêtes sont écrits et présentés à l'écran.)*

---

## 7. La contradiction comme moteur central (recette vs. synergie)

Point clé identifié en discussion : le vrai sel n'est pas juste "réussir une synergie", c'est la **tension entre ce que demande la recette et ce que permet naturellement le système de tags**. Une recette "Techno Romantique" est intéressante précisément parce que ces deux tags ne synergisent pas nativement — le joueur est forcé à un vrai choix, pas juste à un remplissage de cases qui matchent.

Cette tension peut alimenter à la fois le **scoring** et le **puzzling** (la réflexion/placement), à condition de la rendre explicite plutôt que subie :

### Impact sur le scoring
- **Score de cohérence** (synergie de tags) et **score d'objectif** (satisfaction de la recette) deviennent deux axes qui peuvent se tirer dans des directions opposées — le joueur doit arbitrer, pas juste additionner
- **Bonus de "résolution audacieuse"** : réussir à satisfaire une recette contradictoire malgré la pénalité de synergie rapporte un bonus spécifique (le jeu récompense explicitement le fait d'avoir *réussi à faire cohabiter* deux tags opposés, pas juste de les avoir posés côte à côte)
- **Mécanique de remplacement de carte** *(remplace l'idée initiale de "cartes-pont" dédiées)* : plutôt que des cartes spéciales conçues pour réconcilier deux tags, on introduit une action de **remplacement** — le joueur peut échanger une carte posée contre une autre de sa main pour ajuster son mix en cours de round, ce qui permet de corriger une contradiction sans dépendre de la chance d'avoir la bonne carte rare en main. *(mécanique à détailler : coût de l'échange, limite par round, etc. — point à trancher avant le MVP)*
- **Seuils de score à étoiles** *(piste à creuser)* : plutôt qu'un score continu strict, on pourrait définir des paliers — une recette *parfaitement* remplie (tags alignés + objectif satisfait sans pénalité) donne 3 étoiles, une recette *pertinente mais imparfaite* (l'esprit de la demande est respecté, quitte à forcer un peu) atteint le minimum viable (1 étoile). Ça donnerait une lecture plus lisible du score qu'un simple nombre de points, et laisserait de la place pour "réussir sans briller" — à valider une fois le scoring de base posé.
- **Difficulté progressive naturelle** : les premières recettes du jeu combinent des tags qui synergisent (pour enseigner le système sans punir), les recettes suivantes introduisent des contradictions croissantes, ce qui crée une vraie courbe de progression sans avoir besoin de mécanique additionnelle

### Impact sur le puzzling (la réflexion au moment de poser les cartes)
- Le joueur ne cherche plus juste "quelle carte synergise le mieux", mais **quelle carte minimise le coût de la contradiction** — un problème d'optimisation sous contrainte, ce qui est la définition même d'un puzzle
- Ça se traduit visuellement (cf. section 5) par un **conflit visible avant la pose** : si deux tags sont en tension, leurs couleurs/formes pourraient se "repousser" visuellement sur l'interface (halo rouge, formes qui ne s'emboîtent pas), donnant au joueur une information claire de tension à résoudre sans avoir besoin de comprendre la théorie musicale sous-jacente
- Piste inspirée de **Canvas** (jeu de société où des cartes transparentes superposées révèlent ou masquent des icônes selon l'ordre de pose, et sont scorées contre des cartes-objectifs tirées aléatoirement à chaque partie) : on pourrait faire dépendre la résolution de la contradiction de **l'ordre de pose** plutôt que de la simple présence des cartes — poser la carte "pont" en dernier pourrait "révéler" et neutraliser une contradiction déjà en place, ce qui ajoute une dimension temporelle/séquentielle au puzzle, pas seulement combinatoire
- L'objectif (recette) tiré aléatoirement à chaque round, à la Canvas, garantit aussi la rejouabilité — les mêmes cartes en main n'appellent jamais la même résolution optimale d'une partie à l'autre

**En résumé** : la contradiction recette/synergie n'est pas un problème à éliminer du design, c'est la mécanique organisatrice — elle donne une raison au scoring d'avoir deux axes distincts, et une raison au joueur de réfléchir avant de poser plutôt que d'empiler.

---

## 8. Deckbuilding & collection

- **Acquisition** : packs de cartes achetés avec une **monnaie in-game uniquement pour le MVP** (gagnée en jouant) ✅ *Décision*. Un système d'achat cash → monnaie in-game reste une option à considérer plus tard, pas une priorité pour le MVP.
- **Rareté** : commune/rare/légendaire — les légendaires portent les synergies narratives "écrites à la main" (cf. section 3, option B)
- **Lab de création de stems** (ton idée) : un mode où le joueur/artisan crée ses propres cartes à partir de samples — génératif ou importés — pourrait devenir un système de fabrication de cartes custom, cohérent avec ta double casquette créateur/joueur. À creuser comme feature avancée plutôt que MVP.
- **Mode de jeu** : **solo pur pour le MVP** ✅ *Décision* — le multijoueur (battle ou coop, cf. section "sel du jeu") reste une extension post-MVP une fois la boucle solo validée.

---

## 9. Set de cartes MVP (12 cartes de test)

5 Genres retenus pour le MVP : **Techno** (Cercle) · **Metal** (Losange) · **Pop** (Carré) · **Jazz** (Triangle) · **Ambient** (Hexagone)
3 niveaux d'Énergie : **Calme** (Bleu) · **Neutre** (Gris) · **Intense** (Noir/Rouge)

Chaque carte est jouable sur n'importe quel des 4 slots ; ses tags Genre/Énergie ne changent pas selon le slot, seule l'interprétation audio change (cf. section 3bis).

| # | Nom (glyphe) | Genre | Énergie | Rythme | Basse | Harmonie | Lead |
|---|---|---|---|---|---|---|---|
| 1 | Loup Statique | Techno | Intense | Four-on-the-floor lourd | Sub acide, punchy | Nappe sombre saturée | Vocal chop robotique |
| 2 | Écho Bleuté | Techno | Calme | Groove minimal, hi-hats légers | Sub feutré, arrondi | Pad éthéré | Synth-lead planant |
| 3 | Enclume Rouge | Metal | Intense | Double pédale rapide | Distordue, palm-mute | Power chords saturés | Cri/riff aigu |
| 4 | Cendre Grise | Metal | Neutre | Rock beat classique | Groove mid-tempo | Accords ouverts | Riff mélodique |
| 5 | Néon Carré | Pop | Intense | Beat radio énergique | Synth-bass punchy | Accords brillants | Voix lead accrocheuse |
| 6 | Ruban Doux | Pop | Calme | Beat léger, brushes | Bass ronde legato | Accords simples piano | Voix chantée douce |
| 7 | Velours Triangle | Jazz | Neutre | Swing brushes | Walking bass | Accords 7e/9e | Sax lead improvisé |
| 8 | Cuivre Calme | Jazz | Calme | Balai lent | Contrebasse feutrée | Piano rhodes | Trompette sourdine |
| 9 | Brume Hexagone | Ambient | Calme | Percussion éparse | Drone grave | Textures évolutives | Voix éthérée sans paroles |
| 10 | Poussière d'Étoile | Ambient | Neutre | Rythme organique épars | Sub doux évolutif | Nappes granulaires | Field recording traité |
| 11 | Marteau Carré | Pop | Neutre | Beat pop classique | Bass groovy | Accords majeurs | Voix lead énergique |
| 12 | Lame Cercle | Techno | Neutre | Beat techno standard | Sub carré | Arpège synthé | Lead acide |

*(Rareté : toutes communes pour le MVP — la rareté et les combos narratifs écrits à la main viendront après validation du noyau système, cf. section 8.)*

---

## 10. Recettes de test (8 recettes)

Progression pensée du plus facile (enseigne le système) au plus contradictoire (teste la tension recette/synergie) :

1. **"Ouverture club"** — *Facile* : au moins 2 cartes Techno
2. **"Session lounge"** — *Facile* : au moins 2 cartes Ambient ou Jazz, aucune carte Intense
3. **"Set stade"** — *Facile* : au moins 2 cartes Pop Intense
4. **"Set monochrome"** — *Cohérence pure* : les 4 cartes doivent être du même Genre (teste la synergie sans aucune tension d'objectif)
5. **"Contraste assumé"** — *Teste le bonus de contraste* : au moins 1 carte Calme ET 1 carte Intense simultanément
6. **"Techno Romantique"** *(la recette signature)* — *Contradictoire* : au moins 1 carte Techno ET 1 carte Jazz ou Ambient Calme
7. **"Metal pour bébé"** — *Contradictoire, comique* : au moins 1 carte Metal ET aucune carte Intense sur le plateau
8. **"Improvisation totale"** — *Diversité* : les 4 cartes doivent être de 4 Genres différents (challenge différent : pas de contradiction frontale, mais aucune cohérence de Genre possible non plus)

---

## 11. Structure de la partie — séquence de requêtes

**Décision** (précisant le point 5 évoqué en discussion) : la partie n'est pas une suite de rounds indépendants qui repartent de zéro, mais **une séquence continue sur un plateau persistant** :

1. Le joueur pioche sa main de départ, pose 4 cartes sur les 4 slots (plateau vide au départ) → **drop**, la requête #1 est scorée
2. Une nouvelle requête arrive. Le plateau garde les 4 cartes déjà posées ; le joueur pioche un complément de main et peut **remplacer** tout ou partie des cartes en place avant de valider → **drop**, requête #2 scorée
3. Le cycle se répète pour N requêtes (ex. 5 à 8 pour un "set" complet)
4. Le score cumulé de toutes les requêtes du set = la **valeur du set** (le score final de la partie/scène)

Ce fonctionnement répond directement au point ouvert sur la mécanique de remplacement (section 7) : **le remplacement n'est pas une action spéciale à coût séparé, c'est le cœur même de la boucle** — à chaque nouvelle requête, le joueur décide librement quelles cartes du plateau garder (parce qu'elles servent encore) et lesquelles remplacer avec sa main. Pas besoin de règle de coût additionnelle pour le MVP.

**Un paramètre à tester en jeu** : remplacement **libre** (les 4 slots peuvent changer à chaque requête) vs remplacement **limité** (ex. maximum 2 slots modifiables par requête, pour forcer à composer avec l'existant et créer plus de tension stratégique). À comparer en playtest — le mode libre est plus simple à coder pour un premier prototype.

---

## Points encore ouverts à trancher
- Choisir entre les 3 propositions de scoring (section 4) après premiers tests in-game — ou en garder deux en A/B test
- **Incohérence interne à résoudre** : le bonus de contraste (section 3, Option A ✅ — « 1 carte énergie haute + 1 carte énergie basse ») est repris par le score de cohérence (section 4, axe 1) et testé par la recette 5 « Contraste assumé », mais aucune des 3 propositions de scoring ne le chiffre — intégrer un terme de contraste à la formule retenue (valeur à régler en playtest)
- Remplacement libre vs limité par requête (section 11) — à trancher en playtest
- Ton exact de l'humour du robot musicien, et comment les requêtes/dialogues sont écrits et affichés à l'écran
- Nombre de requêtes par "set" (5 ? 8 ?) et taille de la main/du deck de départ pour le MVP
