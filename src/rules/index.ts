/**
 * Moteur de règles/scoring v2 — « Le Verdict du Public »
 * (docs/audit-game-design.md §5, remplace la Proposition 1 du GDD §4).
 *
 * La logique interne des assemblages est une grammaire de MAINS NOMMÉES,
 * lisible dans le vocabulaire visuel des cartes :
 * - FORMES (Genres) : Paire, Double Paire, Brelan, Carré — la meilleure seule ;
 * - COULEURS (Énergies) : Camaïeu (3 ou 4 identiques), Gradient complet
 *   (les 3 énergies présentes) — cumulables ;
 * - le tout multiplié par le VERDICT : l'envie du public (les conditions de la
 *   recette) est-elle ignorée (×0.5), partiellement (×1) ou totalement (×2)
 *   servie ? total = floor((main + couleurs) × multiplicateur).
 *
 * Pur et sans état : aucune dépendance UI/audio/DOM (architecture §3.2).
 */
import type {
  Card,
  ColorDetail,
  ConditionDetail,
  ConditionFilter,
  Energy,
  Genre,
  HandKind,
  Recipe,
  RecipeCondition,
  RulesApi,
  ScoreBreakdown,
  ScoringConfig,
} from '../types';

/** ET entre les champs du filtre, OU entre les valeurs d'un champ (§3). */
function matchesFilter(card: Card, filter: ConditionFilter): boolean {
  if (filter.genre && !filter.genre.includes(card.genre)) return false;
  if (filter.energy && !filter.energy.includes(card.energy)) return false;
  return true;
}

const HAND_NAMES: Record<Exclude<HandKind, 'none'>, string> = {
  pair: 'Paire',
  two_pair: 'Double paire',
  three_of_a_kind: 'Brelan',
  four_of_a_kind: 'Carré',
};

/** Comptes par valeur, triés décroissants, avec la valeur dominante. */
function tally<T extends string>(values: T[]): { counts: number[]; top: T | null } {
  const map = new Map<T, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  let top: T | null = null;
  let topCount = 0;
  for (const [v, count] of map) {
    if (count > topCount) {
      top = v;
      topCount = count;
    }
  }
  return { counts: [...map.values()].sort((x, y) => y - x), top };
}

/** Main de formes : la meilleure combinaison de Genres présente. */
function detectHand(
  placed: Card[],
  cfg: ScoringConfig,
): { kind: HandKind; label: string; points: number } {
  const { counts, top } = tally(placed.map((c) => c.genre));
  const [first = 0, second = 0] = counts;
  let kind: HandKind = 'none';
  if (first >= 4) kind = 'four_of_a_kind';
  else if (first === 3) kind = 'three_of_a_kind';
  else if (first === 2 && second === 2) kind = 'two_pair';
  else if (first === 2) kind = 'pair';
  if (kind === 'none' || top === null) {
    return { kind: 'none', label: 'Aucune main', points: 0 };
  }
  const label =
    kind === 'two_pair' ? HAND_NAMES[kind] : `${HAND_NAMES[kind]} ${top}`;
  return { kind, label, points: cfg.hands[kind] };
}

/** Bonus de couleurs (Énergies), cumulables. */
function detectColors(placed: Card[], cfg: ScoringConfig): ColorDetail[] {
  const details: ColorDetail[] = [];
  const energies = placed.map((c) => c.energy);
  const { counts, top } = tally(energies);
  const [first = 0] = counts;
  if (first >= 4 && top) {
    details.push({ kind: 'camaieu_4', label: `Camaïeu ${top}`, points: cfg.colors.camaieu_4 });
  } else if (first === 3 && top) {
    details.push({ kind: 'camaieu_3', label: `Camaïeu ${top} (3)`, points: cfg.colors.camaieu_3 });
  }
  const distinct = new Set<Energy>(energies);
  if (distinct.size === 3) {
    details.push({ kind: 'gradient_complet', label: 'Gradient complet', points: cfg.colors.gradient_complet });
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

function evaluate(placed: Card[], recipe: Recipe, cfg: ScoringConfig): ScoreBreakdown {
  const hand = detectHand(placed, cfg);
  const colors = detectColors(placed, cfg);
  const colorPoints = colors.reduce((sum, c) => sum + c.points, 0);
  const base = hand.points + colorPoints;

  const conditions: ConditionDetail[] = recipe.conditions.map((cond, index) => ({
    index,
    label: conditionLabel(cond),
    met: isConditionMet(cond, placed),
  }));
  const conditionsMet = conditions.filter((c) => c.met).length;
  const aversionsViolated = recipe.conditions.filter(
    (cond, i) => cond.type === 'none' && !conditions[i]?.met,
  ).length;

  const multiplier =
    conditionsMet === conditions.length
      ? cfg.verdict_multipliers.all_met
      : conditionsMet > 0
        ? cfg.verdict_multipliers.partially_met
        : cfg.verdict_multipliers.none_met;

  return {
    handKind: hand.kind,
    handLabel: hand.label,
    handPoints: hand.points,
    colors,
    colorPoints,
    base,
    conditions,
    conditionsMet,
    multiplier,
    aversionsViolated,
    total: Math.floor(base * multiplier),
  };
}

export function createRules(): RulesApi {
  return {
    matchesFilter,

    evaluateBoard(placed: Card[], recipe: Recipe, cfg: ScoringConfig): ScoreBreakdown {
      return evaluate(placed, recipe, cfg);
    },

    cardAffinity(a: Card, b: Card): { sameGenre: boolean; sameEnergy: boolean } {
      return { sameGenre: a.genre === b.genre, sameEnergy: a.energy === b.energy };
    },

    theoreticalMax(deck: Card[], recipe: Recipe, cfg: ScoringConfig, boardSize = 4): number {
      const k = Math.max(1, Math.min(boardSize, deck.length));
      // Deck ne dépassant pas la taille du plateau : une seule combinaison, la complète.
      if (deck.length <= k) return evaluate(deck, recipe, cfg).total;
      // Énumération C(n, k) par indices croissants (n ≤ 14, k ≤ 4 : négligeable).
      let max = -Infinity;
      const picked: Card[] = [];
      const walk = (start: number): void => {
        if (picked.length === k) {
          const total = evaluate(picked, recipe, cfg).total;
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
