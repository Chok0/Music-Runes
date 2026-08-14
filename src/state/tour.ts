/**
 * Méta-état de la tournée (docs/playtest-2026-08-14.md §3) : progression de
 * scène en scène, collection de cartes, portefeuille de points. Persisté en
 * localStorage ; le storage est injectable pour les tests (module sinon pur).
 *
 * Invariant économique (garanti par la validation de scenes.json) :
 * cachet ≥ prix de la boutique — l'achat de fin de scène est TOUJOURS
 * abordable, le joueur ne peut pas se retrouver bloqué.
 */
import { TOUR_SAVE_KEY } from '../config';
import type { GameData, Scene, TourSave } from '../types';

const SAVE_VERSION = 1;

/** Sous-ensemble de l'API Storage utilisé (injectable pour les tests). */
export interface TourStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TourApi {
  /** Sauvegarde valide ou null (absente, corrompue ou d'un schéma incompatible). */
  load(): TourSave | null;
  fresh(): TourSave;
  persist(save: TourSave): void;
  clear(): void;
  /** Ajoute les cartes offertes en début de scène ; retourne les ids réellement nouveaux. */
  applyStartGrants(save: TourSave, scene: Scene): string[];
  /** Fin de scène : cachet + score au portefeuille, grant_on_end, scène suivante. */
  completeScene(save: TourSave, scene: Scene, setScore: number): void;
  /** Les 3 premières offres de la boutique non encore possédées. */
  shopOffers(save: TourSave, scene: Scene): string[];
  /** Achète `cardId` au prix donné. false si fonds insuffisants ou carte déjà possédée. */
  buy(save: TourSave, cardId: string, price: number): boolean;
}

function safeLocalStorage(): TourStorage | null {
  try {
    // Peut jeter (navigation privée, storage désactivé) : le jeu doit
    // fonctionner sans persistance plutôt que planter.
    const storage = window.localStorage;
    const probe = '__music-runes-probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export function createTour(data: GameData, storage?: TourStorage): TourApi {
  const store: TourStorage | null = storage ?? safeLocalStorage();

  function isValid(raw: unknown): raw is TourSave {
    const s = raw as TourSave;
    return (
      !!s &&
      typeof s === 'object' &&
      s.version === SAVE_VERSION &&
      Number.isInteger(s.sceneIndex) &&
      s.sceneIndex >= 0 &&
      s.sceneIndex <= data.scenes.length &&
      typeof s.wallet === 'number' &&
      Number.isFinite(s.wallet) &&
      s.wallet >= 0 &&
      Array.isArray(s.ownedCardIds) &&
      s.ownedCardIds.every((id) => typeof id === 'string' && data.cardById.has(id)) &&
      new Set(s.ownedCardIds).size === s.ownedCardIds.length
    );
  }

  return {
    load(): TourSave | null {
      if (!store) return null;
      try {
        const raw = store.getItem(TOUR_SAVE_KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return isValid(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },

    fresh(): TourSave {
      return { version: SAVE_VERSION, sceneIndex: 0, wallet: 0, ownedCardIds: [] };
    },

    persist(save: TourSave): void {
      try {
        store?.setItem(TOUR_SAVE_KEY, JSON.stringify(save));
      } catch {
        // Quota plein ou storage indisponible : la partie continue sans sauvegarde.
      }
    },

    clear(): void {
      try {
        store?.removeItem(TOUR_SAVE_KEY);
      } catch {
        // Ignoré : au pire la sauvegarde invalide sera rejetée par load().
      }
    },

    applyStartGrants(save: TourSave, scene: Scene): string[] {
      const granted = scene.grants_on_start.filter((id) => !save.ownedCardIds.includes(id));
      save.ownedCardIds.push(...granted);
      return granted;
    },

    completeScene(save: TourSave, scene: Scene, setScore: number): void {
      // Le score d'un set peut être négatif : le gain est plancher à 0, le
      // cachet est garanti (on ne repart jamais d'un concert en ayant payé).
      save.wallet += scene.cachet + Math.max(0, setScore);
      if (scene.grant_on_end !== undefined && !save.ownedCardIds.includes(scene.grant_on_end)) {
        save.ownedCardIds.push(scene.grant_on_end);
      }
      save.sceneIndex += 1;
    },

    shopOffers(save: TourSave, scene: Scene): string[] {
      if (!scene.shop) return [];
      return scene.shop.offers.filter((id) => !save.ownedCardIds.includes(id)).slice(0, 3);
    },

    buy(save: TourSave, cardId: string, price: number): boolean {
      if (save.wallet < price || save.ownedCardIds.includes(cardId)) return false;
      save.wallet -= price;
      save.ownedCardIds.push(cardId);
      return true;
    },
  };
}
