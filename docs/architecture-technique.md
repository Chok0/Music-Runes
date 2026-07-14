# Architecture technique du prototype MVP — "Music Runes"

> **Statut** : proposition technique. Ce document ne prend **aucune** décision de game design : la seule source de vérité côté design est le [GDD](../GDD-jeu-mix-cartes.md). Toute décision technique ci-dessous est un **parti pris de démarrage à valider en playtest**, sauf mention explicite d'une décision ✅ du GDD.
>
> **Nom de travail** : "Music Runes" est un nom provisoire proposé pour ce prototype — le GDD s'intitule "[Nom provisoire]" et le nom définitif reste à trancher.

---

## 1. Contraintes issues du GDD qui dimensionnent la technique

Ces points sont soit des décisions validées (✅) du GDD, soit des mécaniques décrites qui imposent des exigences techniques concrètes. C'est le cahier des charges minimal du prototype.

| Contrainte GDD | Référence | Exigence technique induite |
|---|---|---|
| Le mix se construit **en temps réel, audible**, carte par carte, sur 4 slots fixes (Rythme, Basse, Harmonie, Lead) ✅ | Sections 1 et 2 | Lecture simultanée de jusqu'à 4 boucles audio synchronisées, avec ajout/retrait/remplacement d'une boucle **sans couper** les autres ni casser la synchronisation |
| Chaque carte possède **4 variantes audio réelles, une par slot** (le glyphe identitaire y est relié en interne) | Section 3bis | 12 cartes × 4 stems = 48 boucles audio à gérer (chargement, mémoire, déclenchement calé), toutes superposables entre elles |
| **Preview sonore courte (1-2 s) au survol/sélection** — validé ✅ | Section 5 | Lecture instantanée d'un extrait sans perturber le mix en cours ; latence de déclenchement minimale ; arrêt propre au relâchement |
| **Score de timing** : bonus optionnel si la carte est posée en rythme sur le beat | Section 4 (axe 3) | Un transport/horloge musicale exposant la position précise dans la mesure, pour mesurer l'écart entre l'instant de pose et le beat le plus proche |
| Rounds de **2-5 minutes**, format **mobile/session courte** | Section 1 | Cible mobile tactile : temps de chargement courts, assets audio légers, UI utilisable au doigt, budget mémoire/CPU raisonnable |
| **Feedback visuel du mix en cours** : le plateau change d'apparence selon la cohérence ; **tensions/synergies visibles avant la pose** (halo, formes qui se repoussent) | Sections 5 et 7 | Le moteur de règles doit pouvoir évaluer un plateau **hypothétique** ("et si je posais cette carte ici ?") à la volée, sans effet de bord, pour alimenter l'UI en continu |
| Info de décision lisible **sur la carte** sans oreille musicale : forme = Genre, couleur = Énergie, glyphe = identité | Sections 3bis et 5 | Rendu de cartes à 3 dimensions visuelles distinctes ; pas besoin d'analyse audio côté client — tout le "puzzle" est piloté par les données de tags |
| **Solo pur pour le MVP** ✅ | Section 8 | **Aucun backend nécessaire** : pas de serveur, pas de compte, pas de synchro. Tout tourne en local dans le client |
| Séquence continue de N requêtes sur **plateau persistant**, score cumulé du set ✅ | Section 11 | Machine à états de partie : plateau conservé entre requêtes, pioche complémentaire, score agrégé sur le set |
| Pose toujours possible même en "mauvais emboîtement" (pénalité, pas de blocage) ✅ | Section 5 | L'UI ne doit jamais interdire un drop sur un slot ; la sanction passe par le scoring, pas par la validation d'entrée |

**Ce que le MVP n'a PAS besoin de gérer** (et que l'architecture ne doit donc pas payer) : multijoueur (post-MVP, section 8), achat cash (section 8), lab de création de stems (feature avancée, section 8), rareté/combos narratifs (post-validation du noyau, sections 8 et 9), nombre de slots évolutif (piste post-MVP, section 2).

---

## 2. Choix de stack

### 2.1 Recommandation : application web — TypeScript + Vite + Tone.js (Web Audio API)

> **Parti pris de démarrage, à valider** — ce n'est pas une décision du GDD.

- **TypeScript** : typage fort pour le moteur de règles (tags, recettes, scoring), ce qui rend les données de cartes/recettes vérifiables à la compilation et le refactoring sans peur pendant la phase d'itération rapide.
- **Vite** : serveur de dev avec rechargement instantané, build trivial, zéro configuration lourde. On modifie une valeur de scoring, on voit le résultat en une seconde.
- **Tone.js** (sur-couche de la Web Audio API) : c'est la brique qui porte le cœur du jeu.
  - `Tone.Transport` : une horloge musicale globale (BPM, position en mesures/beats) — exactement ce qu'il faut pour synchroniser les 4 stems **et** mesurer le bonus de timing de pose.
  - `Tone.Player` / boucles quantifiées : démarrage d'une boucle calé sur la prochaine mesure ou le prochain beat, ce qui règle nativement le problème du "remplacement de stem sans casser le groove".
  - Preview au survol : un simple player parallèle, hors transport, à latence quasi nulle une fois le buffer chargé.
- **Jouable navigateur desktop + mobile tactile** dès le premier jour. Packaging natif mobile ultérieur possible via une coquille type **Capacitor**, ou portage moteur post-MVP si le prototype valide le concept.

**Justification honnête** : ce choix optimise **une seule chose** — la vitesse d'itération sur un gameplay audio-first — et accepte des faiblesses réelles en échange (voir 2.3). C'est un choix de prototype jetable/testable, pas un choix de moteur de production.

### 2.2 Alternatives sérieuses

Ces options ne sont pas des hommes de paille : chacune serait un choix défendable, surtout si l'on visait directement la production mobile.

**Godot 4**
- Gratuit, open source, léger, export mobile (iOS/Android) natif et simple.
- `AudioStreamPlayer` + bus audio permettent le mixage multi-pistes ; GDScript très rapide à écrire.
- Excellent pour l'UI de jeu (scènes, animations, tweens) — le feedback visuel de cohérence du plateau (section 5 du GDD) serait plus facile à rendre "juteux" que dans le DOM.
- Limites pour notre cas : la synchronisation sample-accurate de boucles musicales et la quantification sur un transport global demandent plus de travail manuel qu'avec Tone.js (pas d'équivalent intégré de `Tone.Transport`) ; et surtout, **pas de partage par simple lien** — chaque build de playtest doit être distribué (APK, TestFlight...). L'export HTML5 de Godot existe mais son support audio (threads, latence) est historiquement plus fragile que la Web Audio native.

**Unity**
- L'écosystème mobile le plus éprouvé ; si le jeu part en production native, c'est un candidat naturel.
- Middleware audio professionnel disponible (FMOD, Wwise) avec quantification, stems, transitions musicales — c'est-à-dire *plus* puissant que Tone.js à terme.
- Store d'assets, profiling mobile mature, packaging iOS/Android industrialisé.
- Limites pour notre cas : temps de mise en route et d'itération nettement plus longs (licences, taille de projet, builds), lourdeur disproportionnée pour un prototype de validation de boucle de jeu, et là encore distribution de builds au lieu d'un lien.

### 2.3 Pourquoi le web gagne pour un **premier prototype**

1. **Vitesse d'itération** : le GDD liste explicitement des paramètres à tester en jeu (3 propositions de scoring, remplacement libre vs limité, nombre de requêtes par set...). Le coût d'un aller-retour "modifier → tester" doit être de quelques secondes, pas de quelques minutes de build.
2. **Playtest par lien** : envoyer une URL à un testeur (desktop ou mobile) sans installation est la friction minimale absolue pour recueillir du feedback tôt et souvent. C'est décisif pour un jeu dont le cœur ("est-ce que le puzzle recette/synergie est fun ?") ne peut être validé qu'en faisant jouer des gens.
3. **Audio web mature pour ce besoin précis** : le stem-mixing synchronisé en boucles sur un transport global est exactement le cas d'usage pour lequel Tone.js est conçu (séquenceurs et outils musicaux web). On n'utilise pas le web "malgré" l'audio, on l'utilise "grâce à" lui.
4. **Réversibilité assumée** : si le prototype valide le concept, le moteur de règles et les données (modules 2, 3 et 5 ci-dessous) sont du TypeScript/JSON pur, portables presque tels quels ; seuls l'audio et l'UI seraient à réécrire dans un moteur natif. Le prototype web n'hypothèque pas la suite.

Faiblesses acceptées en connaissance de cause : latence audio variable sur mobile (voir section 4), politique d'autoplay des navigateurs, performances de rendu DOM inférieures à un moteur de jeu si l'on veut des effets visuels très riches. Aucune n'est bloquante pour valider la boucle de jeu.

---

## 3. Architecture en modules découplés

Principe directeur : **le moteur de règles ne connaît ni l'audio ni l'UI**, et **l'audio ne connaît pas les règles**. L'état de jeu est le point de rencontre. Ce découplage sert directement deux besoins du GDD : l'évaluation "avant la pose" pour le feedback visuel de tension (sections 5 et 7), et l'A/B test des formules de scoring (point ouvert de la section 4) sans toucher au reste du code.

```
        ┌────────────────────┐
        │      5. Données     │  cards.json · recipes.json · scoring.json
        └─────────┬──────────┘
                  │ (chargées au démarrage, typées)
                  ▼
┌─────────────────────────────────────┐
│         3. État de jeu (state)      │  deck · main · plateau · set · score
└───────┬───────────────┬─────────────┘
        │               │
        ▼               ▼
┌───────────────┐ ┌───────────────┐      ┌────────────────┐
│ 2. Règles /   │ │ 4. UI / rendu │─────▶│ 1. Moteur audio │
│    scoring    │◀│  (drag&drop,  │      │  (Tone.js)      │
│  (pur, testé) │ │   feedback)   │      └────────────────┘
└───────────────┘ └───────────────┘
```

### 3.1 Moteur audio (`src/audio`)

Responsabilités :
- **Chargement des stems** : préchargement des buffers audio — 48 boucles pour le deck MVP de 12 cartes, soit 48 buffers en mémoire (96 fichiers sur disque avec le double encodage ogg/m4a, un seul format chargé — voir section 4 pour la stratégie), avec écran/état de chargement.
- **Transport global** : un `Tone.Transport` unique à tempo fixe (parti pris MVP : ex. 120 BPM, à valider — voir section 4). Toutes les boucles se calent dessus.
- **Boucles synchronisées** : une "voie" par slot (Rythme, Basse, Harmonie, Lead), chacune jouant en boucle le stem de la carte posée. Démarrage quantifié sur la prochaine mesure (ou le prochain beat — granularité à régler à l'oreille en playtest).
- **Remplacement sans coupure** : quand une carte remplace celle d'un slot occupé (règle ✅ de la section 2 du GDD), l'ancien stem s'arrête et le nouveau démarre au prochain point de quantification — les 3 autres voies continuent sans interruption. Un court crossfade est une option d'implémentation à tester si la coupure sèche s'entend trop.
- **Preview au survol** (✅ section 5) : lecture d'un extrait de 1-2 s du stem, sur une voie de preview dédiée, hors mix (ou mix atténué pendant la preview — à trancher à l'oreille). Sur mobile tactile, le "survol" n'existe pas : équivalent proposé = appui maintenu sur la carte, **à valider en playtest**.
- **Horloge de timing pour le score** : exposer une fonction du type `distanceAuBeatLePlusProche(): number` (en fraction de beat) que l'état de jeu interroge au moment d'un drop, pour alimenter le score de timing optionnel (section 4 du GDD, axe 3). Le moteur audio **fournit la mesure**, il ne calcule **pas** le bonus — ça, c'est le moteur de règles.

Interface volontairement étroite (proposition) :

```ts
interface AudioEngine {
  init(): Promise<void>;              // après geste utilisateur (autoplay policy)
  loadStems(cards: CardData[]): Promise<void>;
  startTransport(): void; stopTransport(): void;
  setSlot(slot: SlotId, cardId: CardId | null): void;  // remplacement quantifié
  previewCard(cardId: CardId, slot: SlotId): void;
  stopPreview(): void;
  beatOffset(): number;               // écart au beat, pour le score de timing
}
```

### 3.2 Moteur de règles / scoring (`src/rules`)

- **Fonctions pures, zéro dépendance** UI/audio/DOM : entrée = plateau (4 slots avec tags Genre/Énergie), recette courante, config de scoring ; sortie = décomposition du score. Testable unitairement (Vitest) — c'est le module qu'on veut pouvoir marteler de tests, car c'est là que se joue l'équilibrage.
- **Implémente la Proposition 1 du GDD** (somme pondérée) pour le premier test in-game — c'est la recommandation explicite du GDD lui-même : +2 par paire de même Genre, +1 par paire à Énergie identique, -2 par paire en contradiction de Genre non demandée, +5 par condition de recette remplie, +10 flat de "résolution audacieuse", mapping en 1-3 étoiles par paliers (≥80 % / ≥50 % / ≥25 % du score max théorique).
- **Les Propositions 2 et 3 restent en réserve** (point ouvert du GDD) : le module expose une interface `ScoringStrategy` pour brancher un multiplicateur de combo ou les deux jauges séparées en A/B test sans toucher à l'UI ni à l'état.
- **Toutes les valeurs numériques sont externalisées** dans `data/scoring.json` (voir [docs/modele-de-donnees.md](modele-de-donnees.md)) : le GDD prévient que la Proposition 1 "nécessite d'équilibrer beaucoup de petits chiffres à la main" — ces chiffres ne doivent donc jamais être codés en dur.
- **Évaluation hypothétique** : la même fonction d'évaluation sert (a) au scoring d'un drop validé et (b) au feedback *avant la pose* (section 5/7 du GDD : tensions et synergies visibles pendant le drag). L'UI appelle `evaluate(plateauHypothétique, recette)` en continu ; la pureté du module garantit qu'il n'y a aucun effet de bord.
- Note d'implémentation : la sémantique exacte de "paire en contradiction de Genre" (quelles paires de Genres sont en contradiction, vs simplement différentes) doit être définie dans les données de config — le GDD pose le principe sans en donner la table ; c'est un **paramètre d'équilibrage à fixer en playtest**, pas une décision à inventer dans le code.

### 3.3 État de jeu (`src/state`)

Machine à états de la partie, fidèle à la section 11 du GDD (décision ✅ : séquence continue sur plateau persistant) :

- **Contenu de l'état** : deck (les 12 cartes MVP), main courante, plateau (4 slots, persistant entre requêtes), index de la requête courante dans la séquence du set, historique des scores par requête, **score cumulé du set** (= valeur du set, le score final de la scène).
- **Transitions** : `démarrerSet` → pioche de la main de départ → (`poserCarte` | `remplacerCarte`)* → `validerDrop` (scoring de la requête via le module règles) → `requêteSuivante` (pioche complémentaire, plateau conservé) → ... → `finDeSet` (score cumulé, étoiles).
- **Remplacement libre** pour le premier prototype (les 4 slots modifiables à chaque requête) — *parti pris de démarrage* : le GDD indique que c'est le plus simple à coder, et la variante limitée (ex. max 2 slots par requête) reste **à comparer en playtest** (point ouvert, section 11). L'état doit donc être conçu pour accueillir une limite de remplacements par requête sans refonte (un simple compteur).
- **Valeurs par défaut proposées, à valider en playtest** (le GDD les laisse explicitement ouvertes) : 6 requêtes par set (fourchette GDD : 5-8), main de départ de 6 cartes, pioche de 2 cartes à chaque nouvelle requête, deck = les 12 cartes du GDD.
- Implémentation proposée : un store minimaliste (réducteur pur + événements), sans framework d'état lourd. L'UI s'abonne aux changements ; le moteur audio est piloté par les événements de pose/remplacement (`setSlot`).

### 3.4 UI / rendu (`src/ui`)

- **Rendu des cartes** selon la triple lecture de la section 3bis : **forme** = Genre (Cercle Techno, Losange Metal, Carré Pop, Triangle Jazz, Hexagone Ambient), **couleur** = Énergie (Bleu Calme, Gris Neutre, Noir/Rouge Intense), **glyphe** = identité pure (jamais utilisé par le scoring). Rendu SVG proposé (formes vectorielles nettes à toutes tailles, animables en CSS).
- **Drag & drop** vers les 4 slots, au doigt et à la souris (Pointer Events unifiés). Règle ✅ section 5 : **aucun drop n'est jamais bloqué** — un mauvais emboîtement se paie en score, il n'est pas interdit par l'interface.
- **Tensions/synergies affichées AVANT la pose** (sections 5 et 7) : pendant le drag, chaque slot affiche l'effet hypothétique de la pose (halo/liaison verte pour une synergie, halo rouge / formes qui se repoussent pour une tension), calculé par `rules.evaluate()` sur le plateau hypothétique. C'est le cœur de la promesse "puzzle lisible sans oreille musicale".
- **Feedback visuel du mix en cours** (section 5) : l'apparence du plateau reflète la cohérence courante (harmonieux = formes alignées, dissonant = chevauchement/tremblement). MVP : version simple pilotée par le score de cohérence courant (ex. intensité d'un effet de "vibration" inversement proportionnelle à la cohérence).
- **Jauges de feedback** : affichage de la recette courante et de sa progression, score de la requête décomposé à la validation ("+12 synergie, +8 objectif, +5 timing" — exigence de lisibilité de la section 4), score cumulé du set, indicateur de beat (pulsation visuelle du transport) pour rendre le bonus de timing jouable.
- **Preview** : survol (desktop) / appui maintenu (mobile, proposition à valider) → appel `audio.previewCard()`.
- Techno de rendu : DOM + SVG + CSS suffisent pour le MVP (pas de canvas/WebGL nécessaire à ce stade) — *proposition*, révisable si le feedback visuel du plateau réclame plus de puissance.

### 3.5 Données (`data/`)

Tout le contenu de jeu vit dans des fichiers JSON versionnés, chargés au démarrage et validés contre des types TypeScript :

- **`data/cards.json`** — les 12 cartes du MVP (section 9 du GDD) : id, nom (= glyphe identitaire), Genre, Énergie, rareté, et par slot : description + chemin de stem.
- **`data/recipes.json`** — les 8 recettes de test (section 10), exprimées en conditions déclaratives évaluables par le moteur de règles.
- **`data/scoring.json`** — tous les paramètres de la Proposition 1 (poids des paires, bonus, paliers d'étoiles) + table des contradictions de Genre.

Le schéma détaillé de ces fichiers est spécifié dans **[docs/modele-de-donnees.md](modele-de-donnees.md)** (document rédigé en parallèle) — ce document-ci n'en duplique pas le contenu ; en cas d'écart, le modèle de données fait foi pour les schémas.

Bénéfice direct : équilibrer le jeu (les "petits chiffres à la main" de la Proposition 1) ou ajouter une carte/recette ne demande **aucune** modification de code — condition nécessaire pour itérer vite en playtest.

---

## 4. Contraintes audio concrètes

### 4.1 Tempo global unique et tonalité commune (parti pris MVP)

> **Parti pris de démarrage, à valider** — le GDD mentionne le "respect du tempo/tonalité globale" comme composante du score de cohérence (section 4) mais ne fixe pas de valeurs.

Pour que n'importe laquelle des 12 cartes soit superposable à n'importe quelle autre sur n'importe quel slot (exigence structurelle de la section 9 : "chaque carte est jouable sur n'importe quel des 4 slots"), tous les stems du MVP sont produits :
- au **même tempo** (proposition : 120 BPM — compromis jouable pour Techno/Pop/Metal/Jazz/Ambient en placeholder ; valeur à valider à l'oreille),
- dans une **tonalité commune** (proposition : La mineur — à valider),
- en boucles de longueur fixe en mesures (proposition : 2 ou 4 mesures, soit 4 s ou 8 s à 120 BPM), pour que la quantification au remplacement tombe toujours juste.

Conséquence assumée : au MVP, la composante "respect du tempo/tonalité" du score de cohérence est **toujours satisfaite par construction** (tous les stems sont compatibles). Des tempos/tonalités différenciés par carte (et leur pénalité de cohérence associée) sont une extension post-MVP qui demanderait du time-stretch/pitch-shift — hors périmètre du premier prototype.

**Assets placeholder à produire** : 12 cartes × 4 slots = **48 boucles**, cohérentes avec les descriptions de la table de la section 9 du GDD (ex. "Loup Statique" en Basse = sub acide punchy, en Lead = vocal chop robotique).

### 4.2 Formats de fichiers

- Double encodage recommandé : **`.ogg` (Vorbis)** pour Chrome/Firefox/Android et **`.m4a` (AAC)** pour Safari/iOS — Safari ne lit pas Vorbis nativement, et on ne peut pas se permettre d'exclure iOS pour un jeu mobile. Détection du support au chargement, un seul jeu de buffers en mémoire.
- Cible ~96-128 kbit/s : pour 48 boucles de ~4-8 s, budget total de l'ordre de 3-6 Mo — chargeable en une fois derrière un écran de chargement, compatible "session courte".
- Boucles **exportées avec des points de bouclage propres** (pas de silence en tête/queue, attention au padding d'encodeur AAC/Vorbis — à vérifier à l'export, ou compenser via les offsets de boucle de Tone.js).
- Les previews de 1-2 s peuvent être un simple extrait du buffer déjà chargé (offset + durée) : pas de fichiers de preview séparés à produire.

### 4.3 Latence et performances mobile

- La Web Audio a une latence de sortie variable selon l'appareil (bonne sur iOS, hétérogène sur Android). Impact par usage :
  - **Mix en boucle** : insensible à la latence (tout est calé sur le transport, pas sur l'instant du geste).
  - **Preview** : une latence de quelques dizaines de ms est acceptable pour "se faire une impression".
  - **Bonus de timing** : c'est le point sensible — le joueur vise le beat qu'il *entend*, en retard sur l'horloge interne. Mesurer l'écart côté transport (`beatOffset()`) avec une **fenêtre de tolérance généreuse** (paramètre à externaliser dans `scoring.json` — ex. `beat_tolerance` — quand le bonus de timing sera implémenté ; il n'y figure volontairement pas pour le premier prototype, cf. [modèle de données](modele-de-donnees.md)), et se rappeler que ce score est **optionnel** dans le GDD (section 4) : s'il s'avère injuste sur mobile, il peut être désactivé sans toucher au reste.
- Précharger **tous** les buffers avant de démarrer le set : aucun décodage pendant le jeu, pas de glitch au remplacement de carte.
- Garder les 4 voies + preview en actif permanent (gain à 0 quand vide) plutôt que créer/détruire des nœuds audio en cours de jeu.

### 4.4 Autoplay policy des navigateurs

Aucun navigateur moderne ne laisse démarrer l'audio sans **geste utilisateur explicite**. Conséquence directe sur le flux d'entrée du jeu : un écran d'accueil avec un bouton (proposition diégétique : "🤖 Monter sur scène") dont le tap/clic (1) débloque/reprend l'`AudioContext`, (2) lance le préchargement s'il n'est pas fini, (3) démarre le transport. Gérer aussi la **suspension du contexte** quand l'app passe en arrière-plan sur mobile (événement `visibilitychange` → pause propre du transport, reprise au retour).

---

## 5. Arborescence proposée du code

```
Music-Runes/
├── GDD-jeu-mix-cartes.md          # source de vérité design
├── docs/
│   ├── architecture-technique.md  # ce document
│   └── modele-de-donnees.md       # schémas cards/recipes/scoring
├── index.html
├── package.json
├── vite.config.ts
├── data/                          # contenu de jeu, JSON versionné
│   ├── cards.json                 # 12 cartes (section 9 GDD)
│   ├── recipes.json               # 8 recettes (section 10 GDD)
│   └── scoring.json               # paramètres Proposition 1 + paliers étoiles
├── assets/
│   └── stems/                     # 48 boucles placeholder (.ogg + .m4a)
│       ├── loup-statique/
│       │   ├── rythme.ogg / rythme.m4a
│       │   ├── basse.ogg  / basse.m4a
│       │   ├── harmonie.ogg / harmonie.m4a
│       │   └── lead.ogg   / lead.m4a
│       └── ... (un dossier par glyphe/carte)
├── src/
│   ├── main.ts                    # bootstrap : chargement data → init modules
│   ├── audio/
│   │   ├── engine.ts              # AudioEngine (Tone.js) : transport, voies, preview
│   │   ├── loader.ts              # préchargement des buffers, choix ogg/m4a
│   │   └── quantize.ts            # helpers de quantification / beatOffset
│   ├── rules/
│   │   ├── evaluate.ts            # évaluation pure d'un plateau vs recette
│   │   ├── scoring-p1.ts          # Proposition 1 (somme pondérée)
│   │   ├── scoring-strategy.ts    # interface pour brancher P2/P3 en A/B test
│   │   └── types.ts               # Genre, Energie, Card, Recipe, ScoreBreakdown
│   ├── state/
│   │   ├── game-state.ts          # store : deck, main, plateau, set, scores
│   │   └── set-machine.ts         # transitions (drop, requête suivante, fin de set)
│   └── ui/
│       ├── card-view.ts           # rendu forme+couleur+glyphe (SVG)
│       ├── board-view.ts          # 4 slots, feedback de cohérence du plateau
│       ├── drag-drop.ts           # Pointer Events, preview de tension pendant le drag
│       ├── hud.ts                 # recette, jauges, décomposition du score, beat
│       └── screens.ts             # accueil (déblocage audio), fin de set
└── tests/
    └── rules/                     # tests unitaires du scoring (Vitest)
        ├── evaluate.test.ts
        └── scoring-p1.test.ts
```

---

## 6. Ce que ce document ne tranche pas

Ce document est une proposition d'outillage au service du GDD ; il ne clôt **aucun** des points que le GDD laisse explicitement ouverts ("Points encore ouverts à trancher") :

- **Le choix final de la formule de scoring** (Propositions 1/2/3, section 4 du GDD) : l'architecture implémente la Proposition 1 en premier (recommandation du GDD pour le premier test) et prévoit l'interface `ScoringStrategy` précisément pour que ce choix se fasse **en playtest / A/B test**, pas ici.
- **Remplacement libre vs limité par requête** (section 11) : le prototype démarre en libre (parti pris de simplicité, aligné sur la remarque du GDD), l'état de jeu est conçu pour accueillir la variante limitée — la décision revient au playtest.
- **Le ton de l'humour du robot musicien et la présentation des requêtes/dialogues à l'écran** (section 6) : le HUD affiche les recettes de `recipes.json` de façon neutre en attendant ; rien dans l'architecture ne contraint ce choix éditorial.
- **Nombre de requêtes par set et taille de main/deck** (section 11) : les valeurs 6 requêtes / main de 6 / pioche de 2 sont des défauts de démarrage **à valider en playtest**, externalisés en configuration pour être modifiables sans code.

S'y ajoutent les inconnues proprement techniques introduites par ce document, elles aussi à valider en playtest : tempo (120 BPM ?) et tonalité communs, granularité de quantification (beat vs mesure) au remplacement de carte, geste de preview sur mobile (appui maintenu ?), fenêtre de tolérance du bonus de timing, et l'opportunité d'un packaging Capacitor vs portage moteur si le prototype est concluant. Enfin, le nom "Music Runes" reste un nom de travail — le GDD dit "[Nom provisoire]".
