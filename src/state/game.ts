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
  type RequestPlan,
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

  /** Plan du set (défaut : toutes les recettes du fichier, 4 slots actifs). */
  const plan: readonly RequestPlan[] =
    opts.plan ?? data.recipes.map((recipe) => ({ recipe, slots: SLOT_IDS }));
  if (plan.length === 0) throw new Error('Plan de set vide : au moins une requête requise.');

  function getCard(id: string): Card {
    const card = data.cardById.get(id);
    if (!card) throw new Error(`État incohérent : carte inconnue « ${id} ».`);
    return card;
  }

  /** Deck du joueur pour ce set : base du max théorique (modele-de-donnees §4). */
  const fullDeckIds: readonly string[] = opts.deckIds ?? data.cards.map((c) => c.id);
  const deckCards: Card[] = fullDeckIds.map(getCard);

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

  function activeSlots(): readonly SlotId[] {
    return plan[requestIndex]?.slots ?? SLOT_IDS;
  }

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
      activeSlots: [...activeSlots()],
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
    return phase === 'playing' && activeSlots().every((s) => board[s] !== null);
  }

  /** Max théorique sur le DECK DU JOUEUR et la taille de plateau de la requête. */
  function theoreticalMaxFor(recipe: Recipe, boardSize: number): number {
    const key = `${recipe.id}:${boardSize}`;
    const cached = theoMaxCache.get(key);
    if (cached !== undefined) return cached;
    const value = rules.theoreticalMax([...deckCards], recipe, data.scoring, boardSize);
    theoMaxCache.set(key, value);
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
      if (!activeSlots().includes(slot)) return; // slot verrouillé (progressivité)
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
          'drop() impossible : il faut être en phase « playing » avec tous les slots actifs remplis.',
        );
      }
      const step = plan[requestIndex];
      if (!step) {
        throw new Error(`Aucune recette pour la requête #${requestIndex + 1} du set.`);
      }
      const recipe = step.recipe;
      const placed = activeSlots().map((s) => {
        const id = board[s];
        // Invariant : canDrop() garantit les slots actifs remplis.
        if (id === null) throw new Error(`État incohérent : slot « ${s} » vide au drop.`);
        return getCard(id);
      });
      const breakdown = rules.evaluateBoard(placed, recipe, data.scoring);
      const theoreticalMax = theoreticalMaxFor(recipe, placed.length);
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
      if (requestIndex >= plan.length - 1) {
        phase = 'ended';
      } else {
        requestIndex += 1;
        // Si un slot occupé se re-verrouillait (interdit par la validation des
        // scènes, mais l'invariant est garanti ici) : la carte revient en main.
        const active = activeSlots();
        for (const slot of SLOT_IDS) {
          const id = board[slot];
          if (id !== null && !active.includes(slot)) {
            board[slot] = null;
            hand.push(id);
          }
        }
        draw(config.drawPerRequest);
        phase = 'playing'; // le plateau est conservé (persistant, GDD §11)
      }
      notify();
    },

    currentRecipe() {
      if (phase === 'title' || phase === 'ended') return null;
      return plan[requestIndex]?.recipe ?? null;
    },
  };
}
