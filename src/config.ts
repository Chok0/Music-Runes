/**
 * Partis pris de démarrage — tous À VALIDER EN PLAYTEST, aucun n'est une
 * décision du GDD (cf. docs/roadmap-mvp.md, tableau « Décisions à prendre »).
 */
import type { AudioEngineOptions, GameConfig } from './types';

export const GAME_CONFIG: GameConfig = {
  /** Le GDD dit 5-8 (point ouvert). `?set=8` en URL pour jouer les 8 recettes (M4). */
  requestsPerSet: 6,
  startingHandSize: 6,
  drawPerRequest: 2,
};

export const AUDIO_CONFIG: AudioEngineOptions = {
  bpm: 120,
  loopMeasures: 2,
  /** Mesure ou beat — granularité à régler à l'oreille en playtest. */
  quantize: '1m',
  previewSeconds: 1.5,
};

/** Nombre de requêtes surchargé par l'URL (?set=8), borné aux recettes disponibles. */
export function requestsPerSetFromUrl(totalRecipes: number): number {
  const raw = new URLSearchParams(window.location.search).get('set');
  const n = raw ? Number.parseInt(raw, 10) : GAME_CONFIG.requestsPerSet;
  if (!Number.isFinite(n) || n < 1) return GAME_CONFIG.requestsPerSet;
  return Math.min(n, totalRecipes);
}
