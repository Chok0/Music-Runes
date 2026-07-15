# Music Runes — Modèle de données du MVP

> **Statut du document** : documentation des fichiers de données du prototype. La seule source de vérité design est le [GDD](../GDD-jeu-mix-cartes.md) — en particulier ses sections 3bis (taxonomie), 4 (scoring), 9 (cartes) et 10 (recettes). Tout ce qui n'est pas dans le GDD est signalé ici comme **proposition** ou **parti pris de démarrage à valider**.
>
> **Nom de travail** : « Music Runes » est un nom provisoire (le GDD dit « [Nom provisoire] »).

Quatre fichiers de données, tous en JSON strict (sans commentaires — les explications sont ici) :

| Fichier | Contenu | Source GDD |
|---|---|---|
| [`data/cards.json`](../data/cards.json) | Les 12 cartes du set MVP | Section 9 (+ 3bis) |
| [`data/recipes.json`](../data/recipes.json) | Les 8 recettes de test | Section 10 |
| [`data/scoring.json`](../data/scoring.json) | Paramètres de la Proposition 1 de scoring | Section 4 |
| [`data/audio.json`](../data/audio.json) | Tempo global et longueur de boucle (partis pris audio) | Aucune (proposition, cf. §2) |

---

## 1. Le principe fondateur : tags vs identité (GDD section 3bis)

Le GDD tranche une distinction cruciale que le modèle de données doit refléter partout :

- **Les tags — Genre et Énergie** — sont les **deux seuls paramètres qui entrent dans le calcul de synergie et de score**. Ils sont fixes pour une carte, quel que soit le slot où elle est posée.
- **Le glyphe / l'identité** (nom, visuel, et surtout les **4 stems audio, un par slot**) est **purement identitaire et sonore : il n'entre jamais dans le calcul de synergie/score**. Il sert à distinguer deux cartes de mêmes tags (ex. deux Metal Intense) et à porter la richesse audio réelle.

Concrètement dans `cards.json` : les champs `genre` et `energy` sont les seuls lus par le moteur de score ; l'objet `slots` (descriptions + chemins de stems) est lu uniquement par le moteur audio et l'UI. Une carte joue un stem différent selon son slot, mais son rôle dans le score ne change pas selon le slot.

### Encodage visuel des tags (GDD sections 3bis et 9)

Le Genre est encodé par la **forme** de la carte, l'Énergie par la **couleur** :

| Genre | Forme |
|---|---|
| Techno | Cercle |
| Metal | Losange |
| Pop | Carré |
| Jazz | Triangle |
| Ambient | Hexagone |

| Énergie | Couleur |
|---|---|
| Calme | Bleu |
| Neutre | Gris |
| Intense | Noir/Rouge |

Ce mapping est présentationnel : il n'est pas dupliqué dans les JSON (le moteur travaille sur les chaînes `"Techno"`, `"Calme"`, etc.) ; l'UI le dérive du genre/énergie. Si on préfère le rendre data-driven plus tard, il pourra rejoindre un fichier de thème — proposition, pas une exigence du GDD.

---

## 2. `data/cards.json` — les 12 cartes du set MVP

Encodage exact de la table de la section 9 du GDD. Valeurs autorisées :

- `genre` ∈ `Techno` · `Metal` · `Pop` · `Jazz` · `Ambient` (les 5 genres MVP)
- `energy` ∈ `Calme` · `Neutre` · `Intense` (les 3 niveaux)
- `rarity` : `"commune"` pour les 12 cartes — le GDD précise que rareté (rare/légendaire) et combos narratifs viendront après validation du noyau système.

### Schéma d'une carte

| Champ | Type | Description |
|---|---|---|
| `id` | string | Slug kebab-case dérivé du nom (`"loup-statique"`, `"poussiere-d-etoile"`…). Identifiant technique stable, utilisé pour les chemins d'assets. |
| `name` | string | Le nom/glyphe **exact** du GDD (`"Loup Statique"`, `"Écho Bleuté"`…). C'est le repère identitaire de la section 3bis. |
| `genre` | string | Tag Genre — entre dans le score. |
| `energy` | string | Tag Énergie — entre dans le score. |
| `rarity` | string | `"commune"` (MVP). |
| `slots` | object | Les 4 interprétations audio de la carte, clés `rythme` / `basse` / `harmonie` / `lead` (les 4 slots de la section 2 du GDD). **Jamais lu par le moteur de score.** |
| `slots.<slot>.description` | string | Texte **exact** de la table du GDD décrivant l'interprétation dans ce slot. |
| `slots.<slot>.stem` | string | Chemin placeholder vers la boucle audio (`assets/stems/<id>/<slot>.ogg`). Assets à produire. |

### Correspondance des colonnes du GDD

La table de la section 9 liste les interprétations par slot dans l'ordre des slots de la section 2 — **Rythme (🥁), Basse (🎸), Harmonie (🎹), Lead (🎤)** : chaque colonne correspond directement à la clé de `slots` du même nom (`rythme`, `basse`, `harmonie`, `lead`).

### Partis pris audio (à valider, hors GDD)

Proposition MVP : toutes les boucles sont produites sur **un tempo global unique** (ex. 120 BPM) et **une tonalité commune**, pour que n'importe quelle combinaison de 4 stems se superpose proprement (lecture synchronisée via Web Audio API / Tone.js). Le tempo et la longueur de boucle sont paramétrés dans **`data/audio.json`**, source unique lue à la fois par le moteur audio (`src/config.ts`) et par le générateur de stems (`scripts/generate-stems.mjs`) — changer le BPM d'un seul côté ne peut pas désynchroniser l'autre. Conséquence : l'axe « respect du tempo/tonalité globale » du score de cohérence (GDD section 4, axe 1) est satisfait par construction dans le MVP et n'a pas besoin d'être paramétré dans `scoring.json`. Côté formats, l'[architecture technique](architecture-technique.md) (section 4.2) recommande un **double encodage** `.ogg` (Vorbis, Chrome/Firefox/Android) + `.m4a` (AAC, Safari/iOS) avec détection du support au chargement : `cards.json` stocke le **chemin canonique en `.ogg`**, et le loader substitue l'extension `.m4a` si le navigateur ne lit pas Vorbis — **parti pris de démarrage, à valider**.

---

## 3. `data/recipes.json` — les 8 recettes de test

Les 8 recettes de la section 10 du GDD, **dans l'ordre du GDD**, qui est aussi l'ordre de difficulté croissante (du plus facile, qui enseigne le système, au plus contradictoire).

### Schéma d'une recette

| Champ | Type | Description |
|---|---|---|
| `id` | string | Slug kebab-case du nom. |
| `name` | string | Nom **exact** entre guillemets dans le GDD (`"Ouverture club"`, `"Techno Romantique"`…). |
| `difficulty` | string | Le libellé en italique **exact** du GDD : `"Facile"`, `"Cohérence pure"`, `"Teste le bonus de contraste"`, `"Contradictoire"`, `"Contradictoire, comique"`, `"Diversité"`. C'est un libellé descriptif, pas une échelle numérique. |
| `flavor` | string | Texte d'ambiance/humour de la requête. **Vide pour l'instant** : le ton exact de l'humour du robot musicien et la façon d'écrire/afficher les requêtes sont des **points encore ouverts du GDD** — ce champ existe pour les accueillir sans figer quoi que ce soit. |
| `conditions` | array | Conditions machine-exploitables (voir ci-dessous). **Chaque condition remplie vaut +5** (cf. `scoring.json`, conforme à la Proposition 1 : « +5 par condition de la recette remplie »). |

### Types de condition

Toutes les conditions s'évaluent sur **les 4 cartes posées sur le plateau au moment du drop**. Un `filter` combine ses champs en **ET** ; à l'intérieur d'un champ, le tableau de valeurs est un **OU** :

```json
{ "genre": ["Jazz", "Ambient"], "energy": ["Calme"] }
```

se lit : « carte de genre (Jazz **ou** Ambient) **et** d'énergie Calme ».

| Type | Paramètres | Sémantique |
|---|---|---|
| `min_count` | `count`, `filter` | Au moins `count` cartes du plateau matchent le `filter`. |
| `none` | `filter` | **Aucune** carte du plateau ne matche le `filter`. Équivalent à un `max_count` avec `count: 0` — la forme généralisée `max_count` (`count` ≥ 1) est réservée pour de futures recettes, aucune des 8 recettes MVP n'en a besoin. |
| `all_same_genre` | — | Les 4 cartes posées sont du même Genre. |
| `all_different_genres` | — | Les 4 cartes posées sont de 4 Genres différents. |

### Encodage des 8 recettes

| # | Recette | Difficulté (GDD) | Encodage |
|---|---|---|---|
| 1 | "Ouverture club" | *Facile* | `min_count` 2 × genre Techno |
| 2 | "Session lounge" | *Facile* | `min_count` 2 × genre (Ambient OU Jazz) **et** `none` énergie Intense |
| 3 | "Set stade" | *Facile* | `min_count` 2 × (genre Pop **et** énergie Intense) |
| 4 | "Set monochrome" | *Cohérence pure* | `all_same_genre` |
| 5 | "Contraste assumé" | *Teste le bonus de contraste* | `min_count` 1 × énergie Calme **et** `min_count` 1 × énergie Intense |
| 6 | "Techno Romantique" | *Contradictoire* | `min_count` 1 × genre Techno **et** `min_count` 1 × (genre (Jazz OU Ambient) **et** énergie Calme) |
| 7 | "Metal pour bébé" | *Contradictoire, comique* | `min_count` 1 × genre Metal **et** `none` énergie Intense |
| 8 | "Improvisation totale" | *Diversité* | `all_different_genres` |

Notes de fidélité :

- **"Techno Romantique"** (que le GDD désigne comme *la recette signature*) : le texte du GDD — « au moins 1 carte Techno ET 1 carte Jazz ou Ambient Calme » — est lu comme « 1 carte de genre (Jazz ou Ambient) **et** Calme ». C'est l'interprétation retenue dans le JSON ; si le GDD voulait dire « (Jazz) ou (Ambient Calme) », l'encodage devra être ajusté — **interprétation à confirmer**.
- **"Metal pour bébé"** : encodée fidèlement comme au moins 1 Metal **et** aucune Intense — ce qui, avec le set MVP, impose Cendre Grise (le seul Metal non-Intense), exactement la tension comique voulue par le GDD.
- **Constat de faisabilité (vérifié par énumération)** : avec un deck composé d'**un seul exemplaire** de chacune des 12 cartes, deux recettes sont **insatisfiables à la lettre** : "Set stade" (le set ne contient qu'une seule carte Pop Intense, Néon Carré) et "Set monochrome" (aucun Genre n'a plus de 3 cartes, or il en faut 4 identiques). L'encodage JSON reste **littéral** au texte du GDD. Trois lectures possibles, **à trancher en playtest** : (a) le deck admet des doublons (le GDD ne l'interdit pas, et l'acquisition par packs le suggère) ; (b) ces recettes sont volontairement non parfaisables avec le deck de départ — la condition manquée coûte simplement le +5 d'objectif et le joueur optimise la cohérence ; (c) la condition de "Set stade" devrait se lire autrement (ex. « 2 cartes Pop dont au moins 1 Intense »). Le prototype démarre avec la lecture (b) — **parti pris de démarrage, à valider**.
- Le GDD ne fixe pas le nombre de requêtes par set (5-8, point ouvert) : **parti pris de démarrage : 6 requêtes par set, à valider en playtest**. L'ordre du fichier sert de séquence de difficulté par défaut ; le tirage aléatoire des recettes (GDD section 7) reste l'objectif à terme.

---

## 4. `data/scoring.json` — la Proposition 1 paramétrée

**Parti pris de démarrage** : le premier test in-game utilise la **Proposition 1 — Somme pondérée** (c'est la recommandation explicite du GDD section 4 : « rapide à coder, facile à itérer »). Les Propositions 2 (multiplicateur de combo) et 3 (deux jauges séparées) restent **en réserve pour A/B test** — le choix final entre les 3 propositions est un **point encore ouvert du GDD**. Le fichier porte ce statut dans `model_status`.

### Correspondance champ ↔ règle du GDD

| Champ | Valeur | Règle du GDD (section 4, Proposition 1) |
|---|---|---|
| `coherence.same_genre_pair_bonus` | `2` | +2 par paire de cartes au même Genre |
| `coherence.same_energy_pair_bonus` | `1` | +1 par paire à Énergie identique |
| `coherence.contrast_pair_bonus` | `2` | **Aucune** — bonus de contraste des sections 3/4 du GDD, absent de la lettre de la Proposition 1 (voir ⚠️ ci-dessous) |
| `coherence.unrequested_genre_conflict_pair_penalty` | `-2` | −2 par paire en contradiction de Genre **non demandée par la recette** |
| `objective.per_condition_met_bonus` | `5` | +5 par condition de la recette remplie |
| `audacious_resolution.flat_bonus` | `10` | +10 flat si une contradiction *demandée par la recette* est effectivement posée, malgré la pénalité de cohérence qu'elle génère |
| `star_thresholds` | 3★ ≥ 0.8 · 2★ ≥ 0.5 · 1★ ≥ 0.25 | Paliers en % du **score max théorique** (≥80 % = 3★, ≥50 % = 2★, ≥25 % = 1★ — valeurs données en « ex. » par le GDD, donc réglables) |

Les « paires » s'entendent sur les 4 cartes du plateau : 6 paires possibles (C(4,2)), chacune évaluée indépendamment pour le Genre et pour l'Énergie.

Le **score de timing** (GDD section 4, axe 3 — bonus si la pose est calée sur le beat) est un skill **optionnel** et ne fait pas partie de la formule de la Proposition 1 : il n'est volontairement pas paramétré dans ce fichier pour le premier prototype.

### ⚠️ Bonus de contraste — annoncé par le GDD mais absent de la Proposition 1

Le **bonus de contraste** (« 1 carte énergie haute + 1 carte énergie basse → bonus de contraste ») fait partie de l'Option A retenue ✅ du GDD (section 3), est repris par le score de cohérence (section 4, axe 1 : « contrastes qui matchent ») et justifie même la conservation de l'axe Énergie (section 3bis) ; la recette 5, "Contraste assumé", porte le libellé GDD « Teste le bonus de contraste ». Or la lettre de la **Proposition 1 ne contient aucun terme de contraste** côté cohérence — seul le +5 d'objectif récompenserait la présence simultanée Calme+Intense. C'est une **incohérence interne du GDD, à trancher** (signalée dans ses « Points encore ouverts à trancher »), du même ordre que le score de timing non paramétré ci-dessus et la matrice `genre_conflicts` ci-dessous.

Pour que le playtest de la recette 5 puisse effectivement tester le mécanisme que son nom annonce, `scoring.json` embarque un paramètre **`coherence.contrast_pair_bonus`** (`2` par paire Calme↔Intense sur le plateau, statut porté par le champ `contrast_pair_bonus_status` dans le fichier) — **proposition non couverte par la Proposition 1, à valider en playtest** ; le mettre à `0` redonne la Proposition 1 à la lettre.

### ⚠️ `genre_conflicts` — un paramètre que le GDD ne définit pas encore

La Proposition 1 pénalise (−2) les paires « en contradiction de Genre », et le bonus de résolution audacieuse (+10) repose sur la même notion — mais **le GDD ne définit nulle part formellement quelles paires de Genres se contredisent**. C'est un paramètre d'équilibrage qu'il faudra expliciter et régler en playtest.

`scoring.json` embarque donc une **matrice par défaut sous la clé `genre_conflicts`, clairement marquée « à valider »** (champ `status` dans le fichier) :

| Paire | Statut proposé |
|---|---|
| Metal ↔ Ambient | En contradiction |
| Metal ↔ Jazz | En contradiction |
| Techno ↔ Jazz | En contradiction |
| Techno ↔ Ambient | En contradiction |
| Toutes les autres paires | Neutres |

Justification de ce **parti pris** (aucune de ces paires n'est décidée par le GDD) : les paires Metal↔Ambient et Metal↔Jazz opposent le genre le plus agressif aux deux genres les plus feutrés ; les paires Techno↔Jazz et Techno↔Ambient sont ajoutées pour que **"Techno Romantique"** — que le GDD présente en section 7 comme l'exemple type de recette contradictoire (« ces deux tags ne synergisent pas nativement ») — génère effectivement une contradiction dans le moteur, et donc déclenche la pénalité puis le bonus audacieux. Sans elles, la recette signature serait mécaniquement « facile ». La matrice est symétrique (l'ordre dans chaque paire est indifférent).

À noter : la contradiction de **"Metal pour bébé"** est de nature Genre↔Énergie (Metal exigé, Intense interdit), pas Genre↔Genre — elle ne passe donc pas par cette matrice mais par la structure même de ses conditions. Si le playtest montre qu'elle mérite aussi le bonus audacieux, la notion de « contradiction demandée » devra être étendue au-delà des paires de Genres — **question d'équilibrage ouverte**.

### « Demandée par la recette » : règle d'application proposée

Le GDD distingue les contradictions *demandées* (exemptées de pénalité, éligibles au +10) des contradictions *non demandées* (−2). Règle d'implémentation **proposée** (à valider en playtest) :

> Une paire de cartes en conflit de Genre est « demandée par la recette » si ses deux cartes satisfont chacune une condition `min_count` **différente** de la recette, et que les genres exigés par ces deux conditions forment une paire de `genre_conflicts.pairs`. Dans ce cas : pas de pénalité −2 pour cette paire, et le bonus `audacious_resolution.flat_bonus` (+10) est accordé **une fois** pour le drop. Toute autre paire en conflit reste pénalisée normalement.

Exemple : sur "Techno Romantique", poser Loup Statique (Techno) + Cuivre Calme (Jazz Calme) forme une paire Techno↔Jazz demandée → pas de −2 sur cette paire, +10 audacieux. Une deuxième carte Jazz non nécessaire à la recette qui entrerait en conflit avec une deuxième Techno resterait pénalisée.

### Score max théorique et étoiles

Les paliers d'étoiles sont exprimés en **ratio du score max théorique** de la requête. Proposition d'implémentation : comme les tags ne dépendent pas du slot (section 3bis), le score d'un drop ne dépend que de l'**ensemble** des 4 cartes posées — avec le deck MVP de 12 cartes il n'y a que C(12,4) = 495 combinaisons, donc le max théorique se calcule par énumération exhaustive (par recette, sur les cartes du deck du joueur ; le restreindre aux cartes effectivement accessibles — plateau + main — est une variante plus indulgente à comparer en playtest). **Proposition technique, pas une décision du GDD.**

---

## 5. Rappel des points ouverts touchés par ces fichiers

Ces points du GDD (« Points encore ouverts à trancher ») restent **ouverts** ; les fichiers de données ne font que fournir des valeurs de démarrage :

1. **Choix entre les 3 propositions de scoring** → `scoring.json` implémente la Proposition 1 en parti pris de démarrage ; Propositions 2 et 3 en réserve pour A/B test.
2. **Remplacement libre vs limité** → aucun impact sur ces trois fichiers (paramètre de boucle de jeu) ; parti pris prototype : libre, à comparer en playtest.
3. **Ton de l'humour / écriture des requêtes** → champ `flavor` laissé vide dans `recipes.json` en attendant.
4. **Nombre de requêtes par set, taille de main/deck** → hors de ces fichiers ; partis pris : 6 requêtes, main de 6, pioche de 2, deck = les 12 cartes — à valider en playtest.

S'y ajoutent les paramètres introduits par ce modèle de données, **non tranchés par le GDD** : la matrice `genre_conflicts`, le bonus de contraste `contrast_pair_bonus` (annoncé par le GDD mais non chiffré par la Proposition 1), la règle d'application du bonus audacieux, l'interprétation de "Techno Romantique", le format/tempo/tonalité des stems, et le mode de calcul du max théorique.
