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
  type RequestPlan,
  type RulesApi,
  type ScoreBreakdown,
} from '../types';

const data = loadGameData();

const TEST_CONFIG: GameConfig = {
  startingHandSize: 6,
  drawPerRequest: 2,
  mulligansPerSet: 3,
  attentionMax: 100,
  attentionDrainPerMeasure: 1,
  attentionUnmetConditionPenalty: 8,
  attentionAllMetBonus: 5,
};
/** Séquence de référence des tests : les 6 premières recettes, 4 slots actifs. */
const REQUESTS_PER_SET = 6;

/** Shuffle identité : la pioche suit l'ordre de cards.json. */
const identity = (ids: string[]): string[] => ids;

function planOf(recipes: Recipe[], slots: readonly (typeof SLOT_IDS)[number][] = SLOT_IDS): RequestPlan[] {
  return recipes.map((recipe) => ({ recipe, slots }));
}

/** Faux moteur de règles : 4 cartes posées → total 20, max théorique 40 → 2★.
 *  `unmetConditions` simule des conditions ratées (drain d'attention au drop). */
function makeFakeRules(unmetConditions = 0): { rules: RulesApi; theoreticalMaxCalls: string[] } {
  const theoreticalMaxCalls: string[] = [];
  const rules: RulesApi = {
    matchesFilter: () => true,
    evaluateBoard: (placed): ScoreBreakdown => ({
      pairs: [],
      conditions: Array.from({ length: unmetConditions }, (_, i) => ({
        index: i,
        label: `condition ${i}`,
        met: false,
        points: 0,
      })),
      coherence: 0,
      objective: placed.length * 5,
      audacious: 0,
      audaciousApplied: false,
      total: placed.length * 5,
    }),
    pairDetails: () => [],
    theoreticalMax: (_deck, recipe, _cfg, boardSize) => {
      theoreticalMaxCalls.push(`${recipe.id}:${boardSize ?? 4}`);
      return 40;
    },
    starsFor: (total, max) => (max > 0 && total / max >= 0.5 ? 2 : 0),
    conditionLabel: () => '',
  };
  return { rules, theoreticalMaxCalls };
}

function newGame(
  config: GameConfig = TEST_CONFIG,
  plan: RequestPlan[] = planOf(data.recipes.slice(0, REQUESTS_PER_SET)),
  deckIds?: readonly string[],
  unmetConditions = 0,
): { game: GameStore; theoreticalMaxCalls: string[] } {
  const { rules, theoreticalMaxCalls } = makeFakeRules(unmetConditions);
  const game = createGame({
    data,
    rules,
    config,
    plan,
    shuffle: identity,
    ...(deckIds ? { deckIds } : {}),
  });
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

  it('remplacement DESTRUCTEUR : la carte éjectée est perdue pour le set', () => {
    const { game } = newGame();
    game.startSet();
    const first = cardIdAt(0);
    const second = cardIdAt(1);
    game.place(first, 'rythme');
    game.place(second, 'rythme');
    const s = game.getState();
    expect(s.board.rythme).toBe(second);
    expect(s.destroyed).toEqual([first]); // détruite, pas rendue en main
    expect(s.hand).not.toContain(first);
    expect(s.hand).not.toContain(second);
    expect(s.hand).toHaveLength(4); // 6 − 2 posées, rien ne revient
  });

  it('échange slot↔slot quand la cible est occupée — gratuit, rien de détruit', () => {
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
    expect(s.destroyed).toEqual([]); // le réagencement ne détruit rien
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

  it('discard (mulligan) : détruit la carte de main, repioche 1, décrémente le compteur', () => {
    const { game } = newGame();
    game.startSet();
    const a = cardIdAt(0);
    const deckTop = game.getState().deck[0];
    game.discard(a);
    const s = game.getState();
    expect(s.destroyed).toEqual([a]);
    expect(s.hand).not.toContain(a);
    expect(s.hand).toContain(deckTop); // la repioche compense
    expect(s.hand).toHaveLength(6);
    expect(s.mulligansLeft).toBe(TEST_CONFIG.mulligansPerSet - 1);
  });

  it('discard : no-op sur pioche vide (pas de défausse sèche → pas de soft-lock)', () => {
    const owned = data.cards.slice(0, 4).map((c) => c.id);
    const { game } = newGame(TEST_CONFIG, planOf(data.recipes.slice(0, 1)), owned);
    game.startSet(); // main = 4, deck = 0
    const before = game.getState();
    expect(before.deck).toHaveLength(0);
    const id = before.hand[0];
    if (id === undefined) throw new Error('main vide pendant le test');
    game.discard(id);
    expect(game.getState()).toEqual(before);
  });

  it('discard : no-op sans mulligan restant, sur une carte posée, ou hors main', () => {
    const { game } = newGame();
    game.startSet();
    const posed = cardIdAt(0);
    game.place(posed, 'rythme');
    const before = game.getState();
    game.discard(posed); // posée : pas défaussable
    game.discard('carte-inconnue');
    expect(game.getState()).toEqual(before);
    // Épuise les mulligans puis vérifie le no-op.
    const remaining = () => game.getState().mulligansLeft;
    while (remaining() > 0) {
      const id = game.getState().hand[0];
      if (id === undefined) throw new Error('main vide pendant le test');
      game.discard(id);
    }
    const exhausted = game.getState();
    const id = exhausted.hand[0];
    if (id === undefined) throw new Error('main vide pendant le test');
    game.discard(id);
    expect(game.getState()).toEqual(exhausted);
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

  it('drop : phase scored, résultat stocké, setScore = score + valeur des disques', () => {
    const { game } = newGame();
    game.startSet();
    fillBoard(game);
    // Valeur des 4 premières cartes de cards.json (shuffle identité).
    const discPoints = data.cards.slice(0, 4).reduce((acc, c) => acc + c.value, 0);
    const result = game.drop();
    expect(result.recipeId).toBe(recipeAt(0).id);
    expect(result.breakdown.total).toBe(20); // faux rules : 4 cartes × 5
    expect(result.discPoints).toBe(discPoints);
    expect(result.theoreticalMax).toBe(40);
    expect(result.stars).toBe(2); // 20/40 = 0.5 — la valeur des disques n'étoile pas
    const s = game.getState();
    expect(s.phase).toBe('scored');
    expect(s.results).toHaveLength(1);
    expect(s.results[0]?.recipeId).toBe(recipeAt(0).id);
    expect(s.setScore).toBe(20 + discPoints);
  });

  it('drop jette une Error si les conditions ne sont pas réunies', () => {
    const { game } = newGame();
    expect(() => game.drop()).toThrow(Error); // phase title
    game.startSet();
    game.place(cardIdAt(0), 'rythme');
    expect(() => game.drop()).toThrow(/slots actifs/); // 1 carte seulement
    fillBoard(game);
    game.drop();
    expect(() => game.drop()).toThrow(Error); // phase scored
  });

  it('le max théorique est mis en cache par (recette, taille de plateau)', () => {
    const r0 = recipeAt(0);
    const { game, theoreticalMaxCalls } = newGame(TEST_CONFIG, planOf([r0, r0]));
    game.startSet();
    fillBoard(game);
    game.drop();
    game.nextRequest();
    game.drop(); // même recette, plateau conservé
    expect(game.getState().results).toHaveLength(2);
    expect(theoreticalMaxCalls).toEqual([`${r0.id}:4`]); // un seul calcul
  });
});

describe('slots actifs (progressivité tutorielle) et deck restreint', () => {
  it('place est un no-op sur un slot verrouillé', () => {
    const { game } = newGame(TEST_CONFIG, [
      { recipe: recipeAt(0), slots: ['rythme', 'basse'] },
    ]);
    game.startSet();
    expect(game.getState().activeSlots).toEqual(['rythme', 'basse']);
    game.place(cardIdAt(0), 'lead'); // verrouillé
    expect(game.getState().board.lead).toBeNull();
    game.place(cardIdAt(0), 'rythme'); // actif
    expect(game.getState().board.rythme).toBe(cardIdAt(0));
  });

  it('canDrop/drop sur un plateau partiel : score et max théorique à la taille du plateau', () => {
    const { game, theoreticalMaxCalls } = newGame(TEST_CONFIG, [
      { recipe: recipeAt(0), slots: ['rythme', 'basse'] },
    ]);
    game.startSet();
    game.place(cardIdAt(0), 'rythme');
    expect(game.canDrop()).toBe(false);
    game.place(cardIdAt(1), 'basse');
    expect(game.canDrop()).toBe(true); // 2 slots actifs remplis suffisent
    const result = game.drop();
    expect(result.breakdown.total).toBe(10); // faux rules : 2 cartes × 5
    expect(theoreticalMaxCalls).toEqual([`${recipeAt(0).id}:2`]);
  });

  it('les slots débloqués en cours de set conservent le plateau existant', () => {
    const { game } = newGame(TEST_CONFIG, [
      { recipe: recipeAt(0), slots: ['rythme', 'basse'] },
      { recipe: recipeAt(1), slots: ['rythme', 'basse', 'harmonie'] },
    ]);
    game.startSet();
    game.place(cardIdAt(0), 'rythme');
    game.place(cardIdAt(1), 'basse');
    game.drop();
    game.nextRequest();
    const s = game.getState();
    expect(s.activeSlots).toEqual(['rythme', 'basse', 'harmonie']);
    expect(s.board.rythme).toBe(cardIdAt(0)); // plateau persistant
    game.place(cardIdAt(2), 'harmonie'); // le slot débloqué est jouable
    expect(game.getState().board.harmonie).toBe(cardIdAt(2));
  });

  it('anti-soft-lock : la destruction est refusée si elle rendait la scène infinissable', () => {
    // Tutoriel type : 4 disques possédés, une requête à venir exige les 4 slots.
    const owned = data.cards.slice(0, 4).map((c) => c.id);
    const { game } = newGame(
      TEST_CONFIG,
      [
        { recipe: recipeAt(0), slots: ['rythme', 'basse'] },
        { recipe: recipeAt(1), slots: [...SLOT_IDS] },
      ],
      owned,
    );
    game.startSet();
    expect(game.destructionLocked()).toBe(true); // 4 disques pour 4 slots à venir
    const [a, b, c] = [owned[0]!, owned[1]!, owned[2]!];
    game.place(a, 'rythme');
    const before = game.getState();
    game.place(b, 'rythme'); // remplacement destructeur → refusé
    expect(game.getState()).toEqual(before);
    // Le déplacement et la pose sur slot vide restent permis.
    game.place(a, 'basse');
    expect(game.getState().board.basse).toBe(a);
    game.place(c, 'rythme');
    expect(game.getState().board.rythme).toBe(c);
    expect(game.getState().destroyed).toEqual([]);
  });

  it('deckIds restreint la pioche au deck du joueur', () => {
    const owned = data.cards.slice(0, 4).map((c) => c.id);
    const { game } = newGame(
      TEST_CONFIG,
      [{ recipe: recipeAt(0), slots: [...SLOT_IDS] }],
      owned,
    );
    game.startSet();
    const s = game.getState();
    expect(s.hand).toEqual(owned); // main = tout le deck (4 < startingHandSize)
    expect(s.deck).toEqual([]);
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
    expect(s.deck).toHaveLength(data.cards.length - 6 - 2);
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
    // Main de départ n−1 → deck 1 : la première pioche est partielle (1), les suivantes nulles.
    const handSize = data.cards.length - 1;
    const config: GameConfig = { ...TEST_CONFIG, startingHandSize: handSize };
    const { game } = newGame(config, planOf(data.recipes.slice(0, 3)));
    game.startSet();
    expect(game.getState().deck).toHaveLength(1);
    fillBoard(game);
    game.drop();
    game.nextRequest();
    expect(game.getState().hand).toHaveLength(handSize - 4 + 1); // pioche partielle
    expect(game.getState().deck).toHaveLength(0);
    game.drop();
    game.nextRequest();
    expect(game.getState().hand).toHaveLength(handSize - 4 + 1); // pioche nulle, pas d'erreur
    game.drop();
    game.nextRequest();
    expect(game.getState().phase).toBe('ended');
  });

  it('set complet de 6 requêtes : fin en ended, currentRecipe null, score cumulé', () => {
    const { game } = newGame();
    game.startSet();
    fillBoard(game);
    for (let i = 0; i < REQUESTS_PER_SET; i++) {
      expect(game.currentRecipe()?.id).toBe(recipeAt(i).id);
      game.drop();
      game.nextRequest();
    }
    const s = game.getState();
    expect(s.phase).toBe('ended');
    expect(game.currentRecipe()).toBeNull();
    expect(s.results).toHaveLength(6);
    // 6 × (20 pts + valeur des 4 mêmes disques, plateau persistant).
    const discPoints = data.cards.slice(0, 4).reduce((acc, c) => acc + c.value, 0);
    expect(s.setScore).toBe(6 * (20 + discPoints));
    expect(s.deck).toHaveLength(0); // 8 au départ, 5 pioches de 2 l'épuisent
    // ended : tout est figé
    const before = game.getState();
    game.nextRequest();
    game.place(cardIdAt(0), 'rythme');
    expect(game.getState()).toEqual(before);
  });
});

describe('jauge d’attention', () => {
  it('tickAttention draine sans notifier, sauf passage à zéro → failed', () => {
    const { game } = newGame();
    game.startSet();
    const phases: string[] = [];
    game.subscribe((s) => phases.push(s.phase));
    expect(game.tickAttention(30)).toBe(70);
    expect(phases).toEqual([]); // drain silencieux
    expect(game.getState().attention).toBe(70); // mais visible au prochain snapshot
    expect(game.tickAttention(70)).toBe(0);
    expect(phases).toEqual(['failed']); // seule notification : le zéro
    expect(game.getState().phase).toBe('failed');
    expect(game.tickAttention(5)).toBe(0); // no-op hors playing
  });

  it('drop sans faute regagne de l’attention (plafonnée), conditions ratées la drainent', () => {
    // Faux rules sans condition ratée → +5 plafonné au max.
    const { game } = newGame();
    game.startSet();
    game.tickAttention(10);
    fillBoard(game);
    game.drop();
    expect(game.getState().attention).toBe(95); // 90 + 5
    // Faux rules avec 2 conditions ratées → −16.
    const { game: bad } = newGame(TEST_CONFIG, undefined, undefined, 2);
    bad.startSet();
    fillBoard(bad);
    bad.drop();
    expect(bad.getState().attention).toBe(100 - 2 * TEST_CONFIG.attentionUnmetConditionPenalty);
  });

  it('un drop qui vide la jauge fait basculer en failed, pas en scored', () => {
    const { game } = newGame(TEST_CONFIG, undefined, undefined, 2);
    game.startSet();
    game.tickAttention(100 - 2 * TEST_CONFIG.attentionUnmetConditionPenalty); // reste pile le drain du drop
    fillBoard(game);
    game.drop();
    const s = game.getState();
    expect(s.attention).toBe(0);
    expect(s.phase).toBe('failed');
  });

  it('attentionMax de la scène est respectée (opts.attentionMax)', () => {
    const { rules } = makeFakeRules();
    const game = createGame({
      data,
      rules,
      config: TEST_CONFIG,
      plan: planOf(data.recipes.slice(0, 1)),
      shuffle: identity,
      attentionMax: 140,
    });
    game.startSet();
    expect(game.getState().attention).toBe(140);
    expect(game.getState().attentionMax).toBe(140);
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
      discPoints: 0,
      breakdown: {
        pairs: [], conditions: [], coherence: 0, objective: 0,
        audacious: 0, audaciousApplied: false, total: 0,
      },
      stars: 0,
      theoreticalMax: 0,
    });
    const fresh = game.getState();
    expect(fresh.hand).toHaveLength(6);
    expect(fresh.deck).toHaveLength(data.cards.length - 6);
    expect(fresh.board.rythme).toBeNull();
    expect(fresh.results).toHaveLength(0);
  });
});
