/**
 * Chargement + validation des données de jeu (roadmap M0 : « erreurs
 * explicites si les données sont invalides »).
 *
 * Les JSON sont importés statiquement (bundlés par Vite) : le contenu du jeu
 * vit dans data/*.json, jamais en dur dans le code (architecture §3.5).
 */
import cardsJson from '../../data/cards.json';
import recipesJson from '../../data/recipes.json';
import scoringJson from '../../data/scoring.json';
import {
  ENERGIES,
  GENRES,
  SLOT_IDS,
  type Card,
  type GameData,
  type Recipe,
  type RecipeCondition,
  type ScoringConfig,
} from '../types';

class DataError extends Error {
  constructor(file: string, message: string) {
    super(`Données invalides (${file}) : ${message}`);
    this.name = 'DataError';
  }
}

function validateCard(raw: unknown, index: number): Card {
  const c = raw as Card;
  const where = `carte #${index + 1}${c && typeof c === 'object' && 'id' in c ? ` (${String(c.id)})` : ''}`;
  if (!c || typeof c !== 'object') throw new DataError('cards.json', `${where} : objet attendu`);
  if (typeof c.id !== 'string' || c.id.length === 0)
    throw new DataError('cards.json', `${where} : id manquant`);
  if (typeof c.name !== 'string' || c.name.length === 0)
    throw new DataError('cards.json', `${where} : name manquant`);
  if (!GENRES.includes(c.genre))
    throw new DataError('cards.json', `${where} : genre inconnu « ${String(c.genre)} »`);
  if (!ENERGIES.includes(c.energy))
    throw new DataError('cards.json', `${where} : énergie inconnue « ${String(c.energy)} »`);
  if (!c.slots || typeof c.slots !== 'object')
    throw new DataError('cards.json', `${where} : slots manquants`);
  for (const slot of SLOT_IDS) {
    const v = c.slots[slot];
    if (!v || typeof v.description !== 'string' || typeof v.stem !== 'string')
      throw new DataError('cards.json', `${where} : slot « ${slot} » incomplet (description + stem requis)`);
  }
  return c;
}

function validateFilter(raw: unknown, where: string): void {
  const filter = raw as { genre?: unknown; energy?: unknown };
  if (!filter || typeof filter !== 'object')
    throw new DataError('recipes.json', `${where} : filter requis`);
  if (filter.genre === undefined && filter.energy === undefined)
    throw new DataError('recipes.json', `${where} : filter vide (au moins genre ou energy requis)`);
  if (filter.genre !== undefined) {
    if (!Array.isArray(filter.genre) || filter.genre.length === 0)
      throw new DataError('recipes.json', `${where} : filter.genre doit être une liste non vide`);
    for (const g of filter.genre)
      if (!GENRES.includes(g))
        throw new DataError('recipes.json', `${where} : genre inconnu « ${String(g)} » dans le filtre`);
  }
  if (filter.energy !== undefined) {
    if (!Array.isArray(filter.energy) || filter.energy.length === 0)
      throw new DataError('recipes.json', `${where} : filter.energy doit être une liste non vide`);
    for (const e of filter.energy)
      if (!ENERGIES.includes(e))
        throw new DataError('recipes.json', `${where} : énergie inconnue « ${String(e)} » dans le filtre`);
  }
}

function validateCondition(raw: unknown, recipeId: string, index: number): RecipeCondition {
  const cond = raw as RecipeCondition;
  const where = `recette « ${recipeId} », condition #${index + 1}`;
  if (!cond || typeof cond !== 'object') throw new DataError('recipes.json', `${where} : objet attendu`);
  switch (cond.type) {
    case 'min_count':
      if (!Number.isInteger(cond.count) || cond.count < 1)
        throw new DataError('recipes.json', `${where} : count entier ≥ 1 requis`);
      validateFilter(cond.filter, where);
      return cond;
    case 'none':
      validateFilter(cond.filter, where);
      return cond;
    case 'all_same_genre':
    case 'all_different_genres':
      return cond;
    default:
      throw new DataError('recipes.json', `${where} : type inconnu « ${String((cond as { type?: unknown }).type)} »`);
  }
}

function validateRecipe(raw: unknown, index: number): Recipe {
  const r = raw as Recipe;
  const where = `recette #${index + 1}${r && typeof r === 'object' && 'id' in r ? ` (${String(r.id)})` : ''}`;
  if (!r || typeof r !== 'object') throw new DataError('recipes.json', `${where} : objet attendu`);
  if (typeof r.id !== 'string' || r.id.length === 0)
    throw new DataError('recipes.json', `${where} : id manquant`);
  if (typeof r.name !== 'string' || r.name.length === 0)
    throw new DataError('recipes.json', `${where} : name manquant`);
  if (!Array.isArray(r.conditions) || r.conditions.length === 0)
    throw new DataError('recipes.json', `${where} : au moins une condition requise`);
  r.conditions.forEach((c, i) => validateCondition(c, r.id, i));
  return r;
}

function validateScoring(raw: unknown): ScoringConfig {
  const s = raw as ScoringConfig;
  if (!s || typeof s !== 'object') throw new DataError('scoring.json', 'objet attendu');
  const nums: [string, unknown][] = [
    ['coherence.same_genre_pair_bonus', s.coherence?.same_genre_pair_bonus],
    ['coherence.same_energy_pair_bonus', s.coherence?.same_energy_pair_bonus],
    ['coherence.contrast_pair_bonus', s.coherence?.contrast_pair_bonus],
    ['coherence.unrequested_genre_conflict_pair_penalty', s.coherence?.unrequested_genre_conflict_pair_penalty],
    ['objective.per_condition_met_bonus', s.objective?.per_condition_met_bonus],
    ['audacious_resolution.flat_bonus', s.audacious_resolution?.flat_bonus],
  ];
  for (const [path, v] of nums) {
    if (typeof v !== 'number') throw new DataError('scoring.json', `${path} : nombre requis`);
  }
  if (!Array.isArray(s.star_thresholds) || s.star_thresholds.length === 0)
    throw new DataError('scoring.json', 'star_thresholds : liste non vide requise');
  for (const t of s.star_thresholds) {
    if (!t || !Number.isInteger(t.stars) || t.stars < 0 || typeof t.min_ratio_of_theoretical_max !== 'number')
      throw new DataError(
        'scoring.json',
        `star_thresholds : entrée invalide « ${JSON.stringify(t)} » (stars entier ≥ 0 et min_ratio_of_theoretical_max nombre requis)`
      );
  }
  if (!s.genre_conflicts || !Array.isArray(s.genre_conflicts.pairs))
    throw new DataError('scoring.json', 'genre_conflicts.pairs : liste requise');
  for (const pair of s.genre_conflicts.pairs) {
    if (!Array.isArray(pair) || pair.length !== 2 || !GENRES.includes(pair[0]) || !GENRES.includes(pair[1]))
      throw new DataError('scoring.json', `genre_conflicts : paire invalide « ${JSON.stringify(pair)} »`);
  }
  return s;
}

/** Charge et valide les trois fichiers de données. Jette une DataError explicite sinon. */
export function loadGameData(): GameData {
  const rawCards = (cardsJson as { cards?: unknown[] }).cards;
  if (!Array.isArray(rawCards)) throw new DataError('cards.json', 'clé « cards » (liste) attendue');
  const cards = rawCards.map(validateCard);
  if (cards.length < SLOT_IDS.length)
    throw new DataError('cards.json', `au moins ${SLOT_IDS.length} cartes requises pour remplir le plateau (${cards.length} trouvées)`);

  const rawRecipes = (recipesJson as { recipes?: unknown[] }).recipes;
  if (!Array.isArray(rawRecipes)) throw new DataError('recipes.json', 'clé « recipes » (liste) attendue');
  const recipes = rawRecipes.map(validateRecipe);
  if (recipes.length === 0) throw new DataError('recipes.json', 'au moins une recette requise');

  const scoring = validateScoring(scoringJson);

  const cardById = new Map(cards.map((c) => [c.id, c]));
  if (cardById.size !== cards.length) throw new DataError('cards.json', 'ids de cartes non uniques');
  const recipeById = new Map(recipes.map((r) => [r.id, r]));
  if (recipeById.size !== recipes.length) throw new DataError('recipes.json', 'ids de recettes non uniques');

  return { cards, recipes, scoring, cardById, recipeById };
}
