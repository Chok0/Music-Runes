/** Libellés français partagés par le HUD, le panneau score et les écrans. */
import type { PairDetail } from '../types';

/** Signe explicite ; U+2212 pour un vrai signe moins typographique. */
export function formatPoints(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return '±0';
}

/** ★★☆ sur `max` étoiles (résultat de rules.starsFor). */
export function starsText(stars: number, max = 3): string {
  const n = Math.max(0, Math.min(max, Math.round(stars)));
  return '★'.repeat(n) + '☆'.repeat(max - n);
}

export function pairKindLabel(kind: PairDetail['kind']): string {
  switch (kind) {
    case 'same_genre':
      return 'même Genre';
    case 'same_energy':
      return 'même Énergie';
    case 'contrast':
      return 'contraste Calme/Intense';
    case 'conflict':
      return 'contradiction';
    case 'requested_conflict':
      return 'contradiction demandée';
  }
}

/**
 * Monogramme 2 lettres dérivé du nom (« LS » pour Loup Statique).
 * Les particules d'une lettre (« d'Étoile ») sont ignorées → « PÉ ».
 */
export function monogram(name: string): string {
  const words = name.split(/[\s'’-]+/).filter((w) => w.length > 1);
  const first = words[0];
  if (!first) return name.slice(0, 2).toUpperCase();
  const second = words[1];
  if (second) return (first.charAt(0) + second.charAt(0)).toUpperCase();
  return first.slice(0, 2).toUpperCase();
}
