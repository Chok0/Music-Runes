/**
 * Orchestration de l'interface (architecture §3.4) : DOM + SVG + CSS purs.
 *
 * Deux niveaux d'état :
 * - la TOURNÉE (méta) : scène courante, collection, portefeuille — persistée
 *   en localStorage (src/state/tour.ts), écrans titre/intro/célébration/
 *   boutique/fin de tournée ;
 * - le SET (une scène en cours de jeu) : un GameStore par scène, rendu par
 *   re-render complet à chaque notification, feedback de drag appliqué
 *   PAR-DESSUS le rendu (un drag en cours ne déclenche aucun re-render).
 */
import {
  SLOT_IDS,
  SLOT_LABELS,
  type Card,
  type GameState,
  type GameStore,
  type Recipe,
  type RequestResult,
  type Scene,
  type ScoreBreakdown,
  type SlotId,
  type TourSave,
} from '../types';
import { AUDIO_CONFIG, GAME_CONFIG, UI_FEEDBACK } from '../config';
import { loadGameData } from '../data/load';
import { createRules } from '../rules';
import { createGame } from '../state/game';
import { createTour } from '../state/tour';
import { createAudioEngine } from '../audio/engine';
import { button, el } from './dom';
import { createCardElement } from './card-view';
import { formatPoints } from './format';
import { renderBreakdownLines } from './score-panel';
import {
  renderCelebration,
  renderSceneIntro,
  renderScoredModal,
  renderShop,
  renderTitleScreen,
  renderTourEnd,
  type AudioStatus,
  type TourStatus,
} from './screens';

/** En deçà, un pointerdown+up est un clic (sélection) ; au-delà, un drag. */
const DRAG_THRESHOLD_PX = 8;
/** Délai avant preview sonore au survol (GDD §5 : aperçu, pas d'écoute forcée). */
const PREVIEW_DELAY_MS = 300;

type CardOrigin = { kind: 'hand' } | { kind: 'board'; slot: SlotId };

/** Écrans hors set — quand aucun GameStore n'est actif. */
type MetaPhase = 'title' | 'intro' | 'celebration' | 'shop' | 'tour-ended';

interface DragState {
  cardId: string;
  from: CardOrigin;
  pointerId: number;
  startX: number;
  startY: number;
  started: boolean;
  ghost: HTMLElement | null;
  hoverSlot: SlotId | null;
  overHand: boolean;
  slotPreviewTimer: number | null;
}

/** Données figées au moment de la fin de scène, pour la célébration/boutique. */
interface SceneOutcome {
  scene: Scene;
  results: RequestResult[];
  setScore: number;
  grantCard: Card | null;
}

export function mountApp(root: HTMLElement): void {
  const data = loadGameData();
  const rules = createRules();
  const tour = createTour(data);
  const audio = createAudioEngine(data, AUDIO_CONFIG);

  // --- État méta (tournée) --------------------------------------------------
  let save: TourSave = tour.load() ?? tour.fresh();
  let meta: MetaPhase = 'title';
  /** Cartes offertes à l'entrée de la scène courante (affichage intro). */
  let grantedCards: Card[] = [];
  let outcome: SceneOutcome | null = null;

  // --- État du set en cours -------------------------------------------------
  let store: GameStore | null = null;
  let unsubscribe: (() => void) | null = null;
  let totalRequests = 0;

  // --- État purement UI (hors stores) ---------------------------------------
  const ui = {
    audioStatus: 'idle' as AudioStatus,
    muted: false,
    selectedCardId: null as string | null,
    panelOpen: window.matchMedia('(min-width: 900px)').matches,
  };
  let drag: DragState | null = null;
  let handPreviewTimer: number | null = null;

  // --- Helpers données/règles ----------------------------------------------
  function cardOf(id: string): Card | null {
    return data.cardById.get(id) ?? null;
  }

  function currentScene(): Scene {
    const scene = data.scenes[save.sceneIndex];
    if (!scene) throw new Error(`État incohérent : scène #${save.sceneIndex + 1} introuvable.`);
    return scene;
  }

  function placedCards(state: GameState): Card[] {
    const cards: Card[] = [];
    for (const slot of state.activeSlots) {
      const id = state.board[slot];
      if (!id) continue;
      const card = cardOf(id);
      if (card) cards.push(card);
    }
    return cards;
  }

  /** evaluateBoard exige ≥ 1 carte : plateau vide → null (score courant 0). */
  function evaluatePlaced(state: GameState, recipe: Recipe): ScoreBreakdown | null {
    const cards = placedCards(state);
    return cards.length > 0 ? rules.evaluateBoard(cards, recipe, data.scoring) : null;
  }

  /**
   * Delta de score si `card` était posée sur `slot` (feedback avant la pose).
   * Reproduit la sémantique exacte de store.place() : depuis la main, la
   * carte remplace l'occupant (qui retourne en main) ; depuis un autre slot,
   * les deux cartes s'ÉCHANGENT — le multiset posé ne change pas (delta 0).
   */
  function hypotheticalDelta(state: GameState, recipe: Recipe, card: Card, slot: SlotId): number {
    const board: Record<SlotId, string | null> = { ...state.board };
    const sourceSlot = SLOT_IDS.find((s) => board[s] === card.id);
    if (sourceSlot !== undefined) board[sourceSlot] = board[slot]; // échange slot↔slot
    board[slot] = card.id;
    const hypState: GameState = { ...state, board };
    const hyp = evaluatePlaced(hypState, recipe)?.total ?? 0;
    const cur = evaluatePlaced(state, recipe)?.total ?? 0;
    return hyp - cur;
  }

  // --- Audio ↔ état : le moteur dédoublonne lui-même (setSlot no-op si la
  // cible est déjà la bonne) — pas de diff côté UI.
  function syncAudio(state: GameState): void {
    if (ui.audioStatus !== 'ready') return;
    for (const slot of SLOT_IDS) audio.setSlot(slot, state.board[slot]);
    // Écran de score : le mix continue mais en retrait — ponctuation sonore
    // de la fin de requête (retour playtest : la fin passait inaperçue).
    audio.setDucked(state.phase === 'scored');
  }

  function clearHandPreviewTimer(): void {
    if (handPreviewTimer !== null) {
      window.clearTimeout(handPreviewTimer);
      handPreviewTimer = null;
    }
  }

  function stopPreviewIfReady(): void {
    if (ui.audioStatus === 'ready') audio.stopPreview();
  }

  // --- Cycle de vie de la tournée -------------------------------------------

  function tourStatus(): TourStatus {
    if (save.sceneIndex >= data.scenes.length) return { kind: 'finished', totalScenes: data.scenes.length };
    if (save.sceneIndex === 0 && save.ownedCardIds.length === 0)
      return { kind: 'new', totalScenes: data.scenes.length };
    return {
      kind: 'in-progress',
      sceneNumber: save.sceneIndex + 1,
      totalScenes: data.scenes.length,
      sceneName: currentScene().name,
    };
  }

  function enterIntro(): void {
    const scene = currentScene();
    // Cartes offertes en début de scène (le deck de départ pour la scène 1) —
    // idempotent : à la reprise d'une sauvegarde, rien de nouveau à montrer.
    const granted = tour.applyStartGrants(save, scene);
    tour.persist(save);
    grantedCards = granted.map(cardOf).filter((c): c is Card => c !== null);
    meta = 'intro';
    renderMeta();
  }

  function startScene(): void {
    const scene = currentScene();
    const plan = scene.requests.map((req) => {
      const recipe = data.recipeById.get(req.recipe);
      if (!recipe) throw new Error(`Recette inconnue « ${req.recipe} » (scène ${scene.id}).`);
      return { recipe, slots: req.slots };
    });
    totalRequests = plan.length;
    store = createGame({
      data,
      rules,
      config: GAME_CONFIG,
      plan,
      deckIds: [...save.ownedCardIds],
    });
    unsubscribe = store.subscribe(onStateChange);
    store.startSet();
  }

  /** Fin de set : fige le résultat, crédite la tournée, célèbre. */
  function handleSceneEnd(state: GameState): void {
    const scene = currentScene();
    unsubscribe?.();
    unsubscribe = null;
    store = null;

    if (ui.audioStatus === 'ready') {
      audio.setDucked(false);
      audio.clearAllSlots();
      audio.playApplause();
    }

    const grantCard = scene.grant_on_end !== undefined ? cardOf(scene.grant_on_end) : null;
    outcome = { scene, results: state.results, setScore: state.setScore, grantCard };
    tour.completeScene(save, scene, state.setScore);
    tour.persist(save);
    meta = 'celebration';
    renderMeta();
  }

  function afterScene(): void {
    outcome = null;
    if (save.sceneIndex >= data.scenes.length) {
      meta = 'tour-ended';
      renderMeta();
    } else {
      enterIntro();
    }
  }

  function onCelebrationContinue(): void {
    if (!outcome) return afterScene();
    const offers = tour.shopOffers(save, outcome.scene);
    if (outcome.scene.shop && offers.length > 0) {
      meta = 'shop';
      renderMeta();
    } else {
      afterScene();
    }
  }

  function onBuy(cardId: string): void {
    if (!outcome?.scene.shop) return;
    if (!tour.buy(save, cardId, outcome.scene.shop.price)) return;
    tour.persist(save);
    afterScene();
  }

  function onResetTour(): void {
    tour.clear();
    save = tour.fresh();
    meta = 'title';
    renderMeta();
  }

  async function onMountStage(): Promise<void> {
    if (ui.audioStatus === 'loading') return;
    if (ui.audioStatus === 'idle') {
      ui.audioStatus = 'loading';
      renderMeta();
      try {
        // init + start DANS le geste utilisateur (autoplay policy, archi §4.4).
        await audio.init();
        await audio.start();
        ui.audioStatus = 'ready';
        audio.setMuted(ui.muted);
      } catch (err) {
        // L'audio échoue ? Le jeu continue sans son, jamais bloqué.
        console.warn('Audio indisponible — le jeu continue en silence.', err);
        ui.audioStatus = 'failed';
      }
    }
    startScene(); // notifie → écran de jeu
  }

  // --- Rendu ----------------------------------------------------------------
  function renderMeta(): void {
    if (drag) cleanupDrag();
    clearHandPreviewTimer();
    root.replaceChildren();
    switch (meta) {
      case 'title':
        root.appendChild(
          renderTitleScreen(
            tourStatus(),
            () => {
              if (save.sceneIndex >= data.scenes.length) onResetTour();
              // Depuis le titre on passe toujours par l'intro de la scène courante.
              if (save.sceneIndex < data.scenes.length) enterIntro();
            },
            tourStatus().kind === 'in-progress' ? onResetTour : null,
          ),
        );
        break;
      case 'intro':
        root.appendChild(
          renderSceneIntro({
            scene: currentScene(),
            sceneNumber: save.sceneIndex + 1,
            totalScenes: data.scenes.length,
            grantedCards,
            audioStatus: ui.audioStatus,
            onMountStage: () => void onMountStage(),
          }),
        );
        break;
      case 'celebration':
        if (outcome) {
          root.appendChild(
            renderCelebration({
              scene: outcome.scene,
              results: outcome.results,
              data,
              setScore: outcome.setScore,
              wallet: save.wallet,
              grantCard: outcome.grantCard,
              onContinue: onCelebrationContinue,
            }),
          );
        }
        break;
      case 'shop':
        if (outcome?.scene.shop) {
          root.appendChild(
            renderShop({
              shop: outcome.scene.shop,
              offers: tour.shopOffers(save, outcome.scene).map(cardOf).filter((c): c is Card => c !== null),
              wallet: save.wallet,
              onBuy,
            }),
          );
        }
        break;
      case 'tour-ended':
        root.appendChild(renderTourEnd({ data, save, onReplay: onResetTour }));
        break;
    }
  }

  function rerender(): void {
    if (store) render(store.getState());
    else renderMeta();
  }

  function render(state: GameState): void {
    // Un re-render détacherait la carte source d'un drag en cours (et ses
    // listeners pointerup) : le drag resterait verrouillé à jamais. On
    // l'annule proprement avant de reconstruire le DOM.
    if (drag) cleanupDrag();
    // Un re-render invalide les éléments survolés : on annule la preview en attente.
    clearHandPreviewTimer();
    const focusKey =
      document.activeElement instanceof HTMLElement ? document.activeElement.dataset['key'] : undefined;

    root.replaceChildren();
    switch (state.phase) {
      case 'title':
        // Le GameStore naît en 'title' : rien à montrer, startSet() suit immédiatement.
        break;
      case 'playing':
      case 'scored': {
        root.appendChild(renderGameScreen(state));
        if (state.phase === 'scored') {
          const result = state.results[state.results.length - 1];
          if (result) {
            const isLast = state.requestIndex >= totalRequests - 1;
            root.appendChild(renderScoredModal(result, data, isLast, () => store?.nextRequest()));
          }
        }
        break;
      }
      case 'ended':
        // Géré par handleSceneEnd (transition méta) — jamais rendu ici.
        break;
    }

    if (focusKey) root.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus();
    applyActiveFeedback(state);
  }

  function onStateChange(state: GameState): void {
    if (state.phase === 'ended') {
      handleSceneEnd(state);
      return;
    }
    syncAudio(state);
    render(state);
  }

  // --- Écran de jeu -----------------------------------------------------------
  function renderGameScreen(state: GameState): HTMLElement {
    const recipe = store?.currentRecipe() ?? null;
    const breakdown = recipe ? evaluatePlaced(state, recipe) : null;

    const screen = el('div', 'screen screen--game');
    screen.appendChild(renderHud(state, recipe, breakdown));

    const main = el('div', 'game-main');
    main.appendChild(renderBoard(state, breakdown));
    main.appendChild(renderScorePanel(breakdown));
    screen.appendChild(main);

    screen.appendChild(renderFooter(state));

    // Clic hors carte/slot : désélection. En 'click' (pas 'pointerdown') :
    // un re-render synchrone dans le pointerdown détacherait le bouton
    // pressé et avalerait son click (drop/mute/panneau exigeraient 2 clics).
    screen.addEventListener('click', (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (ui.selectedCardId && t && !t.closest('.card') && !t.closest('.slot')) {
        ui.selectedCardId = null;
        rerender();
      }
    });
    return screen;
  }

  function renderHud(state: GameState, recipe: Recipe | null, breakdown: ScoreBreakdown | null): HTMLElement {
    const hud = el('header', 'hud');
    const scene = currentScene();

    const request = el('div', 'hud__request');
    request.appendChild(
      el(
        'div',
        'hud__request-index',
        `${scene.name} · Requête ${state.requestIndex + 1}/${totalRequests}`,
      ),
    );
    if (recipe) {
      const nameRow = el('div', 'hud__recipe');
      nameRow.appendChild(el('span', 'hud__recipe-name', `« ${recipe.name} »`));
      nameRow.appendChild(el('span', 'hud__recipe-difficulty', recipe.difficulty));
      request.appendChild(nameRow);
      if (recipe.flavor) request.appendChild(el('div', 'hud__flavor', recipe.flavor));

      // Conditions évaluées EN DIRECT sur le plateau courant.
      const conds = el('ul', 'hud__conditions');
      recipe.conditions.forEach((cond, i) => {
        const met = breakdown?.conditions.find((c) => c.index === i)?.met ?? false;
        const li = el('li', `hud__condition ${met ? 'is-met' : 'is-unmet'}`);
        li.appendChild(el('span', 'hud__condition-state', met ? '✓' : '○'));
        li.appendChild(el('span', 'hud__condition-label', rules.conditionLabel(cond)));
        conds.appendChild(li);
      });
      request.appendChild(conds);
    }
    hud.appendChild(request);

    const metaBox = el('div', 'hud__meta');
    metaBox.appendChild(el('div', 'hud__set-score', `Set : ${state.setScore} pts`));
    const mute = button('hud__mute', ui.muted || ui.audioStatus === 'failed' ? '🔇' : '🔊', onToggleMute);
    mute.dataset['key'] = 'mute';
    mute.disabled = ui.audioStatus !== 'ready';
    mute.setAttribute('aria-pressed', String(ui.muted));
    mute.setAttribute('aria-label', ui.muted ? 'Rétablir le son' : 'Couper le son');
    metaBox.appendChild(mute);
    if (ui.audioStatus === 'failed') {
      metaBox.appendChild(el('div', 'hud__audio-warn', 'Audio indisponible — le jeu continue en silence.'));
    }
    hud.appendChild(metaBox);
    return hud;
  }

  function renderBoard(state: GameState, breakdown: ScoreBreakdown | null): HTMLElement {
    const board = el('section', 'board');
    board.setAttribute('aria-label', 'Plateau de mix');

    // Feedback visuel du mix (GDD §5) : tremblement si cohérence négative,
    // liseré harmonieux si elle est haute — sobre, piloté par une CSS var.
    const coherence = breakdown?.coherence ?? 0;
    if (coherence < 0) {
      board.classList.add('board--dissonant');
      const amp = Math.min(UI_FEEDBACK.shakeMaxPx, UI_FEEDBACK.shakePxPerPoint * Math.abs(coherence));
      board.style.setProperty('--shake-amp', `${amp.toFixed(2)}px`);
    } else if (coherence >= UI_FEEDBACK.harmonyThreshold) {
      board.classList.add('board--harmonious');
    }

    for (const slot of SLOT_IDS) board.appendChild(renderSlot(state, slot));
    return board;
  }

  function renderSlot(state: GameState, slot: SlotId): HTMLElement {
    const wrap = el('div', 'slot');
    wrap.dataset['slot'] = slot;

    // Slot verrouillé (progressivité tutorielle) : visible mais inerte —
    // le joueur voit ce qui l'attend sans pouvoir y poser de carte.
    if (!state.activeSlots.includes(slot)) {
      wrap.classList.add('slot--locked');
      wrap.appendChild(el('div', 'slot__label', SLOT_LABELS[slot]));
      wrap.appendChild(el('div', 'slot__placeholder', '🔒 Bientôt'));
      return wrap;
    }

    wrap.dataset['key'] = `slot-${slot}`;
    wrap.tabIndex = 0;
    wrap.appendChild(el('div', 'slot__label', SLOT_LABELS[slot]));

    const id = state.board[slot];
    const card = id ? cardOf(id) : null;
    if (card) {
      const cardEl = createCardElement(card, { stemDescription: card.slots[slot].description });
      cardEl.dataset['key'] = `card-${card.id}`;
      if (ui.selectedCardId === card.id) cardEl.classList.add('card--selected');
      attachCardPointerHandlers(cardEl, card, { kind: 'board', slot });
      wrap.appendChild(cardEl);

      const remove = button('slot__remove', '↩', () => store?.removeFromSlot(slot));
      remove.title = 'Renvoyer en main';
      remove.setAttribute('aria-label', `Renvoyer ${card.name} en main`);
      remove.addEventListener('pointerdown', (e) => e.stopPropagation());
      wrap.appendChild(remove);
    } else {
      wrap.classList.add('slot--empty');
      wrap.appendChild(el('div', 'slot__placeholder', 'Pose une carte'));
    }

    // Clic-pour-poser : le clic sur le slot pose la carte sélectionnée.
    wrap.addEventListener('click', (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (t && (t.closest('.card') || t.closest('.slot__remove'))) return; // géré ailleurs
      handleSlotTap(slot);
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSlotTap(slot);
      }
    });
    return wrap;
  }

  function renderScorePanel(breakdown: ScoreBreakdown | null): HTMLElement {
    const details = el('details', 'score-panel');
    details.open = ui.panelOpen;
    details.addEventListener('toggle', () => {
      ui.panelOpen = details.open; // mémorisé sans re-render (état natif <details>)
    });
    const summary = el('summary', 'score-panel__summary', `Score en direct : ${breakdown?.total ?? 0} pts`);
    summary.dataset['key'] = 'panel';
    details.appendChild(summary);
    if (breakdown) {
      details.appendChild(renderBreakdownLines(breakdown, data));
    } else {
      details.appendChild(el('p', 'score-panel__hint', 'Pose des cartes pour voir la décomposition du score.'));
    }
    return details;
  }

  function renderFooter(state: GameState): HTMLElement {
    const footer = el('footer', 'footer');
    const activeCount = state.activeSlots.length;

    const dropRow = el('div', 'footer__drop-row');
    const can = store?.canDrop() ?? false;
    const drop = button('btn btn--primary footer__drop', '▶ Jouer le mix', onDrop);
    drop.dataset['key'] = 'drop';
    drop.disabled = !can;
    if (!can) drop.title = `Remplis les ${activeCount} slots`;
    dropRow.appendChild(drop);
    if (!can) {
      dropRow.appendChild(
        el('span', 'footer__hint', `Remplis les ${activeCount} slot${activeCount > 1 ? 's' : ''} pour jouer le mix.`),
      );
    }
    footer.appendChild(dropRow);

    const hand = el('div', 'hand');
    hand.dataset['handZone'] = '1'; // cible de drop : renvoyer une carte du plateau en main
    hand.setAttribute('aria-label', 'Main');
    for (const id of state.hand) {
      const card = cardOf(id);
      if (!card) continue;
      const cardEl = createCardElement(card);
      cardEl.dataset['key'] = `card-${card.id}`;
      if (ui.selectedCardId === card.id) cardEl.classList.add('card--selected');
      attachCardPointerHandlers(cardEl, card, { kind: 'hand' });
      attachHandPreviewHandlers(cardEl, card);
      hand.appendChild(cardEl);
    }
    if (state.hand.length === 0) hand.appendChild(el('div', 'hand__empty', 'Main vide'));
    footer.appendChild(hand);
    return footer;
  }

  // --- Feedback avant la pose (GDD §5/§7 — le cœur de la lisibilité) --------
  function haloClass(active: Card, other: Card, recipe: Recipe): string | null {
    const details = rules.pairDetails(active, other, recipe, data.scoring);
    if (details.some((d) => d.kind === 'requested_conflict')) return 'halo--dare';
    const sum = details.reduce((acc, d) => acc + d.points, 0);
    if (sum > 0) return 'halo--good';
    if (sum < 0) return 'halo--bad';
    return null;
  }

  /**
   * Applique halos + deltas pour la « carte active » (traînée ou sélectionnée).
   * Purement additif au DOM rendu : appelé après chaque render et à chaque
   * changement de slot survolé pendant un drag.
   */
  function applyActiveFeedback(state: GameState): void {
    root.querySelectorAll('.halo--good, .halo--bad, .halo--dare').forEach((n) => {
      n.classList.remove('halo--good', 'halo--bad', 'halo--dare');
    });
    root.querySelectorAll('.slot--target').forEach((n) => n.classList.remove('slot--target'));
    root.querySelectorAll('.slot__delta').forEach((n) => n.remove());

    if (state.phase !== 'playing') return;
    const recipe = store?.currentRecipe() ?? null;
    const activeId = drag?.started ? drag.cardId : ui.selectedCardId;
    if (!recipe || !activeId) return;
    const active = cardOf(activeId);
    if (!active) return;

    // Halo sur chaque carte déjà posée : la paire (carte active, carte posée).
    for (const slot of state.activeSlots) {
      const id = state.board[slot];
      if (!id || id === activeId) continue;
      const other = cardOf(id);
      if (!other) continue;
      const cls = haloClass(active, other, recipe);
      if (cls) root.querySelector(`.slot[data-slot="${slot}"] .card`)?.classList.add(cls);
    }

    // Delta hypothétique : le slot survolé en drag, tous les slots ACTIFS en sélection.
    const targets: SlotId[] = drag?.started
      ? drag.hoverSlot
        ? [drag.hoverSlot]
        : []
      : [...state.activeSlots];
    for (const slot of targets) {
      if (!state.activeSlots.includes(slot)) continue;
      if (state.board[slot] === activeId) continue;
      const slotEl = root.querySelector<HTMLElement>(`.slot[data-slot="${slot}"]`);
      if (!slotEl) continue;
      const delta = hypotheticalDelta(state, recipe, active, slot);
      const badge = el(
        'div',
        `slot__delta ${delta > 0 ? 'is-positive' : delta < 0 ? 'is-negative' : 'is-zero'}`,
        formatPoints(delta),
      );
      slotEl.appendChild(badge);
      if (drag?.started && drag.hoverSlot === slot) slotEl.classList.add('slot--target');
    }
  }

  // --- Interactions : clic-pour-poser --------------------------------------
  function handleCardTap(card: Card, origin: CardOrigin): void {
    const state = store?.getState();
    if (!state || state.phase !== 'playing') return;
    // Carte sélectionnée + tap sur une carte du plateau = remplacement.
    if (ui.selectedCardId && ui.selectedCardId !== card.id && origin.kind === 'board') {
      const selected = ui.selectedCardId;
      ui.selectedCardId = null;
      store?.place(selected, origin.slot); // notifie → re-render
      return;
    }
    ui.selectedCardId = ui.selectedCardId === card.id ? null : card.id;
    rerender();
  }

  function handleSlotTap(slot: SlotId): void {
    const state = store?.getState();
    if (!state || state.phase !== 'playing') return;
    const selected = ui.selectedCardId;
    if (!selected) return;
    ui.selectedCardId = null;
    if (state.board[slot] === selected) {
      rerender();
      return;
    }
    store?.place(selected, slot); // notifie → re-render
  }

  // --- Interactions : drag & drop Pointer Events ----------------------------
  function attachCardPointerHandlers(cardEl: HTMLElement, card: Card, origin: CardOrigin): void {
    cardEl.addEventListener('pointerdown', (e) => {
      if (drag) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      cardEl.setPointerCapture(e.pointerId);
      drag = {
        cardId: card.id,
        from: origin,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        started: false,
        ghost: null,
        hoverSlot: null,
        overHand: false,
        slotPreviewTimer: null,
      };
    });

    cardEl.addEventListener('pointermove', (e) => {
      if (!drag || drag.pointerId !== e.pointerId || drag.cardId !== card.id) return;
      if (!drag.started) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
        startDrag(cardEl, card, e);
      }
      moveDrag(e);
    });

    cardEl.addEventListener('pointerup', (e) => {
      if (!drag || drag.pointerId !== e.pointerId || drag.cardId !== card.id) return;
      const d = drag;
      if (!d.started) {
        drag = null;
        handleCardTap(card, origin);
        return;
      }
      const hoverSlot = d.hoverSlot;
      const overHand = d.overHand;
      cleanupDrag();
      if (hoverSlot) {
        store?.place(d.cardId, hoverSlot); // notifie → re-render
        // Relâchée sur son propre slot (ou un slot verrouillé) : place()
        // no-op sans notification — on efface quand même les halos/deltas.
        if (store) applyActiveFeedback(store.getState());
      } else if (overHand && d.from.kind === 'board') {
        store?.removeFromSlot(d.from.slot); // notifie → re-render
      } else {
        rerender(); // pas de cible : la carte « revient » simplement
      }
    });

    cardEl.addEventListener('pointercancel', (e) => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      cleanupDrag();
      rerender();
    });

    cardEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleCardTap(card, origin);
      }
    });
  }

  function startDrag(sourceEl: HTMLElement, card: Card, e: PointerEvent): void {
    if (!drag) return;
    drag.started = true;
    ui.selectedCardId = null;
    clearHandPreviewTimer();
    stopPreviewIfReady();

    const ghost = createCardElement(card);
    ghost.classList.add('card--ghost');
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    sourceEl.classList.add('card--drag-source');
    positionGhost(e);
    if (store) applyActiveFeedback(store.getState());
  }

  function positionGhost(e: PointerEvent): void {
    const ghost = drag?.ghost;
    if (!ghost) return;
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
  }

  function moveDrag(e: PointerEvent): void {
    if (!drag?.started) return;
    positionGhost(e);

    // Pointer capture : les cibles ne reçoivent pas d'events → hit-test manuel.
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const slotEl = hit ? hit.closest<HTMLElement>('[data-slot]') : null;
    const rawSlot = slotEl?.dataset['slot'];
    const activeSlots = store?.getState().activeSlots ?? [];
    const slot = activeSlots.find((s) => s === rawSlot) ?? null; // les slots verrouillés ne sont pas des cibles
    const overHand = hit !== null && hit.closest('[data-hand-zone]') !== null;

    if (slot !== drag.hoverSlot) {
      drag.hoverSlot = slot;
      clearSlotPreviewTimer();
      if (slot) {
        // Preview du stem de la carte traînée POUR le slot ciblé (GDD §5).
        if (ui.audioStatus === 'ready' && !ui.muted) {
          const cardId = drag.cardId;
          drag.slotPreviewTimer = window.setTimeout(() => {
            if (drag?.hoverSlot === slot) audio.previewCard(cardId, slot);
          }, PREVIEW_DELAY_MS);
        }
      } else {
        stopPreviewIfReady();
      }
      if (store) applyActiveFeedback(store.getState());
    }

    if (overHand !== drag.overHand) {
      drag.overHand = overHand;
      const handEl = root.querySelector('[data-hand-zone]');
      handEl?.classList.toggle('hand--drop-target', overHand && drag.from.kind === 'board');
    }
  }

  function clearSlotPreviewTimer(): void {
    if (drag?.slotPreviewTimer != null) {
      window.clearTimeout(drag.slotPreviewTimer);
      drag.slotPreviewTimer = null;
    }
  }

  function cleanupDrag(): void {
    clearSlotPreviewTimer();
    stopPreviewIfReady();
    drag?.ghost?.remove();
    root.querySelectorAll('.card--drag-source').forEach((n) => n.classList.remove('card--drag-source'));
    root.querySelector('[data-hand-zone]')?.classList.remove('hand--drop-target');
    drag = null;
  }

  // --- Preview sonore au survol de la main (GDD §5 ✅) -----------------------
  function attachHandPreviewHandlers(cardEl: HTMLElement, card: Card): void {
    cardEl.addEventListener('pointerenter', () => {
      if (drag?.started) return; // pendant un drag, la preview suit le slot ciblé
      clearHandPreviewTimer();
      handPreviewTimer = window.setTimeout(() => {
        handPreviewTimer = null;
        if (ui.audioStatus === 'ready' && !ui.muted && !drag?.started) {
          audio.previewCard(card.id, 'lead');
        }
      }, PREVIEW_DELAY_MS);
    });
    cardEl.addEventListener('pointerleave', () => {
      clearHandPreviewTimer();
      if (!drag?.started) stopPreviewIfReady();
    });
  }

  // --- Actions globales -------------------------------------------------------
  function onToggleMute(): void {
    ui.muted = !ui.muted;
    if (ui.audioStatus === 'ready') audio.setMuted(ui.muted);
    rerender();
  }

  function onDrop(): void {
    if (!store?.canDrop()) return;
    ui.selectedCardId = null;
    store.drop(); // notifie → modal de score (le mix continue de tourner)
  }

  // --- Démarrage ----------------------------------------------------------------
  renderMeta();
}
