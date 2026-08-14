/**
 * Moteur de règles/scoring — Proposition 1 paramétrée.
 *
 * Spécification : docs/modele-de-donnees.md §3 (conditions/filtres) et §4
 * (scoring, conflits de Genre, règle « demandée par la recette »).
 * Pur et sans état : aucune dépendance UI/audio/DOM (architecture §3.2).
 */
import type {
  Card,
  ConditionDetail,
  ConditionFilter,
  Genre,
  PairDetail,
  Recipe,
  RecipeCondition,
  RulesApi,
  ScoreBreakdown,
  ScoringConfig,
} from '../types';

type MinCountCondition = Extract<RecipeCondition, { type: 'min_count' }>;

/** ET entre les champs du filtre, OU entre les valeurs d'un champ (§3). */
function matchesFilter(card: Card, filter: ConditionFilter): boolean {
  if (filter.genre && !filter.genre.includes(card.genre)) return false;
  if (filter.energy && !filter.energy.includes(card.energy)) return false;
  return true;
}

/** Clé canonique d'une paire de Genres (la matrice est symétrique). */
function conflictKey(a: Genre, b: Genre): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function buildConflictSet(cfg: ScoringConfig): Set<string> {
  const set = new Set<string>();
  for (const pair of cfg.genre_conflicts.pairs) set.add(conflictKey(pair[0], pair[1]));
  return set;
}

/**
 * Règle « demandée par la recette » (§4) : une paire en conflit de Genre est
 * demandée s'il existe deux conditions min_count DIFFÉRENTES A et B, à filtre
 * de genre défini, telles que c1 matche A et c2 matche B (les deux
 * permutations sont testées par la double boucle). Matcher un filtre dont
 * `genre` est défini implique card.genre ∈ filter.genre.
 */
function isRequestedConflict(c1: Card, c2: Card, recipe: Recipe): boolean {
  const genreMinCounts = recipe.conditions.filter(
    (c): c is MinCountCondition => c.type === 'min_count' && c.filter.genre !== undefined,
  );
  for (const condA of genreMinCounts) {
    for (const condB of genreMinCounts) {
      if (condA === condB) continue;
      if (matchesFilter(c1, condA.filter) && matchesFilter(c2, condB.filter)) return true;
    }
  }
  return false;
}

/** Détails d'une seule paire — logique partagée par pairDetails et evaluateBoard. */
function computePairDetails(
  a: Card,
  b: Card,
  recipe: Recipe,
  cfg: ScoringConfig,
  conflicts: Set<string>,
): PairDetail[] {
  const details: PairDetail[] = [];
  if (a.genre === b.genre) {
    details.push({ a: a.id, b: b.id, kind: 'same_genre', points: cfg.coherence.same_genre_pair_bonus });
  }
  if (a.energy === b.energy) {
    details.push({ a: a.id, b: b.id, kind: 'same_energy', points: cfg.coherence.same_energy_pair_bonus });
  }
  const isContrast =
    (a.energy === 'Calme' && b.energy === 'Intense') || (a.energy === 'Intense' && b.energy === 'Calme');
  // contrast_pair_bonus à 0 = Proposition 1 stricte : le détail n'est pas émis.
  if (isContrast && cfg.coherence.contrast_pair_bonus !== 0) {
    details.push({ a: a.id, b: b.id, kind: 'contrast', points: cfg.coherence.contrast_pair_bonus });
  }
  if (a.genre !== b.genre && conflicts.has(conflictKey(a.genre, b.genre))) {
    if (isRequestedConflict(a, b, recipe)) {
      // Conflit demandé par la recette : exempté de pénalité (points 0).
      details.push({ a: a.id, b: b.id, kind: 'requested_conflict', points: 0 });
    } else {
      details.push({
        a: a.id,
        b: b.id,
        kind: 'conflict',
        points: cfg.coherence.unrequested_genre_conflict_pair_penalty,
      });
    }
  }
  return details;
}

function isConditionMet(cond: RecipeCondition, placed: Card[]): boolean {
  switch (cond.type) {
    case 'min_count':
      return placed.filter((c) => matchesFilter(c, cond.filter)).length >= cond.count;
    case 'none':
      return placed.every((c) => !matchesFilter(c, cond.filter));
    case 'all_same_genre':
      // Exige exactement 4 cartes présentes (§3) — non remplie sur plateau partiel.
      return placed.length === 4 && placed.every((c) => c.genre === placed[0]?.genre);
    case 'all_different_genres':
      return placed.length === 4 && new Set(placed.map((c) => c.genre)).size === 4;
  }
}

/**
 * Descripteur français d'un filtre. Valeurs d'un champ jointes par « ou » ;
 * quand genre et énergie sont présents, virgule si l'un des deux est un OU
 * multiple (« Jazz ou Ambient, Calme »), simple espace sinon (« Pop Intense »).
 */
function filterLabel(filter: ConditionFilter): string {
  const genre = filter.genre?.join(' ou ') ?? '';
  const energy = filter.energy?.join(' ou ') ?? '';
  if (genre && energy) {
    const multi = (filter.genre?.length ?? 0) > 1 || (filter.energy?.length ?? 0) > 1;
    return multi ? `${genre}, ${energy}` : `${genre} ${energy}`;
  }
  return genre || energy;
}

function conditionLabel(cond: RecipeCondition): string {
  switch (cond.type) {
    case 'min_count': {
      const desc = filterLabel(cond.filter);
      const noun = cond.count > 1 ? 'cartes' : 'carte';
      return `Au moins ${cond.count} ${noun}${desc ? ` ${desc}` : ''}`;
    }
    case 'none': {
      const desc = filterLabel(cond.filter);
      return `Aucune carte${desc ? ` ${desc}` : ''}`;
    }
    case 'all_same_genre':
      return 'Les 4 cartes du même Genre';
    case 'all_different_genres':
      return 'Les 4 cartes de 4 Genres différents';
  }
}

/** Évaluation complète, avec le set de conflits pré-construit (réutilisé par theoreticalMax). */
function evaluate(
  placed: Card[],
  recipe: Recipe,
  cfg: ScoringConfig,
  conflicts: Set<string>,
): ScoreBreakdown {
  const pairs: PairDetail[] = [];
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i];
    if (!a) continue;
    for (let j = i + 1; j < placed.length; j++) {
      const b = placed[j];
      if (!b) continue;
      pairs.push(...computePairDetails(a, b, recipe, cfg, conflicts));
    }
  }
  const coherence = pairs.reduce((sum, p) => sum + p.points, 0);

  const conditions: ConditionDetail[] = recipe.conditions.map((cond, index) => {
    const met = isConditionMet(cond, placed);
    return {
      index,
      label: conditionLabel(cond),
      met,
      points: met ? cfg.objective.per_condition_met_bonus : 0,
    };
  });
  const objective = conditions.reduce((sum, c) => sum + c.points, 0);

  // Bonus audacieux : accordé UNE SEULE fois par drop, dès qu'au moins une
  // paire en conflit demandé est posée.
  const audaciousApplied = pairs.some((p) => p.kind === 'requested_conflict');
  const audacious = audaciousApplied ? cfg.audacious_resolution.flat_bonus : 0;

  return {
    pairs,
    conditions,
    coherence,
    objective,
    audacious,
    audaciousApplied,
    total: coherence + objective + audacious,
  };
}

export function createRules(): RulesApi {
  return {
    matchesFilter,

    evaluateBoard(placed: Card[], recipe: Recipe, cfg: ScoringConfig): ScoreBreakdown {
      return evaluate(placed, recipe, cfg, buildConflictSet(cfg));
    },

    pairDetails(a: Card, b: Card, recipe: Recipe, cfg: ScoringConfig): PairDetail[] {
      return computePairDetails(a, b, recipe, cfg, buildConflictSet(cfg));
    },

    theoreticalMax(deck: Card[], recipe: Recipe, cfg: ScoringConfig, boardSize = 4): number {
      const conflicts = buildConflictSet(cfg);
      const k = Math.max(1, Math.min(boardSize, deck.length));
      // Deck ne dépassant pas la taille du plateau : une seule combinaison, la complète.
      if (deck.length <= k) return evaluate(deck, recipe, cfg, conflicts).total;
      // Énumération C(n, k) par indices croissants (n ≤ 12, k ≤ 4 : négligeable).
      let max = -Infinity;
      const picked: Card[] = [];
      const walk = (start: number): void => {
        if (picked.length === k) {
          const total = evaluate(picked, recipe, cfg, conflicts).total;
          if (total > max) max = total;
          return;
        }
        // Borne : il doit rester assez de cartes pour compléter la combinaison.
        for (let i = start; i <= deck.length - (k - picked.length); i++) {
          const card = deck[i];
          if (!card) continue;
          picked.push(card);
          walk(i + 1);
          picked.pop();
        }
      };
      walk(0);
      return max;
    },

    starsFor(total: number, theoreticalMax: number, cfg: ScoringConfig): number {
      // Max ≤ 0 : pas de ratio calculable — tout total positif ou nul vaut le
      // meilleur palier, tout total négatif n'en atteint aucun.
      const ratio = theoreticalMax > 0 ? total / theoreticalMax : total >= 0 ? 1 : 0;
      const byRatioDesc = [...cfg.star_thresholds].sort(
        (t1, t2) => t2.min_ratio_of_theoretical_max - t1.min_ratio_of_theoretical_max,
      );
      for (const threshold of byRatioDesc) {
        if (ratio >= threshold.min_ratio_of_theoretical_max) return threshold.stars;
      }
      return 0;
    },

    conditionLabel,
  };
}
