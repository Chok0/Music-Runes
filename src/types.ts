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
  /**
   * Valeur commerciale du disque (1-3) — points ajoutés au score du set au
   * drop (RequestResult.discPoints). N'entre PAS dans le calcul d'étoiles :
   * étoiles = qualité artistique (tags/recette), valeur = cash. Le dilemme
   * « gros disque qui casse ma cohérence » vit dans cet écart.
   */
  value: number;
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

/**
 * Scoring v2 « Le Verdict du Public » (docs/audit-game-design.md §5) :
 * mains nommées façon poker sur les axes visibles (Formes = Genres,
 * Couleurs = Énergies), multipliées par la satisfaction de l'envie du public.
 */
export interface ScoringConfig {
  schema_version: number;
  model: string;
  model_status: string;
  hands: {
    comment?: string;
    pair: number;
    two_pair: number;
    three_of_a_kind: number;
    four_of_a_kind: number;
  };
  colors: {
    comment?: string;
    camaieu_4: number;
    camaieu_3: number;
    gradient_complet: number;
  };
  verdict_multipliers: {
    comment?: string;
    none_met: number;
    partially_met: number;
    all_met: number;
  };
  star_thresholds: { stars: number; min_ratio_of_theoretical_max: number }[];
}

/** Une requête d'une scène : sa recette et les slots actifs (progressivité). */
export interface SceneRequest {
  recipe: string;
  slots: SlotId[];
  /**
   * Envie SECRÈTE (mastermind, tout-ou-rien — décision playtest #4) : la
   * recette n'est pas affichée, le joueur la devine aux réactions du public.
   */
  secret?: boolean;
}

/** Boutique de fin de scène : choisir 1 carte parmi les 3 premières offres non possédées. */
export interface SceneShop {
  intro: string;
  price: number;
  /** Ids candidats, dans l'ordre — peut en lister plus de 3 (repli si déjà possédées). */
  offers: string[];
}

/** Une scène de la tournée (data/scenes.json — cf. docs/playtest-2026-08-14.md §3). */
export interface Scene {
  id: string;
  name: string;
  flavor: string;
  /** Jauge d'attention du public au départ (défaut : config). Vide = concert raté. */
  attention?: number;
  /** Cartes offertes au début de la scène (le deck de départ pour la scène 1). */
  grants_on_start: string[];
  /** Carte offerte à la fin de la scène (récompense narrative), optionnelle. */
  grant_on_end?: string;
  grant_on_end_flavor?: string;
  /** Revenu fixe du concert — garantit que la boutique reste toujours abordable. */
  cachet: number;
  requests: SceneRequest[];
  /** Absente sur la dernière scène. */
  shop?: SceneShop;
}

/** Données du jeu chargées et validées (module src/data). */
export interface GameData {
  cards: Card[];
  recipes: Recipe[];
  scoring: ScoringConfig;
  scenes: Scene[];
  cardById: Map<string, Card>;
  recipeById: Map<string, Recipe>;
}

// ---------------------------------------------------------------------------
// Moteur de règles (src/rules) — pur, sans dépendance UI/audio/DOM
// ---------------------------------------------------------------------------

/** Main de formes (Genres) détectée sur le plateau — la meilleure seule compte. */
export type HandKind = 'none' | 'pair' | 'two_pair' | 'three_of_a_kind' | 'four_of_a_kind';

/** Bonus de couleurs (Énergies), cumulables. */
export interface ColorDetail {
  kind: 'camaieu_4' | 'camaieu_3' | 'gradient_complet';
  label: string;
  points: number;
}

export interface ConditionDetail {
  index: number;
  label: string;
  met: boolean;
}

export interface ScoreBreakdown {
  /** Main de formes : nature, libellé annonçable (« BRELAN TECHNO ! ») et points. */
  handKind: HandKind;
  handLabel: string;
  handPoints: number;
  colors: ColorDetail[];
  colorPoints: number;
  /** Base = main + couleurs, avant le verdict du public. */
  base: number;
  conditions: ConditionDetail[];
  conditionsMet: number;
  /** Multiplicateur du verdict (aucune/partielle/toutes conditions remplies). */
  multiplier: number;
  /** Nombre de conditions d'aversion (type none) violées — pilote la dissonance visuelle. */
  aversionsViolated: number;
  /** floor(base × multiplier). */
  total: number;
}

/** Affinités visibles d'une paire de cartes (liens du plateau). */
export interface CardAffinity {
  sameGenre: boolean;
  sameEnergy: boolean;
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
  /** Affinités visibles d'une paire (liens du plateau : même forme / même couleur). */
  cardAffinity(a: Card, b: Card): CardAffinity;
  /**
   * Score max théorique de la recette par énumération exhaustive des
   * C(n, boardSize) combinaisons du deck (modele-de-donnees §4). `boardSize`
   * (défaut 4) = nombre de slots actifs de la requête : une requête
   * tutorielle à 2 slots est notée sur le meilleur plateau de 2 cartes.
   */
  theoreticalMax(deck: Card[], recipe: Recipe, cfg: ScoringConfig, boardSize?: number): number;
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
  startingHandSize: number;
  drawPerRequest: number;
  /** Échanges de main (défausse + repioche) autorisés par SET. */
  mulligansPerSet: number;
  /** Jauge d'attention de départ si la scène n'en précise pas. */
  attentionMax: number;
  /** Drain d'attention par mesure écoulée en phase playing. */
  attentionDrainPerMeasure: number;
  /** Drain d'attention par condition non remplie au drop. */
  attentionUnmetConditionPenalty: number;
  /** Regain d'attention quand TOUTES les conditions du drop sont remplies. */
  attentionAllMetBonus: number;
}

/** Sauvegarde de tournée (localStorage) — cf. docs/playtest-2026-08-14.md §3. */
export interface TourSave {
  version: number;
  /** Index de la prochaine scène à jouer (scenes.length = tournée terminée). */
  sceneIndex: number;
  /** Points cumulés (cachets + scores), dépensables à la boutique. */
  wallet: number;
  /** Collection du joueur (ids de cartes). */
  ownedCardIds: string[];
}

/** `failed` : la jauge d'attention est tombée à zéro — concert raté. */
export type GamePhase = 'title' | 'playing' | 'scored' | 'ended' | 'failed';

export interface RequestResult {
  recipeId: string;
  breakdown: ScoreBreakdown;
  /** Valeur commerciale des disques posés — s'ajoute au score du set, pas aux étoiles. */
  discPoints: number;
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
  /** Slots jouables pour la requête courante (progressivité tutorielle). */
  activeSlots: SlotId[];
  /** Disques détruits ce set (remplacés sur platine ou défaussés) — perdus jusqu'à la fin du set. */
  destroyed: string[];
  /** Échanges de main restants (défausse + repioche). */
  mulligansLeft: number;
  /** Jauge d'attention du public (0 = concert raté, phase failed). */
  attention: number;
  attentionMax: number;
  results: RequestResult[];
  setScore: number;
}

export interface GameStore {
  getState(): GameState;
  subscribe(listener: (state: GameState) => void): () => void;
  /** title → playing : mélange le deck, pioche la main de départ. */
  startSet(): void;
  /**
   * Pose `cardId` sur `slot`. Depuis la MAIN sur un slot occupé : la carte
   * en place est DÉTRUITE pour le set (remplacement destructeur — le coût qui
   * remplace la limite de remplacements du GDD §11). Entre deux slots :
   * échange libre (réagencement gratuit). No-op si la phase ≠ playing.
   */
  place(cardId: string, slot: SlotId): void;
  /**
   * Échange de main : détruit `cardId` (main uniquement) et pioche 1 disque
   * si le deck n'est pas vide. Consomme 1 mulligan. No-op sans mulligan
   * restant ou hors phase playing.
   */
  discard(cardId: string): void;
  /**
   * true si détruire un disque de plus rendrait une requête restante
   * impossible à remplir — les remplacements destructeurs sont alors refusés
   * (garde anti-soft-lock ; l'UI s'en sert pour expliquer le refus).
   */
  destructionLocked(): boolean;
  /**
   * Drain d'attention (appelé par l'horloge de l'app, une fois par mesure).
   * SILENCIEUX (pas de notification) sauf passage à zéro → phase failed +
   * notification. Retourne l'attention restante.
   */
  tickAttention(amount?: number): number;
  /** true si les 4 slots sont remplis et la phase est playing. */
  canDrop(): boolean;
  /** Score la requête courante (phase → scored, ou failed si le public part). */
  drop(): RequestResult;
  /** scored → playing (requête suivante, pioche) ou → ended après la dernière. */
  nextRequest(): void;
  currentRecipe(): Recipe | null;
}

/** Une étape du plan de set : recette + slots actifs (+ envie secrète). */
export interface RequestPlan {
  recipe: Recipe;
  slots: readonly SlotId[];
  secret?: boolean;
}

export interface CreateGameOptions {
  data: GameData;
  rules: RulesApi;
  config: GameConfig;
  /**
   * Plan du set : recettes + slots actifs par requête (construit depuis une
   * scène). Défaut : toutes les recettes du fichier, 4 slots actifs.
   */
  plan?: RequestPlan[];
  /** Deck du joueur pour ce set (défaut : toutes les cartes) — base du max théorique. */
  deckIds?: readonly string[];
  /** Jauge d'attention de départ (défaut : config.attentionMax). */
  attentionMax?: number;
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
  /** Vide tous les slots (fin de scène) sans détruire le moteur : la tournée continue. */
  clearAllSlots(): void;
  /** Réaction sonore du public à une pose (no-op si neutre ou SFX indisponible). */
  playPoseFeedback(kind: 'good' | 'bad' | 'meh' | 'neutral'): void;
  /** Applaudissements de fin de scène (one-shot, no-op si le SFX est indisponible). */
  playApplause(): void;
  dispose(): void;
}
