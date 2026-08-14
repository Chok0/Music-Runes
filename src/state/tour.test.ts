/**
 * Tests du méta-état de tournée : persistance (storage mémoire injecté),
 * économie (cachet/boutique) et satisfiabilité des scènes de data/scenes.json
 * avec la collection garantie (grants + n'importe quel choix de boutique).
 */
import { describe, expect, it } from 'vitest';
import { loadGameData } from '../data/load';
import { createRules } from '../rules';
import { createTour, type TourStorage } from './tour';
import type { Card, TourSave } from '../types';

const data = loadGameData();
const rules = createRules();

function memoryStorage(): TourStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function newTour() {
  return createTour(data, memoryStorage());
}

describe('createTour — persistance', () => {
  it('load retourne null sans sauvegarde, puis la sauvegarde persistée', () => {
    const tour = newTour();
    expect(tour.load()).toBeNull();
    const save = tour.fresh();
    save.wallet = 7;
    tour.persist(save);
    expect(tour.load()).toEqual(save);
    tour.clear();
    expect(tour.load()).toBeNull();
  });

  it('load rejette les sauvegardes corrompues ou incohérentes', () => {
    const storage = memoryStorage();
    const tour = createTour(data, storage);
    const bad: unknown[] = [
      'pas du json{',
      JSON.stringify({ version: 99, sceneIndex: 0, wallet: 0, ownedCardIds: [] }),
      JSON.stringify({ version: 1, sceneIndex: -1, wallet: 0, ownedCardIds: [] }),
      JSON.stringify({ version: 1, sceneIndex: data.scenes.length + 1, wallet: 0, ownedCardIds: [] }),
      JSON.stringify({ version: 1, sceneIndex: 0, wallet: -5, ownedCardIds: [] }),
      JSON.stringify({ version: 1, sceneIndex: 0, wallet: 0, ownedCardIds: ['carte-inconnue'] }),
      JSON.stringify({ version: 1, sceneIndex: 0, wallet: 0, ownedCardIds: ['loup-statique', 'loup-statique'] }),
    ];
    for (const raw of bad) {
      storage.setItem('music-runes.tour.v1', String(raw));
      expect(tour.load()).toBeNull();
    }
  });
});

describe('createTour — économie et progression', () => {
  it('applyStartGrants est idempotent et retourne les nouveautés seulement', () => {
    const tour = newTour();
    const save = tour.fresh();
    const scene = data.scenes[0]!;
    const granted = tour.applyStartGrants(save, scene);
    expect(granted).toEqual(scene.grants_on_start);
    expect(tour.applyStartGrants(save, scene)).toEqual([]); // déjà possédées
    expect(save.ownedCardIds).toEqual(scene.grants_on_start);
  });

  it('completeScene crédite cachet + score (plancher 0), applique grant_on_end, avance', () => {
    const tour = newTour();
    const save = tour.fresh();
    const withGrant = data.scenes.find((s) => s.grant_on_end !== undefined)!;
    tour.completeScene(save, withGrant, 8);
    expect(save.wallet).toBe(withGrant.cachet + 8);
    expect(save.ownedCardIds).toContain(withGrant.grant_on_end);
    expect(save.sceneIndex).toBe(1);
    // Score négatif : seul le cachet est crédité.
    const before = save.wallet;
    tour.completeScene(save, data.scenes[0]!, -12);
    expect(save.wallet).toBe(before + data.scenes[0]!.cachet);
  });

  it('buy débite et ajoute la carte ; refuse fonds insuffisants et doublons', () => {
    const tour = newTour();
    const save = tour.fresh();
    save.wallet = 10;
    expect(tour.buy(save, 'velours-triangle', 10)).toBe(true);
    expect(save.wallet).toBe(0);
    expect(tour.buy(save, 'velours-triangle', 0)).toBe(false); // doublon
    expect(tour.buy(save, 'cuivre-calme', 5)).toBe(false); // fonds insuffisants
  });

  it('shopOffers : les 3 premières offres non possédées', () => {
    const tour = newTour();
    const save = tour.fresh();
    const scene = data.scenes.find((s) => s.shop !== undefined)!;
    const offers = tour.shopOffers(save, scene);
    expect(offers).toHaveLength(3);
    save.ownedCardIds.push(offers[0]!);
    const after = tour.shopOffers(save, scene);
    expect(after).not.toContain(offers[0]);
  });
});

describe('data/scenes.json — la tournée est jouable de bout en bout', () => {
  /**
   * Simule tous les parcours d'achat possibles (chaque choix de boutique) et
   * vérifie qu'à chaque scène, CHAQUE requête a au moins un plateau qui
   * remplit toutes ses conditions avec la collection du moment — le joueur ne
   * rencontre jamais d'objectif impossible, quel que soit son choix.
   */
  function satisfiable(recipeId: string, ownedIds: string[], boardSize: number): boolean {
    const recipe = data.recipeById.get(recipeId)!;
    const owned = ownedIds.map((id) => data.cardById.get(id)!);
    const pick: Card[] = [];
    const walk = (start: number): boolean => {
      if (pick.length === boardSize) {
        return rules.evaluateBoard(pick, recipe, data.scoring).conditions.every((c) => c.met);
      }
      for (let i = start; i <= owned.length - (boardSize - pick.length); i++) {
        pick.push(owned[i]!);
        if (walk(i + 1)) {
          pick.pop();
          return true;
        }
        pick.pop();
      }
      return false;
    };
    return walk(0);
  }

  it('chaque requête de chaque scène est satisfiable pour tout parcours d’achat', () => {
    const explore = (sceneIndex: number, owned: string[]): void => {
      const scene = data.scenes[sceneIndex];
      if (!scene) return; // tournée finie
      const withGrants = [...new Set([...owned, ...scene.grants_on_start])];
      for (const req of scene.requests) {
        expect(
          satisfiable(req.recipe, withGrants, req.slots.length),
          `scène « ${scene.id} », recette « ${req.recipe} » insatisfiable avec [${withGrants.join(', ')}]`,
        ).toBe(true);
      }
      const afterScene = scene.grant_on_end !== undefined
        ? [...new Set([...withGrants, scene.grant_on_end])]
        : withGrants;
      if (!scene.shop) {
        explore(sceneIndex + 1, afterScene);
        return;
      }
      const offers = scene.shop.offers.filter((id) => !afterScene.includes(id)).slice(0, 3);
      for (const offer of offers) {
        explore(sceneIndex + 1, [...afterScene, offer]);
      }
    };
    explore(0, []);
  });

  it('le deck de la scène 1 suffit à remplir tous ses slots', () => {
    const first = data.scenes[0]!;
    const maxSlots = Math.max(...first.requests.map((r) => r.slots.length));
    expect(first.grants_on_start.length).toBeGreaterThanOrEqual(maxSlots);
  });
});
