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
  type ConditionFilter,
  type Energy,
  type GameState,
  type GameStore,
  type Recipe,
  type RecipeCondition,
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
import { createCardElement, genreShapePicto } from './card-view';
import { formatPoints } from './format';
import { renderBreakdownLines } from './score-panel';
import {
  renderCelebration,
  renderFailedScreen,
  renderSceneIntro,
  renderScoredModal,
  renderShop,
  renderTitleScreen,
  renderTourEnd,
  type AudioStatus,
  type TourStatus,
} from './screens';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** En deçà, un pointerdown+up est un clic (sélection) ; au-delà, un drag. */
const DRAG_THRESHOLD_PX = 8;

/** Les 6 paires de slots — les liens dessinés sur le plateau (GDD §5/§7). */
const PAIR_SLOTS: [SlotId, SlotId][] = [
  ['rythme', 'basse'],
  ['rythme', 'harmonie'],
  ['rythme', 'lead'],
  ['basse', 'harmonie'],
  ['basse', 'lead'],
  ['harmonie', 'lead'],
];
/** Délai avant preview sonore au survol (GDD §5 : aperçu, pas d'écoute forcée). */
const PREVIEW_DELAY_MS = 300;

type CardOrigin = { kind: 'hand' } | { kind: 'board'; slot: SlotId };

/** Écrans hors set — quand aucun GameStore n'est actif. */
type MetaPhase = 'title' | 'intro' | 'celebration' | 'shop' | 'failed' | 'tour-ended';

interface DragState {
  cardId: string;
  from: CardOrigin;
  pointerId: number;
  startX: number;
  startY: number;
  started: boolean;
  ghost: HTMLElement | null;
  hoverSlot: SlotId | null;
  /** Survol de la pioche/défausse (drag down d'une carte de MAIN = échange). */
  overDiscard: boolean;
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
  /** Horloge du public : 1 drain d'attention par mesure en phase playing. */
  let attentionTimer: number | null = null;
  const MEASURE_MS = (4 * 60 * 1000) / AUDIO_CONFIG.bpm;

  // --- État purement UI (hors stores) ---------------------------------------
  const ui = {
    audioStatus: 'idle' as AudioStatus,
    muted: false,
    selectedCardId: null as string | null,
    panelOpen: window.matchMedia('(min-width: 900px)').matches,
    /** Message transitoire (refus de destruction…), affiché au pied de page. */
    notice: null as string | null,
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

  /** L'envie de la requête courante est-elle SECRÈTE (mastermind tout-ou-rien) ? */
  function isSecretRequest(state: GameState): boolean {
    return currentScene().requests[state.requestIndex]?.secret === true;
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
      return { recipe, slots: req.slots, secret: req.secret === true };
    });
    totalRequests = plan.length;
    store = createGame({
      data,
      rules,
      config: GAME_CONFIG,
      plan,
      deckIds: [...save.ownedCardIds],
      attentionMax: scene.attention ?? GAME_CONFIG.attentionMax,
    });
    unsubscribe = store.subscribe(onStateChange);
    store.startSet();
    startAttentionClock();
  }

  // --- Horloge d'attention (la musique est le chronomètre) ------------------
  function startAttentionClock(): void {
    stopAttentionClock();
    attentionTimer = window.setInterval(() => {
      if (!store) return;
      // tickAttention est silencieux (pas de re-render : un drag en cours ne
      // doit pas être interrompu) sauf au passage à zéro → notify → failed.
      const value = store.tickAttention();
      updateAttentionDom(value);
    }, MEASURE_MS);
  }

  function stopAttentionClock(): void {
    if (attentionTimer !== null) {
      window.clearInterval(attentionTimer);
      attentionTimer = null;
    }
  }

  /** Met à jour la jauge SANS re-render (appelé à chaque tick d'horloge). */
  function updateAttentionDom(value: number): void {
    const max = store?.getState().attentionMax ?? GAME_CONFIG.attentionMax;
    const fill = root.querySelector<HTMLElement>('.attention__fill');
    const label = root.querySelector<HTMLElement>('.attention__value');
    if (!fill || !label) return;
    applyAttentionDom(fill, label, value, max);
  }

  function applyAttentionDom(fill: HTMLElement, label: HTMLElement, value: number, max: number): void {
    const ratio = max > 0 ? value / max : 0;
    fill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
    fill.classList.toggle('attention__fill--warn', ratio <= 0.5 && ratio > 0.25);
    fill.classList.toggle('attention__fill--low', ratio <= 0.25);
    label.textContent = String(value);
  }

  /** Jauge à zéro : le public s'en va — concert raté, la scène se rejoue. */
  function handleSceneFailed(): void {
    stopAttentionClock();
    unsubscribe?.();
    unsubscribe = null;
    store = null;
    if (ui.audioStatus === 'ready') {
      audio.setDucked(false);
      audio.clearAllSlots(); // silence : la salle est vide
    }
    meta = 'failed';
    renderMeta();
  }

  /** Fin de set : fige le résultat, crédite la tournée, célèbre. */
  function handleSceneEnd(state: GameState): void {
    const scene = currentScene();
    stopAttentionClock();
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
      case 'failed':
        root.appendChild(renderFailedScreen(currentScene(), () => startScene()));
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
            root.appendChild(
              renderScoredModal(result, data, isLast, isSecretRequest(state), () => store?.nextRequest()),
            );
          }
        }
        break;
      }
      case 'ended':
      case 'failed':
        // Gérés par handleSceneEnd/handleSceneFailed (transition méta) — jamais rendus ici.
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
    if (state.phase === 'failed') {
      handleSceneFailed();
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
    main.appendChild(renderScorePanel(state, breakdown));
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

    // Jauge d'attention du public — pleine largeur, mise à jour par l'horloge
    // sans re-render (updateAttentionDom).
    const attention = el('div', 'attention');
    attention.title = 'Attention du public : à zéro, la salle se vide et le concert est raté.';
    attention.appendChild(el('span', 'attention__icon', '👥'));
    const bar = el('div', 'attention__bar');
    const fill = el('div', 'attention__fill');
    bar.appendChild(fill);
    attention.appendChild(bar);
    const value = el('span', 'attention__value');
    attention.appendChild(value);
    applyAttentionDom(fill, value, state.attention, state.attentionMax);
    hud.appendChild(attention);

    const request = el('div', 'hud__request');
    request.appendChild(
      el(
        'div',
        'hud__request-index',
        `${scene.name} · Requête ${state.requestIndex + 1}/${totalRequests}`,
      ),
    );
    if (recipe) {
      const secret = isSecretRequest(state);
      const nameRow = el('div', 'hud__recipe');
      nameRow.appendChild(el('span', 'hud__recipe-name', secret ? '« ??? »' : `« ${recipe.name} »`));
      nameRow.appendChild(el('span', 'hud__recipe-difficulty', secret ? 'Envie secrète' : recipe.difficulty));
      request.appendChild(nameRow);
      if (secret) {
        // Mastermind tout-ou-rien : RIEN de l'envie n'est affiché — le public
        // réagit à chaque pose, à toi de le lire.
        request.appendChild(
          el('div', 'hud__flavor', 'Le public a une idée derrière la tête. Pose, et observe ses réactions…'),
        );
        const conds = el('ul', 'hud__conditions');
        const li = el('li', 'hud__condition hud__condition--secret');
        li.appendChild(el('span', 'hud__condition-state', '❓'));
        li.appendChild(el('span', 'hud__condition-label', 'Envie secrète — devine-la aux réactions'));
        conds.appendChild(li);
        request.appendChild(conds);
      } else {
        if (recipe.flavor) request.appendChild(el('div', 'hud__flavor', recipe.flavor));
        // Conditions évaluées EN DIRECT sur le plateau courant — la consigne se
        // lit d'abord en pictogrammes (formes = Genres, couleurs = Énergies,
        // le même vocabulaire que les cartes), le texte confirme.
        const conds = el('ul', 'hud__conditions');
        recipe.conditions.forEach((cond, i) => {
          const met = breakdown?.conditions.find((c) => c.index === i)?.met ?? false;
          const li = el('li', `hud__condition ${met ? 'is-met' : 'is-unmet'}`);
          li.appendChild(el('span', 'hud__condition-state', met ? '✓' : '○'));
          const picto = conditionPicto(cond);
          if (picto) li.appendChild(picto);
          li.appendChild(el('span', 'hud__condition-label', rules.conditionLabel(cond)));
          conds.appendChild(li);
        });
        request.appendChild(conds);
      }
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

  // --- Consigne en pictogrammes ---------------------------------------------
  function energyDot(energy: Energy): HTMLElement {
    const dot = el('span', 'picto-dot');
    dot.dataset['energy'] = energy;
    return dot;
  }

  function filterPictos(filter: ConditionFilter): HTMLElement {
    const wrap = el('span', 'hud__picto-group');
    const energies = filter.energy ?? [];
    if (filter.genre && filter.genre.length > 0) {
      // Une seule énergie dans le filtre : elle colore directement les formes.
      const single = energies.length === 1 ? energies[0] : undefined;
      for (const genre of filter.genre) wrap.appendChild(genreShapePicto(genre, single));
      if (energies.length > 1) for (const e of energies) wrap.appendChild(energyDot(e));
    } else {
      for (const e of energies) wrap.appendChild(energyDot(e));
    }
    return wrap;
  }

  /** Pictogramme d'une condition (null : le texte seul reste plus clair). */
  function conditionPicto(cond: RecipeCondition): HTMLElement | null {
    switch (cond.type) {
      case 'min_count': {
        const box = el('span', 'hud__condition-picto');
        box.appendChild(el('span', 'hud__picto-count', `≥${cond.count}`));
        box.appendChild(filterPictos(cond.filter));
        return box;
      }
      case 'none': {
        const box = el('span', 'hud__condition-picto hud__condition-picto--none');
        box.appendChild(el('span', 'hud__picto-count', '0×'));
        box.appendChild(filterPictos(cond.filter));
        return box;
      }
      default:
        return null; // all_same_genre / all_different_genres : texte explicite
    }
  }

  // --- Liens entre disques posés (GDD §5/§7 : le conflit visible) -----------
  /** Point de sortie du bord de `from` en direction du centre de `to`. */
  function edgePoint(from: DOMRect, to: DOMRect, origin: DOMRect): { x: number; y: number } {
    const cx = from.left + from.width / 2 - origin.left;
    const cy = from.top + from.height / 2 - origin.top;
    const dx = to.left + to.width / 2 - origin.left - cx;
    const dy = to.top + to.height / 2 - origin.top - cy;
    const sx = dx !== 0 ? from.width / 2 / Math.abs(dx) : Infinity;
    const sy = dy !== 0 ? from.height / 2 / Math.abs(dy) : Infinity;
    const t = Math.min(sx, sy);
    return { x: cx + dx * t, y: cy + dy * t };
  }

  /**
   * Dessine les AFFINITÉS entre disques posés : segments dans les gouttières
   * du plateau (les deux diagonales se croisent au centre — la « croix »).
   * Trait plein = même Forme (construit les mains), pointillé = même Couleur
   * (construit les camaïeux). Pas de badge chiffré : la grammaire des mains
   * rend le lien lisible sans arithmétique (retour playtest #4 : « chargé »).
   */
  function renderBoardLinks(board: HTMLElement, state: GameState): void {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.classList.add('board-links');
    svg.setAttribute('aria-hidden', 'true');
    board.appendChild(svg);
    // Les positions exigent un layout accompli : mesure au frame suivant.
    requestAnimationFrame(() => {
      if (!svg.isConnected) return;
      const origin = board.getBoundingClientRect();
      if (origin.width === 0) return;
      svg.setAttribute('viewBox', `0 0 ${origin.width} ${origin.height}`);
      for (const [slotA, slotB] of PAIR_SLOTS) {
        if (!state.activeSlots.includes(slotA) || !state.activeSlots.includes(slotB)) continue;
        const idA = state.board[slotA];
        const idB = state.board[slotB];
        if (!idA || !idB) continue;
        const cardA = cardOf(idA);
        const cardB = cardOf(idB);
        const elA = board.querySelector(`.slot[data-slot="${slotA}"]`);
        const elB = board.querySelector(`.slot[data-slot="${slotB}"]`);
        if (!cardA || !cardB || !elA || !elB) continue;

        const affinity = rules.cardAffinity(cardA, cardB);
        if (!affinity.sameGenre && !affinity.sameEnergy) continue; // pas de lien = pas de trait
        const cls = affinity.sameGenre && affinity.sameEnergy
          ? 'link--both'
          : affinity.sameGenre
            ? 'link--genre'
            : 'link--energy';

        const p1 = edgePoint(elA.getBoundingClientRect(), elB.getBoundingClientRect(), origin);
        const p2 = edgePoint(elB.getBoundingClientRect(), elA.getBoundingClientRect(), origin);
        const group = document.createElementNS(SVG_NS, 'g');
        group.setAttribute('class', `board-link ${cls}`);
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', String(p1.x));
        line.setAttribute('y1', String(p1.y));
        line.setAttribute('x2', String(p2.x));
        line.setAttribute('y2', String(p2.y));
        group.appendChild(line);
        svg.appendChild(group);
      }
    });
  }

  function renderBoard(state: GameState, breakdown: ScoreBreakdown | null): HTMLElement {
    const board = el('section', 'board');
    board.setAttribute('aria-label', 'Plateau de mix');

    // Feedback visuel du mix (GDD §5) : tremblement si une aversion du public
    // est violée, liseré harmonieux quand l'envie est entièrement servie —
    // MASQUÉ en mode secret (ce serait la réponse gratuite du mastermind).
    const secret = isSecretRequest(state);
    if (breakdown && !secret) {
      if (breakdown.aversionsViolated > 0) {
        board.classList.add('board--dissonant');
        const amp = Math.min(UI_FEEDBACK.shakeMaxPx, UI_FEEDBACK.shakePxPerPoint * 2 * breakdown.aversionsViolated);
        board.style.setProperty('--shake-amp', `${amp.toFixed(2)}px`);
      } else if (breakdown.multiplier >= 2 && breakdown.base > 0) {
        board.classList.add('board--harmonious');
      }
    }

    for (const slot of SLOT_IDS) board.appendChild(renderSlot(state, slot));
    renderBoardLinks(board, state);
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
      // Nouvelle boucle : posé = posé. Pas de retour en main — la carte ne
      // quitte la platine que remplacée (détruite) ou déplacée vers un autre slot.
      const cardEl = createCardElement(card, { stemDescription: card.slots[slot].description });
      cardEl.dataset['key'] = `card-${card.id}`;
      if (ui.selectedCardId === card.id) cardEl.classList.add('card--selected');
      attachCardPointerHandlers(cardEl, card, { kind: 'board', slot });
      wrap.appendChild(cardEl);
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

  function renderScorePanel(state: GameState, breakdown: ScoreBreakdown | null): HTMLElement {
    const secret = isSecretRequest(state);
    const details = el('details', 'score-panel');
    details.open = ui.panelOpen;
    details.addEventListener('toggle', () => {
      ui.panelOpen = details.open; // mémorisé sans re-render (état natif <details>)
    });
    // L'annonce de main est le résumé : « BRELAN TECHNO » se lit sans ouvrir.
    const headline = breakdown && breakdown.handKind !== 'none' ? breakdown.handLabel.toUpperCase() : 'Aucune main';
    const scorePart = secret ? 'verdict ❓' : `${breakdown?.total ?? 0} pts`;
    const summary = el('summary', 'score-panel__summary', `${headline} — ${scorePart}`);
    summary.dataset['key'] = 'panel';
    details.appendChild(summary);
    if (breakdown) {
      details.appendChild(renderBreakdownLines(breakdown, { secretHidden: secret }));
      const discValue = placedCards(state).reduce((acc, c) => acc + c.value, 0);
      details.appendChild(
        el('p', 'score-panel__hint', `💿 Valeur des disques posés : +${discValue} pts au set (au drop).`),
      );
    } else {
      details.appendChild(el('p', 'score-panel__hint', 'Pose des cartes pour voir la main et le verdict.'));
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

    if (ui.notice) footer.appendChild(el('div', 'footer__notice', ui.notice));

    // Pioche + échanges : la zone est la CIBLE du drag-down d'une carte de
    // main (défausse destructrice + repioche, dans la limite des échanges).
    const pile = el('div', 'pile');
    pile.dataset['discardZone'] = '1';
    const canMulligan = state.mulligansLeft > 0 && state.deck.length > 0;
    if (!canMulligan) pile.classList.add('pile--exhausted');
    pile.appendChild(el('span', 'pile__deck', `🂠 Pioche : ${state.deck.length}`));
    pile.appendChild(
      el(
        'span',
        'pile__mulligans',
        `Échanges : ${'●'.repeat(state.mulligansLeft)}${'○'.repeat(Math.max(0, GAME_CONFIG.mulligansPerSet - state.mulligansLeft))}`,
      ),
    );
    pile.appendChild(
      el(
        'span',
        'pile__hint',
        canMulligan
          ? 'Glisse ici un disque de ta main pour l’échanger'
          : state.mulligansLeft <= 0
            ? 'Plus d’échange possible ce concert'
            : 'Pioche vide — plus rien à échanger',
      ),
    );
    footer.appendChild(pile);

    const hand = el('div', 'hand');
    hand.setAttribute('aria-label', 'Main');
    for (const id of state.hand) {
      const card = cardOf(id);
      if (!card) continue;
      // Format compact (retour playtest #4) : forme + couleur + valeur —
      // la main se scanne d'un coup d'œil et tient sur une ligne.
      const cardEl = createCardElement(card, { compact: true });
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
  /** Halo d'affinité : même Forme (main) prime sur même Couleur (camaïeu). */
  function haloClass(active: Card, other: Card): string | null {
    const affinity = rules.cardAffinity(active, other);
    if (affinity.sameGenre) return 'halo--good';
    if (affinity.sameEnergy) return 'halo--energy';
    return null;
  }

  /**
   * Applique halos + deltas pour la « carte active » (traînée ou sélectionnée).
   * Purement additif au DOM rendu : appelé après chaque render et à chaque
   * changement de slot survolé pendant un drag.
   */
  function applyActiveFeedback(state: GameState): void {
    root.querySelectorAll('.halo--good, .halo--bad, .halo--energy').forEach((n) => {
      n.classList.remove('halo--good', 'halo--bad', 'halo--energy');
    });
    root.querySelectorAll('.slot--target').forEach((n) => n.classList.remove('slot--target'));
    root.querySelectorAll('.slot__delta').forEach((n) => n.remove());

    if (state.phase !== 'playing') return;
    const recipe = store?.currentRecipe() ?? null;
    const activeId = drag?.started ? drag.cardId : ui.selectedCardId;
    if (!recipe || !activeId) return;
    const active = cardOf(activeId);
    if (!active) return;

    // Halo d'affinité sur chaque carte déjà posée (forme prime sur couleur).
    for (const slot of state.activeSlots) {
      const id = state.board[slot];
      if (!id || id === activeId) continue;
      const other = cardOf(id);
      if (!other) continue;
      const cls = haloClass(active, other);
      if (cls) root.querySelector(`.slot[data-slot="${slot}"] .card`)?.classList.add(cls);
    }

    // Delta hypothétique : le slot survolé en drag, tous les slots ACTIFS en
    // sélection. MASQUÉ en mode secret : le chiffre résoudrait le mastermind
    // par l'arithmétique — seules les réactions du public parlent.
    if (isSecretRequest(state)) {
      if (drag?.started && drag.hoverSlot) {
        root.querySelector(`.slot[data-slot="${drag.hoverSlot}"]`)?.classList.add('slot--target');
      }
      return;
    }
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

  // --- Pose avec réaction du public --------------------------------------
  // La boussole ET le canal d'information du mastermind (playtest #4) : la
  // réaction reflète L'ENVIE du public — c'est en la lisant qu'on devine une
  // envie secrète. Priorité : conditions gagnées/perdues, puis la main.

  type PoseKind = 'good' | 'bad' | 'meh' | 'neutral';

  function poseReaction(state: GameState, card: Card, slot: SlotId): PoseKind {
    const recipe = store?.currentRecipe() ?? null;
    if (!recipe) return 'neutral';
    const before = evaluatePlaced(state, recipe);
    // Plateau hypothétique avec la carte posée (même sémantique que place()).
    const board: Record<SlotId, string | null> = { ...state.board };
    const sourceSlot = SLOT_IDS.find((s) => board[s] === card.id);
    if (sourceSlot !== undefined) board[sourceSlot] = board[slot];
    board[slot] = card.id;
    const after = evaluatePlaced({ ...state, board }, recipe);
    if (!after) return 'neutral';

    const metBefore = before?.conditionsMet ?? 0;
    const aversionsBefore = before?.aversionsViolated ?? 0;
    // L'envie d'abord : elle progresse → le public s'enthousiasme ; elle
    // recule (ou une aversion est violée) → il grimace.
    if (after.conditionsMet > metBefore) return 'good';
    if (after.conditionsMet < metBefore || after.aversionsViolated > aversionsBefore) return 'bad';
    // À envie constante : la main qui s'améliore plaît, le reste laisse froid.
    const baseBefore = before?.base ?? 0;
    if (after.base > baseBefore) return 'good';
    if (after.base < baseBefore) return 'meh';
    return 'meh';
  }

  const EMOTES: Record<Exclude<PoseKind, 'neutral'>, string[]> = {
    good: ['🕺', '💃', '🙌', '👏'],
    bad: ['😡', '🙈', '😬'],
    meh: ['😐', '🤷', '🥱'],
  };

  /** Émote flottante au-dessus du slot — spawn APRÈS le re-render de la pose. */
  function spawnEmote(slot: SlotId, kind: PoseKind): void {
    if (kind === 'neutral') return;
    const slotEl = root.querySelector(`.slot[data-slot="${slot}"]`);
    if (!slotEl) return;
    const pool = EMOTES[kind];
    const emote = el('div', `emote emote--${kind}`, pool[Math.floor(Math.random() * pool.length)]);
    emote.addEventListener('animationend', () => emote.remove());
    slotEl.appendChild(emote);
  }

  /** Message transitoire (ex. refus de destruction), affiché dans le pied de page. */
  let noticeTimer: number | null = null;
  function showNotice(text: string): void {
    ui.notice = text;
    if (noticeTimer !== null) window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
      noticeTimer = null;
      ui.notice = null;
      rerender();
    }, 2600);
    rerender();
  }

  /** Pose + réaction du public (stinger + émote). Point d'entrée unique. */
  function placeWithFeedback(cardId: string, slot: SlotId): void {
    const state = store?.getState();
    if (!state) return;
    const card = cardOf(cardId);
    // Remplacement refusé par le garde anti-soft-lock : expliquer, pas ignorer.
    if (
      state.board[slot] !== null &&
      state.hand.includes(cardId) &&
      (store?.destructionLocked() ?? false)
    ) {
      showNotice('🛑 Remplacer détruirait un disque — et il t’en faut assez pour finir la scène !');
      return;
    }
    const kind = card ? poseReaction(state, card, slot) : 'neutral';
    const before = store?.getState().board[slot];
    store?.place(cardId, slot); // notifie → re-render synchrone
    const after = store?.getState().board[slot];
    if (after === cardId && before !== cardId) {
      if (ui.audioStatus === 'ready' && !ui.muted) audio.playPoseFeedback(kind);
      spawnEmote(slot, kind);
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
      placeWithFeedback(selected, origin.slot);
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
    placeWithFeedback(selected, slot);
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
        overDiscard: false,
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
      const overDiscard = d.overDiscard;
      cleanupDrag();
      if (hoverSlot) {
        placeWithFeedback(d.cardId, hoverSlot);
        // Relâchée sur son propre slot (ou un slot verrouillé) : place()
        // no-op sans notification — on efface quand même les halos/deltas.
        if (store) applyActiveFeedback(store.getState());
      } else if (overDiscard && d.from.kind === 'hand') {
        store?.discard(d.cardId); // échange de main (no-op sans mulligan) → re-render
        if (store) applyActiveFeedback(store.getState());
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
    // La défausse n'accepte que les cartes de MAIN, et seulement s'il reste un échange.
    const dragState = store?.getState();
    const overDiscard =
      hit !== null &&
      hit.closest('[data-discard-zone]') !== null &&
      drag.from.kind === 'hand' &&
      (dragState?.mulligansLeft ?? 0) > 0 &&
      (dragState?.deck.length ?? 0) > 0;

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

    if (overDiscard !== drag.overDiscard) {
      drag.overDiscard = overDiscard;
      root.querySelector('[data-discard-zone]')?.classList.toggle('pile--drop-target', overDiscard);
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
    root.querySelector('[data-discard-zone]')?.classList.remove('pile--drop-target');
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
