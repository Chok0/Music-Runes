/**
 * Décomposition d'un ScoreBreakdown ligne par ligne (exigence GDD §4 :
 * le joueur doit comprendre POURQUOI il score). Réutilisée par le panneau
 * « score en direct » et par le récap de fin de requête.
 */
import type { GameData, ScoreBreakdown } from '../types';
import { el } from './dom';
import { formatPoints, pairKindLabel } from './format';

function row(tone: string, label: string, points: string): HTMLElement {
  const r = el('div', `breakdown__row breakdown__row--${tone}`);
  r.appendChild(el('span', 'breakdown__label', label));
  r.appendChild(el('span', 'breakdown__points', points));
  return r;
}

export function renderBreakdownLines(breakdown: ScoreBreakdown, data: GameData): HTMLElement {
  const box = el('div', 'breakdown');
  const cardName = (id: string): string => data.cardById.get(id)?.name ?? id;

  const pairs = el('div', 'breakdown__section');
  pairs.appendChild(el('h3', 'breakdown__heading', 'Paires'));
  if (breakdown.pairs.length === 0) {
    pairs.appendChild(row('muted', 'Aucune interaction entre cartes.', ''));
  }
  for (const p of breakdown.pairs) {
    const tone =
      p.kind === 'requested_conflict' ? 'dare' : p.points > 0 ? 'plus' : p.points < 0 ? 'minus' : 'muted';
    pairs.appendChild(
      row(
        tone,
        `${cardName(p.a)} + ${cardName(p.b)} — ${pairKindLabel(p.kind)}`,
        p.kind === 'requested_conflict' ? 'exemptée' : formatPoints(p.points),
      ),
    );
  }
  box.appendChild(pairs);

  const conds = el('div', 'breakdown__section');
  conds.appendChild(el('h3', 'breakdown__heading', 'Conditions de la requête'));
  for (const c of breakdown.conditions) {
    conds.appendChild(
      row(c.met ? 'plus' : 'muted', `${c.met ? '✓' : '○'} ${c.label}`, c.met ? formatPoints(c.points) : '—'),
    );
  }
  box.appendChild(conds);

  const totals = el('div', 'breakdown__section breakdown__section--totals');
  totals.appendChild(row(breakdown.coherence < 0 ? 'minus' : 'plus', 'Cohérence', formatPoints(breakdown.coherence)));
  totals.appendChild(row('plus', 'Objectif', formatPoints(breakdown.objective)));
  totals.appendChild(
    row(
      breakdown.audaciousApplied ? 'dare' : 'muted',
      'Résolution audacieuse',
      breakdown.audaciousApplied ? formatPoints(breakdown.audacious) : '—',
    ),
  );
  totals.appendChild(row('total', 'Total', formatPoints(breakdown.total)));
  box.appendChild(totals);
  return box;
}
