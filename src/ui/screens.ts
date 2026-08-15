/** Écrans hors plateau : titre, intro de scène, score de requête (modal),
 *  célébration de fin de scène, boutique, fin de tournée. */
import type { Card, GameData, RequestResult, Scene, SceneShop, TourSave } from '../types';
import { button, el } from './dom';
import { createCardElement } from './card-view';
import { starsText } from './format';
import { renderBreakdownLines } from './score-panel';

export type AudioStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** Où en est la tournée au moment d'afficher l'écran-titre. */
export interface TourStatus {
  kind: 'new' | 'in-progress' | 'finished';
  sceneNumber?: number;
  totalScenes: number;
  sceneName?: string;
}

export function renderTitleScreen(
  status: TourStatus,
  onPrimary: () => void,
  onReset: (() => void) | null,
): HTMLElement {
  const screen = el('div', 'screen screen--title');
  const box = el('div', 'title-box');
  box.appendChild(el('h1', 'title-box__name', 'Music Runes'));
  box.appendChild(el('p', 'title-box__subtitle', '(nom provisoire)'));
  box.appendChild(
    el(
      'p',
      'title-box__pitch',
      'Un robot musicien part en tournée. Compose ses mix en posant des cartes-samples, ' +
        'satisfais des publics de plus en plus exigeants, agrandis ta caisse de disques.',
    ),
  );

  const label =
    status.kind === 'new'
      ? '▶ Commencer la tournée'
      : status.kind === 'finished'
        ? '↻ Rejouer la tournée'
        : `▶ Continuer — Scène ${status.sceneNumber}/${status.totalScenes} : ${status.sceneName}`;
  const primary = button('btn btn--primary title-box__start', label, onPrimary);
  primary.dataset['key'] = 'start';
  box.appendChild(primary);

  if (onReset) {
    const reset = button('btn title-box__reset', 'Recommencer à zéro', onReset);
    reset.dataset['key'] = 'reset';
    box.appendChild(reset);
  }

  box.appendChild(
    el('p', 'title-box__hint', 'La forme d’une carte dit son Genre, sa couleur son Énergie — pas besoin d’oreille musicale.'),
  );
  screen.appendChild(box);
  return screen;
}

export function renderSceneIntro(args: {
  scene: Scene;
  sceneNumber: number;
  totalScenes: number;
  grantedCards: Card[];
  audioStatus: AudioStatus;
  onMountStage: () => void;
}): HTMLElement {
  const { scene, sceneNumber, totalScenes, grantedCards, audioStatus, onMountStage } = args;
  const screen = el('div', 'screen screen--intro');
  const box = el('div', 'intro-box');

  box.appendChild(el('p', 'intro-box__kicker', `Scène ${sceneNumber}/${totalScenes}`));
  box.appendChild(el('h1', 'intro-box__name', scene.name));
  box.appendChild(el('p', 'intro-box__flavor', scene.flavor));
  box.appendChild(
    el('p', 'intro-box__program', `${scene.requests.length} requête${scene.requests.length > 1 ? 's' : ''} · cachet garanti : ${scene.cachet} pts`),
  );

  if (grantedCards.length > 0) {
    box.appendChild(el('h2', 'intro-box__grants-title', '🎁 Nouveaux disques dans ta caisse'));
    const grid = el('div', 'card-grid');
    for (const card of grantedCards) grid.appendChild(createCardElement(card));
    box.appendChild(grid);
  }

  const start = button(
    'btn btn--primary intro-box__start',
    audioStatus === 'loading' ? '⏳ Chargement des sons…' : '▶ Monter sur scène',
    onMountStage,
  );
  start.dataset['key'] = 'mount-stage';
  start.disabled = audioStatus === 'loading';
  box.appendChild(start);

  screen.appendChild(box);
  return screen;
}

export function renderScoredModal(
  result: RequestResult,
  data: GameData,
  isLast: boolean,
  wasSecret: boolean,
  onNext: () => void,
): HTMLElement {
  const overlay = el('div', 'modal-overlay');
  const modal = el('div', 'modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const recipe = data.recipeById.get(result.recipeId);
  // Envie secrète : le drop est le moment de la RÉVÉLATION (mastermind).
  modal.appendChild(
    el('p', 'modal__kicker', wasSecret ? '🎭 L’envie secrète était…' : '✓ Requête terminée'),
  );
  modal.appendChild(el('h2', 'modal__title', recipe ? `« ${recipe.name} »` : 'Requête'));
  // L'annonce de main, en grand : la phrase que le joueur retient.
  if (result.breakdown.handKind !== 'none') {
    modal.appendChild(el('div', 'modal__hand', `${result.breakdown.handLabel.toUpperCase()} !`));
  }
  modal.appendChild(el('div', 'modal__stars', starsText(result.stars)));
  modal.appendChild(
    el('div', 'modal__score', `score ${result.breakdown.total} / max théorique ${result.theoreticalMax}`),
  );

  // La décomposition (main, couleurs, envie, verdict) est rendue par
  // renderBreakdownLines — l'envie est TOUJOURS révélée ici, même secrète.
  modal.appendChild(renderBreakdownLines(result.breakdown));
  modal.appendChild(
    el('div', 'modal__discs', `💿 Valeur des disques posés : +${result.discPoints} pts au set`),
  );
  modal.appendChild(el('p', 'modal__note', 'Le mix continue de tourner, en retrait, pendant que tu lis ton score.'));

  const next = button('btn btn--primary modal__next', isLast ? 'Finir la scène ▶' : 'Requête suivante ▶', onNext);
  next.dataset['key'] = 'next';
  modal.appendChild(next);

  overlay.appendChild(modal);
  return overlay;
}

/** Fin de scène : le moment d'accomplissement (applaudissements côté audio). */
export function renderCelebration(args: {
  scene: Scene;
  results: RequestResult[];
  data: GameData;
  setScore: number;
  wallet: number;
  grantCard: Card | null;
  onContinue: () => void;
}): HTMLElement {
  const { scene, results, data, setScore, wallet, grantCard, onContinue } = args;
  const screen = el('div', 'screen screen--ended');
  const box = el('div', 'ended-box');
  box.appendChild(el('p', 'ended-box__kicker', '👏 Le public applaudit'));
  box.appendChild(el('h1', 'ended-box__title', `${scene.name} — terminé !`));

  const list = el('ul', 'ended-box__list');
  results.forEach((r, i) => {
    const recipe = data.recipeById.get(r.recipeId);
    const li = el('li', 'ended-box__row');
    li.appendChild(el('span', 'ended-box__request', `${i + 1}. ${recipe?.name ?? r.recipeId}`));
    li.appendChild(el('span', 'ended-box__stars', starsText(r.stars)));
    li.appendChild(el('span', 'ended-box__points', `${r.breakdown.total + r.discPoints} pts`));
    list.appendChild(li);
  });
  box.appendChild(list);

  const gains = el('div', 'ended-box__gains');
  gains.appendChild(el('div', undefined, `Score du set : ${Math.max(0, setScore)} pts`));
  gains.appendChild(el('div', undefined, `Cachet du concert : +${scene.cachet} pts`));
  gains.appendChild(el('div', 'ended-box__total', `💿 Portefeuille : ${wallet} pts`));
  box.appendChild(gains);

  if (grantCard) {
    box.appendChild(el('p', 'ended-box__grant-flavor', scene.grant_on_end_flavor ?? 'On te tend un disque.'));
    const grid = el('div', 'card-grid');
    grid.appendChild(createCardElement(grantCard));
    box.appendChild(grid);
  }

  const next = button('btn btn--primary', 'Continuer ▶', onContinue);
  next.dataset['key'] = 'celebration-next';
  box.appendChild(next);

  screen.appendChild(box);
  return screen;
}

/** Boutique de fin de scène : choisir exactement 1 disque parmi les offres. */
export function renderShop(args: {
  shop: SceneShop;
  offers: Card[];
  wallet: number;
  onBuy: (cardId: string) => void;
}): HTMLElement {
  const { shop, offers, wallet, onBuy } = args;
  const screen = el('div', 'screen screen--shop');
  const box = el('div', 'shop-box');
  box.appendChild(el('p', 'shop-box__kicker', '🛒 Le disquaire ambulant'));
  box.appendChild(el('p', 'shop-box__intro', shop.intro));
  box.appendChild(el('p', 'shop-box__wallet', `💿 Portefeuille : ${wallet} pts · prix : ${shop.price} pts le disque`));

  const grid = el('div', 'shop-box__offers');
  for (const card of offers) {
    const offer = el('div', 'shop-offer');
    offer.appendChild(createCardElement(card));
    const buy = button('btn btn--primary shop-offer__buy', `Acheter · ${shop.price} pts`, () => onBuy(card.id));
    buy.dataset['key'] = `buy-${card.id}`;
    buy.disabled = wallet < shop.price;
    offer.appendChild(buy);
    grid.appendChild(offer);
  }
  box.appendChild(grid);
  box.appendChild(el('p', 'shop-box__hint', 'Choisis bien : le disquaire ne vend qu’un disque par visite.'));

  screen.appendChild(box);
  return screen;
}

/** Jauge d'attention vide : le public s'en va, le concert est raté. */
export function renderFailedScreen(scene: Scene, onRetry: () => void): HTMLElement {
  const screen = el('div', 'screen screen--ended screen--failed');
  const box = el('div', 'ended-box');
  box.appendChild(el('p', 'ended-box__kicker ended-box__kicker--failed', '🚪 Le public s’en va…'));
  box.appendChild(el('h1', 'ended-box__title', `${scene.name} — concert raté`));
  box.appendChild(
    el(
      'p',
      'ended-box__epilogue',
      'La jauge d’attention est tombée à zéro : la salle s’est vidée. Pas de cachet, pas de disque — mais la tournée continue : ce concert peut être rejoué.',
    ),
  );
  const retry = button('btn btn--primary', '↻ Rejouer la scène', onRetry);
  retry.dataset['key'] = 'retry';
  box.appendChild(retry);
  screen.appendChild(box);
  return screen;
}

export function renderTourEnd(args: {
  data: GameData;
  save: TourSave;
  onReplay: () => void;
}): HTMLElement {
  const { data, save, onReplay } = args;
  const screen = el('div', 'screen screen--ended');
  const box = el('div', 'ended-box');
  box.appendChild(el('p', 'ended-box__kicker', '🤖 Fin de la tournée'));
  box.appendChild(el('h1', 'ended-box__title', 'Le robot salue.'));
  box.appendChild(
    el(
      'p',
      'ended-box__epilogue',
      `${save.ownedCardIds.length} disques dans la caisse sur ${data.cards.length}, et ${save.wallet} pts en poche. Le chat du garage serait fier.`,
    ),
  );

  box.appendChild(el('h2', 'ended-box__collection-title', 'Ta collection'));
  const grid = el('div', 'card-grid');
  for (const id of save.ownedCardIds) {
    const card = data.cardById.get(id);
    if (card) grid.appendChild(createCardElement(card));
  }
  box.appendChild(grid);

  const replay = button('btn btn--primary', '↻ Repartir en tournée', onReplay);
  replay.dataset['key'] = 'replay';
  box.appendChild(replay);

  screen.appendChild(box);
  return screen;
}
