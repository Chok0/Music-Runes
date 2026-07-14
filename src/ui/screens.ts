/** Écrans hors plateau : titre, score de requête (modal), fin de set. */
import type { GameData, RequestResult } from '../types';
import { button, el } from './dom';
import { formatPoints, starsText } from './format';
import { renderBreakdownLines } from './score-panel';

export type AudioStatus = 'idle' | 'loading' | 'ready' | 'failed';

export function renderTitleScreen(audioStatus: AudioStatus, onStart: () => void): HTMLElement {
  const screen = el('div', 'screen screen--title');
  const box = el('div', 'title-box');
  box.appendChild(el('h1', 'title-box__name', 'Music Runes'));
  box.appendChild(el('p', 'title-box__subtitle', '(nom provisoire)'));
  box.appendChild(
    el(
      'p',
      'title-box__pitch',
      'Un deckbuilder musical où l’on compose des mix en temps réel en posant des cartes-samples ' +
        'sur des slots limités, avec des synergies cachées à découvrir.',
    ),
  );
  const start = button(
    'btn btn--primary title-box__start',
    audioStatus === 'loading' ? '⏳ Chargement des sons…' : '▶ Commencer le set',
    onStart,
  );
  start.dataset['key'] = 'start';
  start.disabled = audioStatus === 'loading';
  box.appendChild(start);
  box.appendChild(
    el('p', 'title-box__hint', 'La forme d’une carte dit son Genre, sa couleur son Énergie — pas besoin d’oreille musicale.'),
  );
  screen.appendChild(box);
  return screen;
}

export function renderScoredModal(
  result: RequestResult,
  data: GameData,
  isLast: boolean,
  onNext: () => void,
): HTMLElement {
  const overlay = el('div', 'modal-overlay');
  const modal = el('div', 'modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const recipe = data.recipeById.get(result.recipeId);
  modal.appendChild(el('h2', 'modal__title', recipe ? `« ${recipe.name} »` : 'Requête'));
  modal.appendChild(el('div', 'modal__stars', starsText(result.stars)));
  modal.appendChild(
    el('div', 'modal__score', `score ${result.breakdown.total} / max théorique ${result.theoreticalMax}`),
  );

  const summary = el('ul', 'modal__summary');
  summary.appendChild(el('li', 'modal__summary-item', `${formatPoints(result.breakdown.coherence)} cohérence`));
  summary.appendChild(el('li', 'modal__summary-item', `${formatPoints(result.breakdown.objective)} objectif`));
  if (result.breakdown.audaciousApplied) {
    summary.appendChild(
      el('li', 'modal__summary-item modal__summary-item--dare', `${formatPoints(result.breakdown.audacious)} résolution audacieuse`),
    );
  }
  modal.appendChild(summary);

  modal.appendChild(renderBreakdownLines(result.breakdown, data));
  modal.appendChild(el('p', 'modal__note', 'Le mix continue de tourner pendant que tu lis ton score.'));

  const next = button('btn btn--primary modal__next', isLast ? 'Voir le score du set ▶' : 'Requête suivante ▶', onNext);
  next.dataset['key'] = 'next';
  modal.appendChild(next);

  overlay.appendChild(modal);
  return overlay;
}

export function renderEndedScreen(
  results: RequestResult[],
  data: GameData,
  setScore: number,
  onReplay: () => void,
): HTMLElement {
  const screen = el('div', 'screen screen--ended');
  const box = el('div', 'ended-box');
  box.appendChild(el('h1', 'ended-box__title', 'Fin du set'));

  const list = el('ul', 'ended-box__list');
  results.forEach((r, i) => {
    const recipe = data.recipeById.get(r.recipeId);
    const li = el('li', 'ended-box__row');
    li.appendChild(el('span', 'ended-box__request', `${i + 1}. ${recipe?.name ?? r.recipeId}`));
    li.appendChild(el('span', 'ended-box__stars', starsText(r.stars)));
    li.appendChild(el('span', 'ended-box__points', `${r.breakdown.total} pts`));
    list.appendChild(li);
  });
  box.appendChild(list);

  box.appendChild(el('div', 'ended-box__total', `Valeur du set : ${setScore} pts`));

  const replay = button('btn btn--primary', '↻ Rejouer', onReplay);
  replay.dataset['key'] = 'replay';
  box.appendChild(replay);

  screen.appendChild(box);
  return screen;
}
