/**
 * Décomposition d'un ScoreBreakdown v2 « Verdict du public » ligne par ligne
 * (exigence GDD §4 : le joueur doit comprendre POURQUOI il score).
 * Réutilisée par le panneau « score en direct » et par le récap de requête.
 */
import type { ScoreBreakdown } from '../types';
import { el } from './dom';
import { formatPoints } from './format';

export interface BreakdownViewOptions {
  /**
   * Envie SECRÈTE non révélée (mode jeu) : les conditions, le multiplicateur
   * et le total sont masqués — seules la main et les couleurs (objectives,
   * lisibles sur le plateau) restent affichées. Le verdict tombe au drop.
   */
  secretHidden?: boolean;
}

function row(tone: string, label: string, points: string): HTMLElement {
  const r = el('div', `breakdown__row breakdown__row--${tone}`);
  r.appendChild(el('span', 'breakdown__label', label));
  r.appendChild(el('span', 'breakdown__points', points));
  return r;
}

export function renderBreakdownLines(
  breakdown: ScoreBreakdown,
  opts: BreakdownViewOptions = {},
): HTMLElement {
  const box = el('div', 'breakdown');

  const handSection = el('div', 'breakdown__section');
  handSection.appendChild(el('h3', 'breakdown__heading', 'Main'));
  handSection.appendChild(
    row(
      breakdown.handKind === 'none' ? 'muted' : 'plus',
      breakdown.handLabel,
      breakdown.handKind === 'none' ? '—' : formatPoints(breakdown.handPoints),
    ),
  );
  for (const color of breakdown.colors) {
    handSection.appendChild(row('plus', color.label, formatPoints(color.points)));
  }
  box.appendChild(handSection);

  const verdictSection = el('div', 'breakdown__section');
  verdictSection.appendChild(el('h3', 'breakdown__heading', 'L’envie du public'));
  if (opts.secretHidden) {
    verdictSection.appendChild(row('muted', '❓ Envie secrète — observe les réactions du public', ''));
  } else {
    for (const c of breakdown.conditions) {
      verdictSection.appendChild(row(c.met ? 'plus' : 'muted', `${c.met ? '✓' : '○'} ${c.label}`, ''));
    }
  }
  box.appendChild(verdictSection);

  const totals = el('div', 'breakdown__section breakdown__section--totals');
  totals.appendChild(row('muted', 'Main + couleurs', String(breakdown.base)));
  if (opts.secretHidden) {
    totals.appendChild(row('muted', 'Verdict du public', '×❓'));
    totals.appendChild(row('total', 'Total', '❓'));
  } else {
    const tone = breakdown.multiplier >= 2 ? 'plus' : breakdown.multiplier < 1 ? 'minus' : 'muted';
    totals.appendChild(row(tone, 'Verdict du public', `×${breakdown.multiplier}`));
    totals.appendChild(row('total', 'Total', String(breakdown.total)));
  }
  box.appendChild(totals);
  return box;
}
