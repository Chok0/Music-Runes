/**
 * Tests de la machine à états du set. Découplés du module rules (écrit en
 * parallèle) : un faux RulesApi injecté suffit, seule la mécanique d'état
 * est testée ici. Shuffle identité pour le déterminisme.
 */
import { describe, expect, it } from 'vitest';
import { loadGameData } from '../data/load';
import { createGame } from './game';
import {
  SLOT_IDS,
  type GameConfig,
  type GameStore,
  type Recipe,
  type RulesApi,
  type ScoreBreakdown,
} from '../types';

const data = loadGameData();

const TEST_CONFIG: GameConfig = { requestsPerSet: 6, startingHandSize: 6, drawPerRequest: 2 };

/** Shuffle identité : la pioche suit l'ordre de cards.json. */
const identity = (ids: string[]): string[] => ids;

/** Faux moteur de règles : 4 cartes posées → total 20, max théorique 40 → 2★. */
function makeFakeRules(): { rules: RulesApi; theoreticalMaxCalls: string[] } {
  const theoreticalMaxCalls: string[] = [];
  const rules: RulesApi = {
    matchesFilter: () => true,
    evaluateBoard: (placed): ScoreBreakdown => ({
      pairs: [],
      conditions: [],
      coherence: 0,
      objective: placed.length * 5,
      audacious: 0,
      audaciousApplied: false,
      total: placed.length * 5,
    }),
    pairDetails: () => [],
    theoreticalMax: (_deck, recipe) => {
      theoreticalMaxCalls.push(recipe.id);
      return 40;
    },
    starsFor: (total, max) => (max > 0 && total / max >= 0.5 ? 2 : 0),
    conditionLabel: () => '',
  };
  return { rules, theoreticalMaxCalls };
}

function newGame(
  config: GameConfig = TEST_CONFIG,
  recipeSequence?: Recipe[],
): { game: GameStore; theoreticalMaxCalls: string[] } {
  const { rules, theoreticalMaxCalls } = makeFakeRules();
  const game = createGame({ data, rules, config, shuffle: identity, ...(recipeSequence ? { recipeSequence } : {}) });
  return { game, theoreticalMaxCalls };
}

function recipeAt(i: number): Recipe {
  const r = data.recipes[i];
  if (!r) throw new Error(`recette #${i} absente des données`);
  return r;
}

function cardIdAt(i: number): string {
  const c = data.cards[i];
  if (!c) throw new Error(`carte #${i} absente des données`);
  return c.id;
}

/** Pose les 4 premières cartes de la main sur les 4 slots. */
function fillBoard(game: GameStore): void {
  const hand = game.getState().hand;
  SLOT_IDS.forEach((slot, i) => {
    const id = hand[i];
    if (id === undefined) throw new Error('main trop petite pour remplir le plateau');
    game.place(id, slot);
  });
}

describe('createGame — état initial et startSet', () => {
  it('démarre en phase title avec deck complet, main et plateau vides', () => {
    const { game } = newGame();
    const s = game.getState();
    expect(s.phase).toBe('title');
    expect(s.deck).toEqual(data.cards.map((c) => c.id));
    expect(s.hand).toEqual([]);
    expect(s.board).toEqual({ rythme: null, basse: null, harmonie: null, lead: null });
    expect(s.requestIndex).toBe(0);
    expect(s.results).toEqual([]);
    expect(s.setScore).toBe(0);
    expect(game.currentRecipe()).toBeNull();
  });

  it('startSet : title → playing, main de 6, deck 6 restants (shuffle identité)', () => {
    const { game } = newGame();
    game.startSet();
    const s = game.getState();
    expect(s.phase).toBe('playing');
    expect(s.hand).toEqual(data.cards.slice(0, 6).map((c) => c.id));
    expect(s.deck).toEqual(data.cards.slice(6).map((c) => c.id));
    expect(game.currentRecipe()?.id).toBe(recipeAt(0).id);
  });

  it('startSet est un no-op hors phase title', () => {
    const { game } = newGame();
    game.startSet();
    const before = game.getState();
    game.startSet();
    expect(game.getState()).toEqual(before);
  });
});

describe('place / removeFromSlot', () => {
  it('pose une carte depuis la main', () => {
    const { game } = newGame();
    game.startSet();
    const id = cardIdAt(0);
    game.place(id, 'rythme');
    const s = game.getState();
    expect(s.board.rythme).toBe(id);
    expect(s.hand).not.toContain(id);
    expect(s.hand).toHaveLength(5);
  });

  it('remplacement : la carte en place retourne en main, tailles cohérentes', () => {
    const { game } = newGame();
    game.startSet();
    const first = cardIdAt(0);
    const second = cardIdAt(1);
    game.place(first, 'rythme');
    game.place(second, 'rythme');
    const s = game.getState();
    expect(s.board.rythme).toBe(second);
    expect(s.hand).toContain(first); // la remplacée revient en main
    expect(s.hand).not.toContain(second);
    expect(s.hand).toHaveLength(5); // −1 posée, +1 rendue
  });

  it('échange slot↔slot quand la cible est occupée', () => {
    const { game } = newGame();
    game.startSet();
    const a = cardIdAt(0);
    const b = cardIdAt(1);
    game.place(a, 'rythme');
    game.place(b, 'basse');
    game.place(a, 'basse');
    const s = game.getState();
    expect(s.board.basse).toBe(a);
    expect(s.board.rythme).toBe(b); // échangées
    expect(s.hand).toHaveLength(4); // la main ne bouge pas
  });

  it('déplacement slot → slot vide : le slot source se vide', () => {
    const { game } = newGame();
    game.startSet();
    const a = cardIdAt(0);
    game.place(a, 'rythme');
    game.place(a, 'lead');
    const s = game.getState();
    expect(s.board.lead).toBe(a);
    expect(s.board.rythme).toBeNull();
  });

  it('no-op : carte inconnue, carte déjà sur le slot, phase title', () => {
    const { game } = newGame();
    game.place(cardIdAt(0), 'rythme'); // phase title
    expect(game.getState().board.rythme).toBeNull();
    game.startSet();
    const before1 = game.getState();
    game.place('carte-qui-n-existe-pas', 'rythme');
    expect(game.getState()).toEqual(before1);
    const a = cardIdAt(0);
    game.place(a, 'rythme');
    const before2 = game.getState();
    game.place(a, 'rythme'); // déjà sur ce slot
    expect(game.getState()).toEqual(before2);
  });

  it('removeFromSlot renvoie la carte en main (no-op sur slot vide)', () => {
    const { game } = newGame();
    game.startSet();
    const a = cardIdAt(0);
    game.place(a, 'harmonie');
    game.removeFromSlot('harmonie');
    const s = game.getState();
    expect(s.board.harmonie).toBeNull();
    expect(s.hand).toContain(a);
    expect(s.hand).toHaveLength(6);
    const before = game.getState();
    game.removeFromSlot('harmonie'); // déjà vide
    expect(game.getState()).toEqual(before);
  });
});

describe('canDrop / drop', () => {
  it('canDrop est faux à 3 cartes, vrai à 4', () => {
    const { game } = newGame();
    game.startSet();
    const hand = game.getState().hand;
    game.place(hand[0] ?? '', 'rythme');
    game.place(hand[1] ?? '', 'basse');
    game.place(hand[2] ?? '', 'harmonie');
    expect(game.canDrop()).toBe(false);
    game.place(hand[3] ?? '', 'lead');
    expect(game.canDrop()).toBe(true);
  });

  it('drop : phase scored, résultat stocké, setScore cumulé', () => {
    const { game } = newGame();
    game.startSet();
    fillBoard(game);
    const result = game.drop();
    expect(result.recipeId).toBe(recipeAt(0).id);
    expect(result.breakdown.total).toBe(20); // faux rules : 4 cartes × 5
    expect(result.theoreticalMax).toBe(40);
    expect(result.stars).toBe(2); // 20/40 = 0.5
    const s = game.getState();
    expect(s.phase).toBe('scored');
    expect(s.results).toHaveLength(1);
    expect(s.results[0]?.recipeId).toBe(recipeAt(0).id);
    expect(s.setScore).toBe(20);
  });

  it('drop jette une Error si les conditions ne sont pas réunies', () => {
    const { game } = newGame();
    expect(() => game.drop()).toThrow(Error); // phase title
    game.startSet();
    game.place(cardIdAt(0), 'rythme');
    expect(() => game.drop()).toThrow(/4 slots/); // 1 carte seulement
    fillBoard(game);
    game.drop();
    expect(() => game.drop()).toThrow(Error); // phase scored
  });

  it('le max théorique est mis en cache par recette (une seule énumération)', () => {
    const r0 = recipeAt(0);
    const { game, theoreticalMaxCalls } = newGame(TEST_CONFIG, [r0, r0]);
    game.startSet();
    fillBoard(game);
    game.drop();
    game.nextRequest();
    game.drop(); // même recette, plateau conservé
    expect(game.getState().results).toHaveLength(2);
    expect(theoreticalMaxCalls).toEqual([r0.id]); // un seul calcul
  });
});

describe('nextRequest — plateau persistant, pioche, fin de set', () => {
  it('nextRequest : pioche 2, plateau conservé, requête suivante', () => {
    const { game } = newGame();
    game.startSet();
    fillBoard(game);
    const boardBefore = game.getState().board;
    game.drop();
    game.nextRequest();
    const s = game.getState();
    expect(s.phase).toBe('playing');
    expect(s.requestIndex).toBe(1);
    expect(s.board).toEqual(boardBefore); // plateau persistant (GDD §11)
    expect(s.hand).toHaveLength(4); // 6 − 4 posées + 2 piochées
    expect(s.deck).toHaveLength(4);
    expect(game.currentRecipe()?.id).toBe(recipeAt(1).id);
  });

  it('nextRequest est un no-op hors phase scored', () => {
    const { game } = newGame();
    game.startSet();
    const before = game.getState();
    game.nextRequest();
    expect(game.getState()).toEqual(before);
  });

  it('deck épuisé : pioches partielles puis nulles, sans erreur', () => {
    // Main de départ 11 → deck 1 : la première pioche est partielle (1), les suivantes nulles.
    const config: GameConfig = { requestsPerSet: 3, startingHandSize: 11, drawPerRequest: 2 };
    const { game } = newGame(config);
    game.startSet();
    expect(game.getState().deck).toHaveLength(1);
    fillBoard(game);
    game.drop();
    game.nextRequest();
    expect(game.getState().hand).toHaveLength(8); // 11 − 4 + 1 (pioche partielle)
    expect(game.getState().deck).toHaveLength(0);
    game.drop();
    game.nextRequest();
    expect(game.getState().hand).toHaveLength(8); // pioche nulle, pas d'erreur
    game.drop();
    game.nextRequest();
    expect(game.getState().phase).toBe('ended');
  });

  it('set complet de 6 requêtes : fin en ended, currentRecipe null, score cumulé', () => {
    const { game } = newGame();
    game.startSet();
    fillBoard(game);
    for (let i = 0; i < TEST_CONFIG.requestsPerSet; i++) {
      expect(game.currentRecipe()?.id).toBe(recipeAt(i).id);
      game.drop();
      game.nextRequest();
    }
    const s = game.getState();
    expect(s.phase).toBe('ended');
    expect(game.currentRecipe()).toBeNull();
    expect(s.results).toHaveLength(6);
    expect(s.setScore).toBe(120); // 6 × 20
    expect(s.deck).toHaveLength(0); // 6 − 3 pioches de 2
    // ended : tout est figé
    const before = game.getState();
    game.nextRequest();
    game.place(cardIdAt(0), 'rythme');
    expect(game.getState()).toEqual(before);
  });
});

describe('subscribe / getState', () => {
  it('notifie après chaque mutation ; le désabonnement est effectif', () => {
    const { game } = newGame();
    const phases: string[] = [];
    const unsubscribe = game.subscribe((s) => phases.push(s.phase));
    game.startSet();
    game.place(cardIdAt(0), 'rythme');
    expect(phases).toEqual(['playing', 'playing']);
    unsubscribe();
    game.place(cardIdAt(1), 'basse');
    expect(phases).toHaveLength(2); // plus notifié
  });

  it('getState retourne un instantané immuable (copies)', () => {
    const { game } = newGame();
    game.startSet();
    const s = game.getState();
    s.hand.pop();
    s.deck.push('intrus');
    s.board.rythme = 'intrus';
    s.results.push({
      recipeId: 'x',
      breakdown: {
        pairs: [], conditions: [], coherence: 0, objective: 0,
        audacious: 0, audaciousApplied: false, total: 0,
      },
      stars: 0,
      theoreticalMax: 0,
    });
    const fresh = game.getState();
    expect(fresh.hand).toHaveLength(6);
    expect(fresh.deck).toHaveLength(6);
    expect(fresh.board.rythme).toBeNull();
    expect(fresh.results).toHaveLength(0);
  });
});
