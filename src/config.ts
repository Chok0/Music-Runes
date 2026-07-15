/**
 * Partis pris de démarrage — tous À VALIDER EN PLAYTEST, aucun n'est une
 * décision du GDD (cf. docs/roadmap-mvp.md, tableau « Décisions à prendre »).
 */
import audioJson from '../data/audio.json';
import type { AudioEngineOptions, GameConfig } from './types';

export const GAME_CONFIG: GameConfig = {
  /** Le GDD dit 5-8 (point ouvert). `?set=8` en URL pour jouer les 8 recettes (M4). */
  requestsPerSet: 6,
  startingHandSize: 6,
  drawPerRequest: 2,
};

export const AUDIO_CONFIG: AudioEngineOptions = {
  // Tempo et longueur de boucle : data/audio.json, la source UNIQUE partagée
  // avec scripts/generate-stems.mjs — les stems et le transport ne peuvent
  // pas se désynchroniser en ne changeant qu'un seul des deux côtés.
  bpm: audioJson.bpm,
  loopMeasures: audioJson.loop_measures,
  /** Mesure ou beat — granularité à régler à l'oreille en playtest. */
  quantize: '1m',
  previewSeconds: 1.5,
};

/**
 * Seuils du feedback visuel du plateau (GDD §5) — exprimés en points de
 * score, donc couplés aux barèmes de data/scoring.json : à réajuster
 * ensemble lors du rééquilibrage (c'est pour ça qu'ils vivent ici et non
 * en dur dans l'UI).
 */
export const UI_FEEDBACK = {
  /** Cohérence à partir de laquelle le plateau gagne son liseré harmonieux. */
  harmonyThreshold: 6,
  /** Amplitude du tremblement de dissonance : px par point de cohérence négative. */
  shakePxPerPoint: 0.75,
  shakeMaxPx: 3,
};

/**
 * Nombre de requêtes du set, surchargé par l'URL (?set=8) et TOUJOURS borné
 * aux recettes disponibles — c'est l'unique endroit où ce clamp est fait
 * (l'UI et le store consomment la valeur telle quelle).
 */
export function requestsPerSetFromUrl(totalRecipes: number): number {
  const raw = new URLSearchParams(window.location.search).get('set');
  const n = raw ? Number.parseInt(raw, 10) : GAME_CONFIG.requestsPerSet;
  const wanted = !Number.isFinite(n) || n < 1 ? GAME_CONFIG.requestsPerSet : n;
  return Math.max(1, Math.min(wanted, totalRecipes));
}
