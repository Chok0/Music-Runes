# Roadmap MVP — « Music Runes » (nom provisoire)

> Document dérivé du [Game Design Document](../GDD-jeu-mix-cartes.md), seule source de vérité.
> « Music Runes » est un **nom de travail** (le GDD dit « [Nom provisoire] ») — parti pris de démarrage, à valider.
> Ce plan est ordonné en jalons (M0 → M4). **Aucune date, aucune estimation en jours** : seuls comptent l'ordre et les critères de sortie.

---

## 1. Objectif du MVP

Le MVP existe pour **valider le noyau du jeu tel que le GDD le cadre**, rien de plus :

- **Valider la boucle solo** (GDD §8 : « solo pur pour le MVP » ✅) sur la **structure en set continu** (GDD §11 ✅) : plateau persistant de 4 slots (Rythme, Basse, Harmonie, Lead — GDD §2 ✅), séquence de requêtes scorées une à une, score cumulé = valeur du set.
- **Valider la tension recette/synergie comme moteur central** (GDD §7) : le joueur doit arbitrer entre score de cohérence (tags) et score d'objectif (recette), et la contradiction doit être visible *avant* la pose.
- **Contenu de validation** : les **12 cartes** du GDD (§9, toutes communes), les **8 recettes** de test (§10, déjà ordonnées en difficulté croissante), le **scoring Proposition 1** (somme pondérée — recommandation explicite du GDD §4 pour le premier test in-game).
- **Vérifier le pari central de lisibilité** (GDD §5) : toute l'information de décision est lisible sur la carte (forme = Genre, couleur = Énergie, glyphe = identité — GDD §3bis ✅), sans oreille musicale requise ; la musique est la récompense, pas l'outil de décision.

### Parti pris technique de démarrage (proposition, pas une décision du GDD)

- **Application web TypeScript + Vite**, audio via **Web Audio API + Tone.js** (boucles/stems synchronisés, preview au survol, quantification sur la mesure ou le beat — granularité à régler à l'oreille en playtest).
- Jouable au navigateur **desktop et mobile tactile** ; packaging natif (ex. Capacitor) ou portage moteur envisagés **post-MVP** si nécessaire.
- Justification : itération la plus rapide pour un gameplay audio-first, partageable en playtest par simple lien.
- **Audio MVP** : chaque carte = 4 stems (un par slot, cf. GDD §3bis), boucles calées sur un **tempo global unique** (ex. 120 BPM) et une **tonalité commune** pour que tout se superpose proprement. Assets placeholder à produire. *(Proposition technique à valider — le GDD ne fixe ni tempo ni tonalité.)*

### Paramètres de démarrage (partis pris « à valider en playtest », jamais des décisions du GDD)

| Paramètre | Valeur de départ | Statut |
|---|---|---|
| Requêtes par set | 6 (le GDD dit 5–8) | À valider en playtest |
| Main de départ | 6 cartes | À valider en playtest |
| Pioche à chaque nouvelle requête | 2 cartes | À valider en playtest |
| Deck MVP | Les 12 cartes du GDD §9 | Contenu GDD |
| Remplacement des cartes posées | **Libre** (les 4 slots modifiables à chaque requête) — le GDD note que c'est le plus simple à coder | À comparer avec la variante limitée en playtest (GDD §11) |
| Scoring | **Proposition 1** (somme pondérée) — recommandation du GDD §4 | Propositions 2 et 3 en réserve pour A/B test |

---

## 2. Jalons

### M0 — Setup

**Contenu**
- Initialisation du repo : Vite + TypeScript, lint/format, structure de dossiers.
- Squelette de modules découplés : `cards` (données), `board` (plateau/slots), `scoring`, `recipes`, `audio` (vide à ce stade), `ui`.
- Données du GDD encodées en **JSON** : les 12 cartes (§9 : nom/glyphe, Genre, Énergie, descriptions des 4 stems) et les 8 recettes (§10 : conditions exprimées en données, pas en code).
- Chargement et validation de ces JSON au démarrage (schéma minimal : une carte a exactement 1 Genre, 1 Énergie, 4 stems).

**Livrables**
- Repo buildable, page « hello » servie par Vite.
- `data/cards.json` (12 cartes) et `data/recipes.json` (8 recettes) fidèles aux tables du GDD.
- Module de chargement avec erreurs explicites si les données sont invalides.

**Done quand…** `npm run dev` sert l'app, les 12 cartes et 8 recettes sont chargées depuis le JSON et affichées en liste brute (texte) sans erreur.

---

### M1 — Boucle jouable muette

**Contenu**
- Plateau **4 slots fixes** (Rythme, Basse, Harmonie, Lead — GDD §2 ✅) ; poser une carte sur un slot occupé **remplace** la précédente (pas d'empilement — GDD §2 ✅).
- Main, pioche, deck : main de départ (6 cartes — parti pris), pioche de complément à chaque nouvelle requête (2 cartes — parti pris).
- **Séquence de requêtes d'un set** sur plateau persistant (GDD §11 ✅) : requête affichée → le joueur ajuste le plateau → **drop** → scoring → requête suivante. Remplacement **libre** entre requêtes (parti pris de démarrage).
- **Scoring Proposition 1** (GDD §4) implémenté intégralement : +2 par paire de même Genre, +1 par paire d'Énergie identique, −2 par paire en contradiction de Genre non demandée par la recette, +5 par condition de recette remplie, +10 flat de « résolution audacieuse » si une contradiction demandée par la recette est effectivement posée. Mapping en 1–3 étoiles par paliers (ex. ≥80 % / ≥50 % / ≥25 % du score max théorique). S'y ajoute le **bonus de contraste** de `data/scoring.json` (`contrast_pair_bonus` : +2 par paire Calme↔Intense — proposition hors Proposition 1 stricte, à valider en playtest, remettable à 0 ; cf. `docs/modele-de-donnees.md` §4).
- **Décomposition du score affichée** : le GDD (§4) exige que le joueur comprenne *pourquoi* il a scoré → affichage détaillé façon « +12 synergie, +8 objectif » (pas de timing au MVP), ligne par ligne (quelle paire, quelle condition, quel bonus).
- Aucune contrainte de pose bloquante : toute carte est posable sur tout slot, une mauvaise combinaison coûte des points mais ne bloque jamais (principe « main de poker » — GDD §5, point tranché).

**Livrables**
- Partie complète jouable au clavier/souris, **sans audio**, avec des placeholders visuels minimaux (texte + tags).
- Moteur de scoring testé unitairement sur des plateaux connus (dont : « Set monochrome » = 4× même Genre, « Techno Romantique » avec et sans résolution).

**Done quand…** on peut jouer un set entier (6 requêtes — parti pris) de bout en bout, chaque drop affiche le score décomposé (+X synergie, +Y objectif, bonus éventuel) et les étoiles, et le score cumulé du set s'affiche à la fin. Sans son.

---

### M2 — Audio

**Contenu**
- Production des **stems placeholder** : 12 cartes × 4 stems = **48 boucles**, toutes calées sur le même tempo global (ex. 120 BPM) et une tonalité commune (parti pris technique à valider). Le caractère de chaque stem suit les descriptions du tableau du GDD §9 (ex. « Loup Statique » en Basse = sub acide punchy, en Lead = vocal chop robotique — GDD §3bis ✅ : le son change selon le slot, les tags non).
- Intégration Tone.js : lecture synchronisée des 4 slots, **mix en temps réel à la pose** (poser/remplacer une carte change le mix de façon audible — GDD §1, point 3), avec quantification sur la mesure ou le beat, granularité à régler à l'oreille en playtest (parti pris technique de cette roadmap, cf. « Parti pris technique de démarrage » — pas une exigence du GDD).
- **Preview sonore courte au survol** (1–2 s) d'une carte en main — validé par le GDD §5 comme complément au visuel.
- Gestion des cas mobiles : déblocage du contexte audio au premier geste, comportement tactile du « survol » (ex. appui long = preview — proposition à valider).

**Livrables**
- Les 48 stems placeholder versionnés (ou pipeline documenté pour les régénérer).
- Le jeu de M1, désormais audible : chaque plateau produit un mix superposé propre, sans décalage rythmique.

**Done quand…** n'importe quelle combinaison de 4 cartes sur les 4 slots joue un mix synchronisé et supportable à l'oreille (pas de désynchronisation, pas de clipping), la preview au survol fonctionne, et un remplacement de carte s'entend proprement au prochain point de quantification (mesure ou beat).

---

### M3 — Lisibilité & feedback

**Contenu**
- **Langage visuel des cartes** (GDD §3bis ✅) : forme = Genre (Cercle Techno, Losange Metal, Carré Pop, Triangle Jazz, Hexagone Ambient), couleur = Énergie (Bleu Calme, Gris Neutre, Noir/Rouge Intense), **glyphe unique** purement identitaire (jamais dans le calcul).
- **Visualisation des synergies et tensions AVANT la pose** (GDD §5 et §7) : au survol/à la sélection d'une carte en main, les compatibilités avec le plateau sont montrées (formes qui s'emboîtent, couleurs accordées) et les conflits aussi (halo rouge, formes qui se repoussent) — le joueur voit le coût de la contradiction avant de s'engager, sans théorie musicale.
- **Feedback visuel de cohérence du plateau** (GDD §5) : le plateau change d'apparence selon la qualité du mix (harmonieux = formes alignées, dissonant = formes qui se chevauchent/tremblent).
- **Écran de fin de round** : décomposition complète du score (ligne par ligne : paires de synergie, conditions de recette, bonus de résolution audacieuse, pénalités) + étoiles ; écran de fin de set avec score cumulé.
- Habillage minimal des requêtes dans le cadre narratif du robot en tournée (GDD §6 ✅) — le **ton exact de l'humour reste un point ouvert** du GDD : on affiche les recettes telles quelles (titres du §10), l'écriture des dialogues est explicitement reportée (cf. tableau des décisions).

**Livrables**
- Cartes finales MVP (forme/couleur/glyphe), plateau réactif, indicateurs de tension pré-pose.
- Écrans de fin de round et de fin de set.

**Done quand…** un testeur qui n'a jamais lu le GDD peut, **sans écouter**, prédire si une carte va aider ou pénaliser son plateau avant de la poser, et expliquer après coup pourquoi il a obtenu son score en lisant l'écran de fin de round.

---

### M4 — Set complet & playtest

**Contenu**
- Les **8 recettes du GDD §10 en séquence**, dans l'ordre du GDD (déjà pensé du plus facile au plus contradictoire : Ouverture club → … → Improvisation totale) — la difficulté progressive est la courbe de progression native voulue par le GDD §7. *(Note : le set de démarrage est fixé à 6 requêtes — parti pris ; pour ce jalon de validation on joue les 8 recettes en séquence complète afin de tester toute la courbe, la longueur finale du set restant à trancher.)*
- **Score de set cumulé** affiché en continu et en fin de partie (valeur du set — GDD §11 ✅).
- Équilibrage de premier passage : vérifier que chaque recette est atteignable en 3★ avec le deck de 12 cartes, et que « Techno Romantique » et « Metal pour bébé » forcent réellement un arbitrage (sinon la tension §7 n'est pas validée).
- Instrumentation légère pour le playtest : log local des drops, scores, cartes remplacées.
- **Premier playtest externe** : build partagé par lien (avantage du parti pris web), grille d'observation centrée sur les questions ouvertes du GDD (compréhension du score, frustration ou plaisir du remplacement libre, lisibilité pour non-mélomanes).

**Livrables**
- Build jouable de bout en bout, partageable par URL, desktop + mobile tactile.
- Compte rendu du playtest : verbatims, données de score, réponses aux questions du tableau ci-dessous.

**Done quand…** au moins un set complet des 8 recettes a été joué par des testeurs externes sans assistance, et que les données/verbatims permettent d'alimenter chaque ligne du tableau « Décisions à prendre » ci-dessous.

---

### Post-MVP (hors scope — juste listé, conformément au GDD)

Tout ce qui suit est **marqué post-MVP, « à creuser plus tard » ou optionnel dans le GDD** et n'entre dans aucun jalon ci-dessus (l'exclusion des éléments seulement « optionnels », comme le score de timing, est un parti pris de cette roadmap) :

- **Score de timing** sur le beat (GDD §4, axe 3 — « skill optionnel »).
- **Rareté** (commune/rare/légendaire) et **combos narratifs écrits à la main** sur les rares/légendaires (GDD §3 option B, §8, §9 : « toutes communes pour le MVP »).
- **Lab de création de stems** — fabrication de cartes custom par le joueur (GDD §8 : « feature avancée plutôt que MVP »).
- **Multijoueur** (battle ou coop) — extension post-MVP une fois la boucle solo validée (GDD §8 ✅).
- **Slots évolutifs** comme axe de progression (GDD §2 : « piste post-MVP »).
- **Monétisation** achat cash → monnaie in-game (GDD §8 : monnaie in-game uniquement pour le MVP ✅).
- Mécanique d'**ordre de pose** façon Canvas (GDD §7 : « piste ») — non retenue pour le MVP, à réévaluer après validation du noyau.
- Packaging **mobile natif** (ex. Capacitor) ou portage moteur — proposition technique, seulement si le MVP web valide le jeu.

---

## 3. Décisions à prendre et quand

Les points ci-dessous sont ceux listés comme **ouverts** en fin de GDD (« Points encore ouverts à trancher »), plus le paramètre de remplacement (GDD §11). Ils **restent ouverts** : les valeurs de démarrage indiquées sont des partis pris à valider, pas des décisions.

| Point ouvert (GDD) | Parti pris de démarrage | Jalon où trancher | Méthode |
|---|---|---|---|
| **Choix entre les 3 propositions de scoring** (§4) | Proposition 1 (recommandation du GDD pour le premier test) | Après **M4** — décision post-playtest | Playtest M4 : si le retour « je ne comprends pas mon score » revient souvent, implémenter la Proposition 3 et **A/B test** P1 vs P3 (P2 en réserve), comme le suggère le GDD |
| **Chiffrage du bonus de contraste** (incohérence interne du GDD : annoncé §3 ✅ et testé par la recette « Contraste assumé », mais chiffré par aucune des 3 propositions §4) | +2 par paire Calme↔Intense (`contrast_pair_bonus` dans `data/scoring.json`, remettable à 0 pour la Proposition 1 stricte) | Après **M4**, en même temps que le choix de la formule | Playtest M4 : vérifier que la recette « Contraste assumé » récompense bien ce qu'elle annonce, puis intégrer le terme à la formule retenue |
| **Remplacement libre vs limité par requête** (§11) | Libre (le plus simple à coder, dixit le GDD) | Après **M4** | Playtest M4 : observer si le remplacement libre tue la tension stratégique ; si oui, prototyper la variante « max 2 slots » et comparer en **A/B** |
| **Nombre de requêtes par set** (5 ? 8 ?) | 6 par set (le GDD dit 5–8) ; M4 joue les 8 recettes pour tester toute la courbe | Après **M4** | Playtest M4 : mesurer la durée réelle d'un set vs la cible 2–5 min/round du GDD §1 et le point de lassitude des testeurs |
| **Taille de la main / du deck de départ** | Main de 6, pioche de 2 par requête, deck = les 12 cartes du GDD | Après **M4** (premiers signaux dès **M1** en test interne) | Playtest : la main permet-elle toujours au moins un choix intéressant sans paralysie ? Ajuster par itération |
| **Ton exact de l'humour du robot + écriture/affichage des requêtes** (§6) | MVP : recettes affichées telles quelles (titres du §10), sans dialogues | Cadrage à **M3** (habillage minimal), décision réelle **post-MVP** | Tests de lecture sur 2–3 variantes de ton (absurde / second degré / tendre) auprès des playtesters — n'est pas bloquant pour valider la boucle |

---

## 4. Risques

- **Lisibilité pour les non-mélomanes — le pari central (GDD §5).** Si un testeur doit *entendre* les compatibilités pour bien jouer, le jeu exclut son public cible. Mitigation : le critère de sortie de M3 teste exactement ça (prédire l'effet d'une carte sans écouter) ; si ça échoue, retravailler le langage formes/couleurs avant tout playtest externe.
- **Bouillie sonore si les stems sont mal calés.** Le GDD (§2) identifie la bouillie comme l'ennemi ; avec 48 stems superposables 4 par 4, un seul stem hors tempo ou hors tonalité ruine la « récompense sensorielle ». Mitigation : contrainte stricte de production (tempo global unique + tonalité commune — parti pris à valider), et critère de sortie M2 exigeant que *toute* combinaison soit propre, pas seulement les combinaisons synergiques.
- **Coût de production des 48 stems (12 cartes × 4 slots).** C'est le plus gros poste de contenu du MVP et un goulot potentiel de M2. Mitigation : assets placeholder assumés (qualité « suffisante pour juger le fun », pas de production finale), pipeline reproductible documenté, et ordre de production priorisant les cartes nécessaires aux 3 premières recettes pour débloquer les tests tôt.
- *(Risque secondaire, technique)* **Audio web sur mobile** : latence, autoplay bloqué, « survol » inexistant au tactile. Mitigation : traité explicitement à M2 (déblocage au premier geste, appui long pour la preview — propositions à valider) ; si le web mobile s'avère insuffisant, le packaging natif est déjà identifié comme piste post-MVP.
