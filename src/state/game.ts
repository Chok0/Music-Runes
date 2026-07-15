/**
 * Machine à états du set (GDD section 11 ✅) : séquence continue de requêtes
 * sur un plateau PERSISTANT — le plateau n'est jamais vidé entre deux requêtes.
 * Module pur (aucune dépendance UI/audio) : état interne + notifications.
 */
import {
  SLOT_IDS,
  type Card,
  type CreateGameOptions,
  type GamePhase,
  type GameState,
  type GameStore,
  type Recipe,
  type RequestResult,
  type SlotId,
} from '../types';

/** Fisher-Yates sur copie (mélange par défaut si opts.shuffle absent). */
function fisherYates(ids: string[]): string[] {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const vi = a[i];
    const vj = a[j];
    if (vi !== undefined && vj !== undefined) {
      a[i] = vj;
      a[j] = vi;
    }
  }
  return a;
}

function emptyBoard(): Record<SlotId, string | null> {
  return { rythme: null, basse: null, harmonie: null, lead: null };
}

export function createGame(opts: CreateGameOptions): GameStore {
  const { data, rules, config } = opts;
  const shuffle = opts.shuffle ?? fisherYates;

  /** Séquence du set (défaut : ordre du fichier, tronqué à requestsPerSet). */
  const sequence: readonly Recipe[] =
    opts.recipeSequence ?? data.recipes.slice(0, config.requestsPerSet);

  function getCard(id: string): Card {
    const card = data.cardById.get(id);
    if (!card) throw new Error(`État incohérent : carte inconnue « ${id} ».`);
    return card;
  }

  /** Deck complet du joueur : base du max théorique (modele-de-donnees §4). */
  const fullDeckIds: readonly string[] = data.cards.map((c) => c.id);

  // --- État interne -------------------------------------------------------
  let phase: GamePhase = 'title';
  let deck: string[] = [...fullDeckIds];
  const hand: string[] = [];
  const board = emptyBoard();
  let requestIndex = 0;
  const results: RequestResult[] = [];
  let setScore = 0;

  const listeners = new Set<(state: GameState) => void>();
  /** Cache du max théorique : l'énumération C(n,4) ne tourne qu'une fois par recette. */
  const theoMaxCache = new Map<string, number>();

  // --- Helpers ------------------------------------------------------------

  /** Instantané immuable : jamais de référence mutable vers l'état interne
   * (breakdown compris — un consommateur qui trie/mute pairs ne doit pas
   * corrompre les résultats internes). */
  function snapshot(): GameState {
    return {
      phase,
      deck: [...deck],
      hand: [...hand],
      board: { ...board },
      requestIndex,
      results: structuredClone(results),
      setScore,
    };
  }

  function notify(): void {
    const state = snapshot();
    for (const listener of listeners) listener(state);
  }

  /** Pioche min(n, deck restant) cartes — jamais d'erreur sur deck épuisé. */
  function draw(n: number): void {
    hand.push(...deck.splice(0, Math.min(n, deck.length)));
  }

  function canDrop(): boolean {
    return phase === 'playing' && SLOT_IDS.every((s) => board[s] !== null);
  }

  function theoreticalMaxFor(recipe: Recipe): number {
    const cached = theoMaxCache.get(recipe.id);
    if (cached !== undefined) return cached;
    const value = rules.theoreticalMax([...data.cards], recipe, data.scoring);
    theoMaxCache.set(recipe.id, value);
    return value;
  }

  // --- API ----------------------------------------------------------------

  return {
    getState: snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    startSet() {
      if (phase !== 'title') return;
      deck = [...shuffle([...fullDeckIds])];
      draw(config.startingHandSize);
      phase = 'playing';
      notify();
    },

    place(cardId, slot) {
      if (phase !== 'playing') return;
      if (board[slot] === cardId) return; // déjà sur ce slot
      const handIndex = hand.indexOf(cardId);
      const sourceSlot = SLOT_IDS.find((s) => board[s] === cardId);
      if (handIndex === -1 && sourceSlot === undefined) return; // carte inconnue
      const occupant = board[slot];
      if (sourceSlot !== undefined) {
        // Déplacement slot → slot : échange si la cible est occupée (occupant
        // null = simple déplacement, le slot source se vide).
        board[sourceSlot] = occupant;
      } else {
        hand.splice(handIndex, 1);
        // Remplacement (GDD §2 ✅) : la carte en place retourne en MAIN.
        if (occupant !== null) hand.push(occupant);
      }
      board[slot] = cardId;
      notify();
    },

    removeFromSlot(slot) {
      if (phase !== 'playing') return;
      const cardId = board[slot];
      if (cardId === null) return;
      board[slot] = null;
      hand.push(cardId);
      notify();
    },

    canDrop,

    drop() {
      if (!canDrop()) {
        throw new Error(
          'drop() impossible : il faut être en phase « playing » avec les 4 slots remplis.',
        );
      }
      const recipe = sequence[requestIndex];
      if (!recipe) {
        throw new Error(`Aucune recette pour la requête #${requestIndex + 1} du set.`);
      }
      const placed = SLOT_IDS.map((s) => {
        const id = board[s];
        // Invariant : canDrop() garantit les 4 slots remplis.
        if (id === null) throw new Error(`État incohérent : slot « ${s} » vide au drop.`);
        return getCard(id);
      });
      const breakdown = rules.evaluateBoard(placed, recipe, data.scoring);
      const theoreticalMax = theoreticalMaxFor(recipe);
      const stars = rules.starsFor(breakdown.total, theoreticalMax, data.scoring);
      const result: RequestResult = { recipeId: recipe.id, breakdown, stars, theoreticalMax };
      results.push(result);
      setScore += breakdown.total;
      phase = 'scored';
      notify();
      // Copie profonde : le résultat interne ne doit pas être mutable de l'extérieur.
      return structuredClone(result);
    },

    nextRequest() {
      if (phase !== 'scored') return;
      if (requestIndex >= sequence.length - 1) {
        phase = 'ended';
      } else {
        requestIndex += 1;
        draw(config.drawPerRequest);
        phase = 'playing'; // le plateau est conservé (persistant, GDD §11)
      }
      notify();
    },

    currentRecipe() {
      if (phase === 'title' || phase === 'ended') return null;
      return sequence[requestIndex] ?? null;
    },
  };
}
