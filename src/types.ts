/**
 * Contrats de types du prototype Music Runes.
 *
 * Source de vérité design : GDD-jeu-mix-cartes.md.
 * Source de vérité des schémas de données : docs/modele-de-donnees.md.
 * Découpage en modules : docs/architecture-technique.md (section 3).
 *
 * Règle structurante (GDD section 3bis) : seuls `genre` et `energy` entrent
 * dans le calcul de score ; `slots` (stems) n'est lu que par l'audio et l'UI.
 */

// ---------------------------------------------------------------------------
// Vocabulaire de base
// ---------------------------------------------------------------------------

export type Genre = 'Techno' | 'Metal' | 'Pop' | 'Jazz' | 'Ambient';
export type Energy = 'Calme' | 'Neutre' | 'Intense';
export type SlotId = 'rythme' | 'basse' | 'harmonie' | 'lead';

export const GENRES: readonly Genre[] = ['Techno', 'Metal', 'Pop', 'Jazz', 'Ambient'];
export const ENERGIES: readonly Energy[] = ['Calme', 'Neutre', 'Intense'];
export const SLOT_IDS: readonly SlotId[] = ['rythme', 'basse', 'harmonie', 'lead'];

/** Libellés d'affichage des slots (GDD section 2). */
export const SLOT_LABELS: Record<SlotId, string> = {
  rythme: '🥁 Rythme',
  basse: '🎸 Basse',
  harmonie: '🎹 Harmonie',
  lead: '🎤 Lead',
};

// ---------------------------------------------------------------------------
// Données (data/*.json — schémas de docs/modele-de-donnees.md)
// ---------------------------------------------------------------------------

export interface CardSlotVariant {
  description: string;
  /** Chemin canonique en .ogg ; le loader audio résout le format réel. */
  stem: string;
}

export interface Card {
  id: string;
  name: string;
  genre: Genre;
  energy: Energy;
  rarity: string;
  slots: Record<SlotId, CardSlotVariant>;
}

/** Un filtre combine ses champs en ET ; chaque tableau de valeurs est un OU. */
export interface ConditionFilter {
  genre?: Genre[];
  energy?: Energy[];
}

export type RecipeCondition =
  | { type: 'min_count'; count: number; filter: ConditionFilter }
  | { type: 'none'; filter: ConditionFilter }
  | { type: 'all_same_genre' }
  | { type: 'all_different_genres' };

export interface Recipe {
  id: string;
  name: string;
  difficulty: string;
  flavor: string;
  note?: string;
  conditions: RecipeCondition[];
}

export interface ScoringConfig {
  schema_version: number;
  model: string;
  model_status: string;
  coherence: {
    same_genre_pair_bonus: number;
    same_energy_pair_bonus: number;
    /** Proposition hors Proposition 1 stricte — 0 pour la désactiver. */
    contrast_pair_bonus: number;
    contrast_pair_bonus_status?: string;
    unrequested_genre_conflict_pair_penalty: number;
  };
  objective: { per_condition_met_bonus: number };
  audacious_resolution: { flat_bonus: number };
  star_thresholds: { stars: number; min_ratio_of_theoretical_max: number }[];
  genre_conflicts: { status?: string; pairs: [Genre, Genre][] };
}

/** Données du jeu chargées et validées (module src/data). */
export interface GameData {
  cards: Card[];
  recipes: Recipe[];
  scoring: ScoringConfig;
  cardById: Map<string, Card>;
  recipeById: Map<string, Recipe>;
}

// ---------------------------------------------------------------------------
// Moteur de règles (src/rules) — pur, sans dépendance UI/audio/DOM
// ---------------------------------------------------------------------------

/** Interaction d'une paire de cartes. Une même paire peut cumuler plusieurs détails. */
export interface PairDetail {
  a: string; // id de carte
  b: string; // id de carte
  kind: 'same_genre' | 'same_energy' | 'contrast' | 'conflict' | 'requested_conflict';
  /** Points apportés par ce détail (0 pour requested_conflict : exempté de pénalité). */
  points: number;
}

export interface ConditionDetail {
  index: number;
  label: string;
  met: boolean;
  points: number;
}

export interface ScoreBreakdown {
  pairs: PairDetail[];
  conditions: ConditionDetail[];
  coherence: number;
  objective: number;
  /** +10 si une contradiction demandée par la recette est effectivement posée. */
  audacious: number;
  audaciousApplied: boolean;
  total: number;
}

export interface RulesApi {
  /** Le filtre combine ses champs en ET, chaque tableau en OU (modele-de-donnees §3). */
  matchesFilter(card: Card, filter: ConditionFilter): boolean;
  /**
   * Évalue un plateau (1 à 4 cartes posées — 4 au drop, moins pendant la pose
   * pour le feedback hypothétique). Les conditions s'évaluent sur les cartes
   * présentes ; `all_same_genre`/`all_different_genres` exigent 4 cartes.
   */
  evaluateBoard(placed: Card[], recipe: Recipe, cfg: ScoringConfig): ScoreBreakdown;
  /** Interactions d'une seule paire (feedback avant la pose, GDD sections 5/7). */
  pairDetails(a: Card, b: Card, recipe: Recipe, cfg: ScoringConfig): PairDetail[];
  /**
   * Score max théorique de la recette par énumération exhaustive des C(n,4)
   * combinaisons du deck (modele-de-donnees §4 « Score max théorique »).
   */
  theoreticalMax(deck: Card[], recipe: Recipe, cfg: ScoringConfig): number;
  /** Mappe un total sur 0-3 étoiles via star_thresholds (ratio du max théorique). */
  starsFor(total: number, theoreticalMax: number, cfg: ScoringConfig): number;
  /** Libellé français lisible d'une condition (ex. « Au moins 2 cartes Techno »). */
  conditionLabel(cond: RecipeCondition): string;
}

// ---------------------------------------------------------------------------
// État de jeu (src/state) — machine à états du set (GDD section 11)
// ---------------------------------------------------------------------------

export interface GameConfig {
  /** Partis pris de démarrage (à valider en playtest) — voir src/config.ts. */
  requestsPerSet: number;
  startingHandSize: number;
  drawPerRequest: number;
}

export type GamePhase = 'title' | 'playing' | 'scored' | 'ended';

export interface RequestResult {
  recipeId: string;
  breakdown: ScoreBreakdown;
  stars: number;
  theoreticalMax: number;
}

export interface GameState {
  phase: GamePhase;
  /** Ids des cartes restant à piocher. */
  deck: string[];
  /** Ids des cartes en main. */
  hand: string[];
  /** Plateau persistant entre requêtes (GDD section 11 ✅). */
  board: Record<SlotId, string | null>;
  /** Index de la requête courante dans la séquence du set (0-based). */
  requestIndex: number;
  results: RequestResult[];
  setScore: number;
}

export interface GameStore {
  getState(): GameState;
  subscribe(listener: (state: GameState) => void): () => void;
  /** title → playing : mélange le deck, pioche la main de départ. */
  startSet(): void;
  /**
   * Pose `cardId` (depuis la main ou depuis un autre slot) sur `slot`.
   * Si le slot est occupé, la carte en place retourne en main (remplacement,
   * GDD section 2 ✅ — jamais d'empilement). No-op si la phase ≠ playing.
   */
  place(cardId: string, slot: SlotId): void;
  /** Renvoie la carte du slot en main (ajustement avant drop). */
  removeFromSlot(slot: SlotId): void;
  /** true si les 4 slots sont remplis et la phase est playing. */
  canDrop(): boolean;
  /** Score la requête courante (phase → scored) et retourne le résultat. */
  drop(): RequestResult;
  /** scored → playing (requête suivante, pioche) ou → ended après la dernière. */
  nextRequest(): void;
  currentRecipe(): Recipe | null;
}

export interface CreateGameOptions {
  data: GameData;
  rules: RulesApi;
  config: GameConfig;
  /** Séquence de recettes du set (défaut : ordre du fichier, tronqué à requestsPerSet). */
  recipeSequence?: Recipe[];
  /** Injectable pour des tests déterministes (défaut : Fisher-Yates Math.random). */
  shuffle?: (ids: string[]) => string[];
}

// ---------------------------------------------------------------------------
// Moteur audio (src/audio) — Tone.js, cf. docs/architecture-technique.md §3.1
// ---------------------------------------------------------------------------

export interface AudioEngineOptions {
  /** Tempo global unique (parti pris MVP). */
  bpm: number;
  /** Longueur des boucles en mesures (les stems générés font 2 mesures). */
  loopMeasures: number;
  /** Point de quantification des remplacements : '1m' (mesure) ou '4n' (beat). */
  quantize: '1m' | '4n';
  /** Durée de la preview au survol, en secondes (GDD section 5 : 1-2 s). */
  previewSeconds: number;
}

export interface AudioEngine {
  /** Charge tous les buffers (à appeler derrière le geste utilisateur — autoplay policy). */
  init(): Promise<void>;
  /** Démarre le transport. Idempotent. */
  start(): Promise<void>;
  /**
   * Fait entendre `cardId` sur `slot` (null = slot vide). Le changement est
   * quantifié ; les 3 autres voies continuent sans interruption.
   */
  setSlot(slot: SlotId, cardId: string | null): void;
  /** Preview courte du stem de la carte pour ce slot (hors mix, non quantifiée). */
  previewCard(cardId: string, slot: SlotId): void;
  stopPreview(): void;
  /** Coupe/rétablit tout l'audio sans perdre l'état des slots. */
  setMuted(muted: boolean): void;
  /**
   * Baisse (true) ou rétablit (false) le volume du mix en douceur — ponctuation
   * sonore de l'écran de score : le mix continue, mais en retrait.
   */
  setDucked(ducked: boolean): void;
  dispose(): void;
}
