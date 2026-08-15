#!/usr/bin/env node
/**
 * Générateur de stems placeholder — Music Runes.
 *
 * Synthétise en pur Node (aucune dépendance npm) les 48 boucles audio du deck
 * MVP (12 cartes × 4 slots) décrites par data/cards.json, en WAV PCM 16-bit
 * mono 44100 Hz, dans public/assets/stems/<id>/<slot>.wav.
 *
 * Contraintes (docs/architecture-technique.md §4) :
 * - TOUS les stems bouclent sur 4 mesures (2× la boucle de base de
 *   data/audio.json — le moteur accepte tout multiple entier) et suivent la
 *   même PROGRESSION D'ACCORDS Am → F → C → G (i–VI–III–VII de La mineur,
 *   une mesure chacun) : le mix module au lieu de droner sur Am ;
 * - les leads restent en pentatonique de La mineur : elle est consonante
 *   sur les quatre accords, donc superposable quel que soit le stem ;
 * - bouclage propre : queues écrites circulairement (modulo la boucle) +
 *   micro-fades de ~3 ms aux bords ;
 * - pic normalisé ≈ 0.5 pour que 4 voies se superposent sans clipper ;
 * - fichiers écrits à 22 050 Hz (le crush 8-bit tient chaque valeur 4
 *   échantillons à 44.1k : décimer par 2 est sans perte) ; harmonie en
 *   STÉRÉO (élargissement Haas par rotation circulaire, sûr au bouclage).
 *
 * Déterministe : PRNG mulberry32 seedé par hash de "<id>/<slot>" — deux
 * exécutions produisent les mêmes octets, chaque carte a des motifs distincts
 * (le glyphe = identité audio, GDD §3bis).
 *
 * Usage : node scripts/generate-stems.mjs [--force]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constantes temporelles — tempo et longueur de boucle viennent de
// data/audio.json, la source UNIQUE partagée avec le moteur (src/config.ts) :
// changer le BPM là-bas régénère des stems cohérents ici.
// ---------------------------------------------------------------------------

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'assets', 'stems');
const AUDIO = JSON.parse(readFileSync(join(ROOT, 'data', 'audio.json'), 'utf8'));

const SR = 44100;
const BPM = AUDIO.bpm;
const BEAT = 60 / BPM; // 0.5 s à 120 BPM
const LOOP = AUDIO.loop_measures * 4 * BEAT; // boucle de BASE en 4/4 (4.000 s par défaut)
const N = Math.round(SR * LOOP); // échantillons de la boucle de base
const BAR = 4 * BEAT; // une mesure (2 s)
const STEM_N = N * 2; // tous les stems bouclent sur 4 mesures (2× la base)
const STEP = BEAT / 4; // grille de doubles-croches
const SLOTS = ['rythme', 'basse', 'harmonie', 'lead'];

// ---------------------------------------------------------------------------
// Progression d'accords partagée — Am → F → C → G (une mesure chacun).
// Tous les demi-tons sont relatifs à A4. `bass` = fondamentale grave (A1...),
// `chord` = voicing serré conduit par les voix (les notes communes restent),
// `seventh`/`rootSemi` = couleurs (7e, 9e) pour le jazz et les nappes.
// ---------------------------------------------------------------------------

const PROG = [
  { name: 'Am', bass: -36, rootSemi: -12, chord: [-12, -9, -5], seventh: -2, power: [-24, -17, -12], third: 3 },
  { name: 'F', bass: -40, rootSemi: -16, chord: [-16, -12, -9], seventh: -5, power: [-28, -21, -16], third: 4 },
  { name: 'C', bass: -33, rootSemi: -9, chord: [-14, -9, -5], seventh: 2, power: [-21, -14, -9], third: 4 },
  { name: 'G', bass: -38, rootSemi: -14, chord: [-14, -10, -7], seventh: -4, power: [-26, -19, -14], third: 4 },
];

/** Accord de la progression à l'instant du pas de double-croche `s` (16/mesure). */
const chordAtStep = (s) => PROG[Math.floor(s / 16) % 4];

// Modulation par Énergie : densité rythmique, brillance (filtres), saturation,
// et pic cible (Intense plus fort que Calme, tous < 0.6 pour la superposition).
const ENERGIE = {
  Calme: { dens: 0.55, bright: 0.6, drive: 0.7, peak: 0.42 },
  Neutre: { dens: 0.8, bright: 1.0, drive: 1.0, peak: 0.5 },
  Intense: { dens: 1.0, bright: 1.6, drive: 1.6, peak: 0.56 },
};

// ---------------------------------------------------------------------------
// PRNG déterministe
// ---------------------------------------------------------------------------

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const choose = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// ---------------------------------------------------------------------------
// Notes — La mineur (racine A). Fréquences en équal temperament depuis A4=440.
// ---------------------------------------------------------------------------

const hz = (semisFromA4) => 440 * 2 ** (semisFromA4 / 12);
const PENTA = [0, 3, 5, 7, 10]; // pentatonique mineure de La (demi-tons)
const AM_SCALE = [0, 2, 3, 5, 7, 8, 10]; // gamme de La mineur naturel

/** Degré pentatonique → Hz (les degrés hors [0..4] changent d'octave). */
function pentaHz(degree, baseSemisFromA4) {
  const oct = Math.floor(degree / PENTA.length);
  const idx = ((degree % PENTA.length) + PENTA.length) % PENTA.length;
  return hz(baseSemisFromA4 + PENTA[idx] + 12 * oct);
}

/** Degré de gamme Am → Hz (pour la walking bass). */
function scaleHz(baseSemisFromA4, scaleStep) {
  const oct = Math.floor(scaleStep / 7);
  const idx = ((scaleStep % 7) + 7) % 7;
  return hz(baseSemisFromA4 + AM_SCALE[idx] + 12 * oct);
}

// ---------------------------------------------------------------------------
// Briques DSP
// ---------------------------------------------------------------------------

const OSC = {
  sin: (p) => Math.sin(2 * Math.PI * p),
  saw: (p) => 2 * (p - Math.floor(p + 0.5)),
  square: (p) => (p % 1 < 0.5 ? 1 : -1),
  tri: (p) => 4 * Math.abs(p - Math.floor(p + 0.5)) - 1,
  // Pulses à faible rapport cyclique : la voix lead des puces sonores 8-bit.
  pulse25: (p) => (p % 1 < 0.25 ? 1 : -1),
  pulse12: (p) => (p % 1 < 0.125 ? 1 : -1),
};

/**
 * Esthétique 8-bit (retour playtest #2) : sample-hold (divise le sample rate,
 * ~11 kHz) + quantification sur peu de niveaux — appliqué à TOUS les stems
 * après normalisation, pour une identité chiptune uniforme du mix.
 */
const CHIP = { holdSamples: 4, levels: 32 };

function chipCrushInPlace(buf) {
  const half = CHIP.levels / 2;
  let held = 0;
  for (let i = 0; i < buf.length; i++) {
    if (i % CHIP.holdSamples === 0) {
      const v = Math.max(-1, Math.min(1, buf[i]));
      held = Math.round(v * half) / half;
    }
    buf[i] = held;
  }
}

/** Mixe `arr` dans `buf` à partir de t0, en écriture CIRCULAIRE (modulo la
 *  longueur de `buf` — les stems n'ont pas tous la même : le lead boucle sur
 *  4 mesures) : les queues qui dépassent retombent au début → bouclage propre. */
function mixInto(buf, t0, arr, gain = 1) {
  const s0 = Math.round(t0 * SR);
  const len = Math.min(arr.length, buf.length);
  for (let i = 0; i < len; i++) buf[(s0 + i) % buf.length] += arr[i] * gain;
}

/**
 * Écho CIRCULAIRE (delay + feedback) : la queue de l'écho qui dépasse la fin
 * de la boucle retombe au début, donc le stem reste bouclable sans couture.
 * Trois passes de la récurrence suffisent à atteindre le régime permanent
 * (feedback < 1 → convergence géométrique).
 */
function circularEcho(buf, delaySeconds, feedback, wet) {
  const n = buf.length;
  const d = (((Math.round(delaySeconds * SR)) % n) + n) % n || 1;
  const dry = Float64Array.from(buf);
  const echo = Float64Array.from(buf);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < n; i++) {
      echo[i] = dry[i] + feedback * echo[(i - d + n) % n];
    }
  }
  for (let i = 0; i < n; i++) buf[i] = dry[i] + wet * (echo[i] - dry[i]);
}

function onePoleLPInPlace(arr, cutoff) {
  const a = 1 - Math.exp((-2 * Math.PI * Math.min(Math.max(cutoff, 10), 18000)) / SR);
  let y = 0;
  for (let i = 0; i < arr.length; i++) {
    y += a * (arr[i] - y);
    arr[i] = y;
  }
}

function onePoleHPInPlace(arr, cutoff) {
  const a = 1 - Math.exp((-2 * Math.PI * Math.min(Math.max(cutoff, 10), 18000)) / SR);
  let y = 0;
  for (let i = 0; i < arr.length; i++) {
    y += a * (arr[i] - y);
    arr[i] -= y;
  }
}

/** Passe-bas one-pole à coefficient variable (stable quel que soit le sweep). */
function onePoleLPSweepInPlace(arr, cutoffFn) {
  let y = 0;
  for (let i = 0; i < arr.length; i++) {
    const fc = Math.min(Math.max(cutoffFn(i / SR), 10), 18000);
    const a = 1 - Math.exp((-2 * Math.PI * fc) / SR);
    y += a * (arr[i] - y);
    arr[i] = y;
  }
}

/** Passe-bas biquad résonnant (RBJ), cutoff constant par note. */
function biquadLPInPlace(arr, cutoff, Q) {
  const w0 = (2 * Math.PI * Math.min(Math.max(cutoff, 20), 16000)) / SR;
  const alpha = Math.sin(w0) / (2 * Q);
  const cosw = Math.cos(w0);
  const b0 = (1 - cosw) / 2;
  const b1 = 1 - cosw;
  const b2 = b0;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw;
  const a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    arr[i] = y;
  }
}

function applyDrive(arr, drive) {
  for (let i = 0; i < arr.length; i++) arr[i] = Math.tanh(arr[i] * drive);
}

/**
 * Note générique : oscillateur (+ détune, partiels, vibrato, trémolo AM),
 * enveloppe attaque linéaire / tenue / release exponentiel, filtre, disto.
 * Retourne un buffer (queue incluse) à mixer via mixInto.
 */
function tone({
  freq, dur, wave = 'sin', attack = 0.005, release = 0.05, gain = 1,
  cutoff = 0, q = 0.707, drive = 0, vibHz = 0, vibDepth = 0,
  detune = 0, amHz = 0, amDepth = 0, harmonics = null,
}) {
  const sus = Math.max(dur, attack);
  const len = Math.min(Math.round((sus + release * 4) * SR), N);
  const out = new Float64Array(len);
  let p1 = 0, p2 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = freq * (1 + (vibHz ? Math.sin(2 * Math.PI * vibHz * t) * vibDepth : 0));
    p1 += f / SR;
    let v = OSC[wave](p1);
    if (detune) {
      p2 += (f * (1 + detune)) / SR;
      v = (v + OSC[wave](p2)) * 0.5;
    }
    if (harmonics) {
      let k = 2;
      for (const h of harmonics) v += Math.sin(2 * Math.PI * p1 * k++) * h;
    }
    if (amHz) v *= 1 - amDepth * (0.5 + 0.5 * Math.sin(2 * Math.PI * amHz * t));
    const env = t < attack ? t / attack : t < sus ? 1 : Math.exp(-(t - sus) / release);
    out[i] = v * env * gain;
  }
  if (cutoff) biquadLPInPlace(out, cutoff, q);
  if (drive) applyDrive(out, drive);
  return out;
}

/** Voix synthétique simple : 2 sinus détunés + partiels « formants » + AM
 *  (AM rapide = grain robotique, AM lente = trémolo vocal) + vibrato. */
function voiceTone({ freq, dur, robot = false, gain = 1, attack = 0.02, release = 0.12, drive = 0, amHz = 0 }) {
  return tone({
    freq, dur, wave: 'sin', attack, release, gain, drive,
    detune: 0.008,
    harmonics: [0.4, 0.18],
    amHz: amHz || (robot ? 45 : 5.5),
    amDepth: robot ? 0.65 : 0.3,
    vibHz: robot ? 0 : 5,
    vibDepth: robot ? 0 : 0.005,
  });
}

/** Accord : notes empilées (strum optionnel), disto sur la SOMME (intermodulation). */
function chordHit(semisList, {
  dur, wave = 'saw', attack = 0.004, release = 0.06, gain = 1,
  drive = 0, cutoff = 0, q = 0.707, strum = 0, detune = 0,
  harmonics = null, amHz = 0, amDepth = 0,
}) {
  const len = Math.min(Math.round((Math.max(dur, attack) + release * 4 + strum * semisList.length) * SR), N);
  const out = new Float64Array(len);
  semisList.forEach((semi, k) => {
    const part = tone({ freq: hz(semi), dur, wave, attack, release, gain: 1 / semisList.length, detune, harmonics, amHz, amDepth });
    const off = Math.round(strum * k * SR);
    for (let i = 0; i < part.length && off + i < len; i++) out[off + i] += part[i];
  });
  if (drive) applyDrive(out, drive);
  if (cutoff) biquadLPInPlace(out, cutoff, q);
  for (let i = 0; i < len; i++) out[i] *= gain;
  return out;
}

// --- Percussions ---

function kickHit({ f0 = 100, f1 = 45, dur = 0.3, sweepTau = 0.04, ampTau = 0.09, gain = 1, drive = 1.4 } = {}) {
  const len = Math.min(Math.round(dur * SR), N);
  const out = new Float64Array(len);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    phase += (f1 + (f0 - f1) * Math.exp(-t / sweepTau)) / SR;
    out[i] = Math.tanh(Math.sin(2 * Math.PI * phase) * drive) * Math.exp(-t / ampTau) * gain;
  }
  return out;
}

function hatHit(rng, { decay = 0.025, gain = 0.3, hp = 5500, lp = 0, attack = 0.001 } = {}) {
  const len = Math.min(Math.round((attack + decay * 6) * SR), N);
  const out = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = t < attack ? t / attack : Math.exp(-(t - attack) / decay);
    out[i] = (rng() * 2 - 1) * env * gain;
  }
  if (lp) onePoleLPInPlace(out, lp);
  onePoleHPInPlace(out, hp);
  return out;
}

function snareHit(rng, { gain = 1, decay = 0.1, body = 185 } = {}) {
  const len = Math.min(Math.round(decay * 7 * SR), N);
  const noise = new Float64Array(len);
  for (let i = 0; i < len; i++) noise[i] = (rng() * 2 - 1) * Math.exp(-i / SR / decay);
  onePoleHPInPlace(noise, 1200);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    ph += body / SR;
    noise[i] = (noise[i] * 0.85 + Math.sin(2 * Math.PI * ph) * Math.exp(-t / (decay * 0.45)) * 0.7) * gain;
  }
  return noise;
}

/** Nappe de bruit doux (balais jazz / brushes pop calme). */
function brushHit(rng, { gain = 0.15, attack = 0.06, decay = 0.12 } = {}) {
  const len = Math.min(Math.round((attack + decay * 5) * SR), N);
  const out = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = t < attack ? t / attack : Math.exp(-(t - attack) / decay);
    out[i] = (rng() * 2 - 1) * env * gain;
  }
  onePoleLPInPlace(out, 2500);
  return out;
}

/** Hit résonnant accordé (percussions éparses ambient) : sinus + tick de bruit. */
function percResonant(rng, { freq, gain = 1 } = {}) {
  const out = tone({ freq, dur: 0.03, wave: 'sin', attack: 0.002, release: 0.3 + rng() * 0.3, gain, harmonics: [0.3] });
  const tick = hatHit(rng, { decay: 0.015, gain: 0.2 * gain, hp: 2000 });
  for (let i = 0; i < tick.length && i < out.length; i++) out[i] += tick[i];
  return out;
}

// ---------------------------------------------------------------------------
// Recettes de synthèse — RYTHME
// ---------------------------------------------------------------------------

function rythmeTechno(buf, rng, E) {
  // four-on-the-floor sur 4 mesures : kick chaque noire, hats en contretemps
  for (let bar = 0; bar < 4; bar++) {
    for (let b = 0; b < 4; b++) {
      const t = bar * BAR + b * BEAT;
      mixInto(buf, t, kickHit({ f0: 105, f1: 45, ampTau: 0.085, drive: 1 + E.drive * 0.8 }));
      mixInto(buf, t + BEAT / 2, hatHit(rng, { decay: 0.02 + 0.012 * E.bright, gain: 0.32 }));
    }
    // charley ouvert en fin de mesure
    if (E.dens >= 1) mixInto(buf, bar * BAR + 3.5 * BEAT, hatHit(rng, { decay: 0.09, gain: 0.26, hp: 5000 }));
  }
  // doubles-croches fantômes selon la densité
  for (let s = 0; s < 64; s++) {
    if (s % 2 === 0) continue;
    if (rng() < (E.dens - 0.5) * 0.8) {
      mixInto(buf, s * STEP, hatHit(rng, { decay: 0.012, gain: 0.14, hp: 6500 }));
    }
  }
  // Fill : roulement de charley montant sur le dernier temps de la boucle.
  for (let k = 0; k < 4; k++) {
    mixInto(buf, 15 * BEAT + k * STEP, hatHit(rng, { decay: 0.02, gain: 0.16 + 0.08 * k, hp: 5200 }));
  }
}

function rythmeMetal(buf, rng, E) {
  // double pédale sur 4 mesures, snare backbeat ; fin de boucle en rafale
  for (let bar = 0; bar < 4; bar++) {
    for (let b = 0; b < 4; b++) {
      const isFill = bar === 3 && b >= 2;
      const sub = isFill ? 4 : rng() < 0.15 + 0.6 * E.dens ? 4 : 2;
      for (let k = 0; k < sub; k++) {
        mixInto(buf, bar * BAR + b * BEAT + (k * BEAT) / sub,
          kickHit({ f0: 130, f1: 52, dur: 0.14, ampTau: 0.045, drive: 1.5 + E.drive, gain: k % 2 ? 0.8 : 1 }));
      }
      if (b % 2 === 1) mixInto(buf, bar * BAR + b * BEAT, snareHit(rng, { gain: 1.1, decay: 0.09 }));
    }
  }
  // Fill : snares serrées qui montent vers le rebouclage.
  [61, 62, 63].forEach((s, i) => {
    mixInto(buf, s * STEP, snareHit(rng, { gain: 0.65 + 0.18 * i, decay: 0.07 }));
  });
  if (E.dens >= 1) mixInto(buf, 0, hatHit(rng, { decay: 0.45, gain: 0.22, hp: 4500 })); // pseudo-crash sur le 1
}

function rythmePop(buf, rng, E) {
  const brushes = E.dens < 0.7; // « beat léger, brushes » en Calme
  for (let bar = 0; bar < 4; bar++) {
    const o = bar * 16;
    const kicks = [0, 8];
    if (rng() < 0.7) kicks.push(choose(rng, [6, 10, 11, 14])); // syncope
    for (const s of kicks) mixInto(buf, (o + s) * STEP, kickHit({ f0: 95, f1: 50, ampTau: 0.06, drive: 1 + E.drive * 0.4 }));
    for (const s of [4, 12]) {
      mixInto(buf, (o + s) * STEP, brushes
        ? brushHit(rng, { gain: 0.6, attack: 0.005, decay: 0.09 })
        : snareHit(rng, { gain: 0.9, decay: 0.11, body: 190 }));
    }
    for (let s = 0; s < 16; s += 2) {
      const accent = s % 4 === 2 ? 1 : 0.6;
      mixInto(buf, (o + s) * STEP, brushes
        ? brushHit(rng, { gain: 0.18 * accent, attack: 0.004, decay: 0.03 })
        : hatHit(rng, { decay: E.bright > 1 ? 0.03 : 0.02, gain: 0.22 * accent, hp: 6000 }));
    }
  }
  // Fill « pra-ta-ta » avant le rebouclage.
  [58, 60, 62].forEach((s, i) => {
    mixInto(buf, s * STEP, brushes
      ? brushHit(rng, { gain: 0.4 + 0.15 * i, attack: 0.004, decay: 0.06 })
      : snareHit(rng, { gain: 0.55 + 0.2 * i, decay: 0.08 }));
  });
}

function rythmeJazz(buf, rng, E) {
  // ride « ding ding-a-ding » sur 4 mesures (skip-note ternaire au 2/3)
  for (let bar = 0; bar < 4; bar++) {
    for (let b = 0; b < 4; b++) {
      const t = bar * BAR + b * BEAT;
      mixInto(buf, t, hatHit(rng, { decay: 0.18, gain: 0.4 * (b % 2 ? 0.85 : 1), hp: 4200 }));
      if (b % 2 === 1) {
        if (rng() < 0.4 + 0.6 * E.dens) {
          mixInto(buf, t + (2 * BEAT) / 3, hatHit(rng, { decay: 0.12, gain: 0.28, hp: 4200 }));
        }
        mixInto(buf, t, hatHit(rng, { decay: 0.012, gain: 0.18, hp: 2500 })); // charley au pied
      }
      if (b % 2 === 0 || E.dens > 0.7) mixInto(buf, t, brushHit(rng, { gain: 0.2 }));
    }
  }
  // Fill : grand coup de balai qui glisse vers le rebouclage.
  mixInto(buf, 15 * BEAT, brushHit(rng, { gain: 0.55, attack: 0.25, decay: 0.2 }));
}

function rythmeAmbient(buf, rng, E) {
  // percussions éparses sur 4 mesures : hits résonnants accordés
  const nHits = Math.max(3, Math.round((5 + rng() * 4) * E.dens));
  const used = new Set();
  for (let k = 0; k < nHits; k++) {
    let s = Math.floor(rng() * 64);
    if (used.has(s)) s = (s + 13) % 64;
    used.add(s);
    const deg = choose(rng, [0, 1, 2, 4]);
    mixInto(buf, s * STEP, percResonant(rng, { freq: pentaHz(deg, -24), gain: 0.7 + rng() * 0.4 }));
  }
}

// ---------------------------------------------------------------------------
// Recettes de synthèse — BASSE
// ---------------------------------------------------------------------------

function basseTechno(buf, rng, E) {
  // ligne acide en croches SUR LA PROGRESSION : fondamentale/quinte/octave de
  // l'accord courant, passe-bas résonnant dont le cutoff marche
  let cutoff = 300;
  for (let e = 0; e < 32; e++) {
    if (rng() < 0.25 * (1 - E.dens)) continue;
    const chord = chordAtStep(e * 2);
    const off = choose(rng, [0, 0, 0, 12, 7, 12]); // fondamentale, octave, quinte
    const accent = rng() < 0.3;
    cutoff = Math.max(200, Math.min(3200, cutoff + (rng() * 2 - 1) * 700 * E.bright + (accent ? 400 : 0)));
    const note = tone({ freq: hz(chord.bass + off), dur: 0.16, wave: 'square', attack: 0.003, release: 0.05, gain: accent ? 1.15 : 0.9 });
    biquadLPInPlace(note, cutoff * (0.6 + 0.4 * E.bright), 5);
    applyDrive(note, 1.2 + E.drive * 0.8);
    mixInto(buf, e * 2 * STEP, note);
  }
}

function basseMetal(buf, rng, E) {
  // palm-mute saccadé sur la fondamentale de l'accord courant, quinte parfois
  for (let s = 0; s < 64; s++) {
    const onBeat = s % 4 === 0;
    if (!onBeat && rng() > 0.35 + 0.55 * E.dens) continue;
    const chord = chordAtStep(s);
    const semi = rng() < 0.12 ? choose(rng, [7, 12]) : 0;
    const note = tone({ freq: hz(chord.bass + semi), dur: 0.085, wave: 'saw', attack: 0.002, release: 0.03, gain: onBeat ? 1 : 0.8, drive: 2.5 * E.drive });
    onePoleLPInPlace(note, 300 + 700 * E.bright);
    mixInto(buf, s * STEP, note);
  }
}

function bassePop(buf, rng, E) {
  // ronde et groovy : triangle (basse 8-bit canonique), motif syncopé par mesure
  for (let bar = 0; bar < 4; bar++) {
    const chord = PROG[bar];
    const grid = [0, 6, 8, 14];
    for (let i = 0; i < grid.length; i++) {
      if (i % 2 === 1 && rng() > 0.3 + 0.7 * E.dens) continue;
      const semi = rng() < 0.7 ? 0 : choose(rng, [12, 7]); // fondamentale, octave, quinte
      const note = tone({ freq: hz(chord.bass + semi), dur: 0.3 + 0.1 * (1 - E.dens), wave: 'tri', attack: 0.02, release: 0.12, gain: 1, drive: 1.2, harmonics: [0.2] });
      mixInto(buf, (bar * 16 + grid[i]) * STEP, note);
    }
  }
}

function basseJazz(buf, rng, E) {
  // walking bass à travers les CHANGEMENTS : fondamentale, tierce, quinte,
  // approche chromatique de l'accord suivant — le 1-3-5-approche classique
  for (let bar = 0; bar < 4; bar++) {
    const chord = PROG[bar];
    const next = PROG[(bar + 1) % 4];
    const root = chord.bass + 12; // registre A2-C3
    const walk = [
      root,
      root + chord.third,
      root + (rng() < 0.75 ? 7 : 12),
      next.bass + 12 + (rng() < 0.5 ? -1 : 1), // approche chromatique
    ];
    walk.forEach((semi, q) => {
      const note = tone({ freq: hz(semi), dur: 0.42, wave: 'tri', attack: 0.008, release: 0.09, gain: 0.85 + rng() * 0.3, harmonics: [0.3, 0.12] });
      mixInto(buf, bar * BAR + q * BEAT, note);
    });
  }
}

function basseAmbient(buf, rng, E) {
  // drone qui MODULE : une fondamentale par mesure, fondues croisées douces
  for (let bar = 0; bar < 4; bar++) {
    const f = hz(PROG[bar].bass);
    const seg = tone({ freq: f, dur: BAR - 0.25, wave: 'sin', attack: 0.35, release: 0.45, gain: 1, detune: 0.004, harmonics: [0.2] });
    mixInto(buf, bar * BAR, seg);
    const oct = tone({ freq: f * 2, dur: BAR - 0.5, wave: 'sin', attack: 0.5, release: 0.5, gain: 0.25 + rng() * 0.1 });
    mixInto(buf, bar * BAR + 0.1, oct);
  }
  onePoleLPSweepInPlace(buf, (t) => 120 + 90 * E.bright * (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / (2 * LOOP))));
}

// ---------------------------------------------------------------------------
// Recettes de synthèse — HARMONIE (accords construits sur Am)
// ---------------------------------------------------------------------------

function harmonieTechno(buf, rng, E) {
  // nappe saw sombre qui SUIT LA PROGRESSION (voicing grave + 7e), avec
  // pompage « sidechain » sur chaque temps — le souffle techno classique
  const pad = new Float64Array(buf.length);
  for (let bar = 0; bar < 4; bar++) {
    const chord = PROG[bar];
    const semis = [...chord.chord.map((s) => s - 12), chord.seventh - 12];
    const s0 = Math.round(bar * BAR * SR);
    const s1 = Math.round((bar + 1) * BAR * SR + 0.06 * SR); // léger recouvrement
    for (const semi of semis) {
      const f = hz(semi);
      const d = choose(rng, [0.25, 0.5]);
      let p1 = rng(), p2 = rng();
      for (let i = s0; i < s1; i++) {
        p1 += f / SR;
        p2 += (f + d) / SR;
        const env = Math.min(1, (i - s0) / SR / 0.05, (s1 - i) / SR / 0.06);
        pad[i % pad.length] += (OSC.saw(p1) + OSC.saw(p2)) * 0.1 * env;
      }
    }
  }
  onePoleLPSweepInPlace(pad, (t) => 240 + 260 * E.bright * (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / (2 * LOOP) - Math.PI / 2)));
  for (let i = 0; i < pad.length; i++) {
    const t = i / SR;
    const pump = 1 - 0.45 * Math.exp(-(t % BEAT) / 0.09); // creuse chaque temps
    pad[i] = Math.tanh(pad[i] * (1.1 + 0.5 * E.drive)) * pump;
  }
  mixInto(buf, 0, pad);
}

function harmonieMetal(buf, rng, E) {
  // power chords distordus martelés en croches, SUR LA PROGRESSION (A5→F5→C5→G5)
  for (let e = 0; e < 32; e++) {
    if (rng() < 0.1 * (1.2 - E.dens)) continue;
    const chord = chordAtStep(e * 2);
    const muted = rng() < 0.3;
    const hit = chordHit(chord.power, {
      dur: muted ? 0.09 : 0.19, wave: 'saw', attack: 0.003, release: 0.04,
      gain: e % 4 === 0 ? 1 : 0.82, drive: 2.5 + 1.5 * E.drive,
      cutoff: 700 + 1100 * E.bright, q: 0.8,
    });
    mixInto(buf, e * 2 * STEP, hit);
  }
}

function harmoniePop(buf, rng, E) {
  // accords plaqués en pulse (piano 8-bit), un accord par mesure + relance,
  // 7e ajoutée une mesure sur deux pour la couleur
  for (let bar = 0; bar < 4; bar++) {
    const chord = PROG[bar];
    const voicing = bar % 2 === 1 && rng() < 0.6 ? [...chord.chord, chord.seventh] : chord.chord;
    mixInto(buf, bar * BAR, chordHit(voicing, {
      dur: 0.6, wave: 'pulse25', attack: 0.01, release: 0.3, gain: 1,
      strum: 0.009, cutoff: 700 + 1100 * E.bright, q: 0.8, detune: 0.004,
    }));
    mixInto(buf, bar * BAR + 2 * BEAT, chordHit(voicing, {
      dur: 0.55, wave: 'pulse25', attack: 0.01, release: 0.28, gain: 0.85,
      strum: 0.009, cutoff: 700 + 1100 * E.bright, q: 0.8, detune: 0.004,
    }));
    if (E.dens >= 1) {
      mixInto(buf, bar * BAR + 3.5 * BEAT,
        chordHit(voicing, { dur: 0.1, wave: 'pulse25', attack: 0.006, release: 0.06, gain: 0.5, cutoff: 700 + 1100 * E.bright }));
    }
  }
}

function harmonieJazz(buf, rng, E) {
  // comping rhodes à travers les changements : 7e + 9e, positions ternaires
  for (let bar = 0; bar < 4; bar++) {
    const chord = PROG[bar];
    const voicing = [...chord.chord, chord.seventh, chord.rootSemi + 14]; // + 9e
    const swing = [0, 0.833, 1.5]; // temps 1 + « ands » ternaires de la mesure
    for (let i = 0; i < swing.length; i++) {
      if (i !== 0 && rng() > 0.25 + 0.5 * E.dens) continue;
      const hit = chordHit(voicing, {
        dur: 0.7 + rng() * 0.4, wave: 'sin', attack: 0.012, release: 0.5,
        gain: 0.8 + rng() * 0.3, harmonics: [0.35, 0.1], amHz: 5.2, amDepth: 0.22,
      });
      mixInto(buf, bar * BAR + swing[i], hit);
    }
  }
}

function harmonieAmbient(buf, rng, E) {
  // lavis harmonique : les tons de l'accord courant émergent et s'effacent
  // lentement, une mesure après l'autre
  for (let bar = 0; bar < 4; bar++) {
    const chord = PROG[bar];
    const tones = [chord.power[0], ...chord.chord, chord.seventh];
    for (const semi of tones) {
      if (rng() < 0.2) continue;
      const note = tone({
        freq: hz(semi), dur: 1.1 + rng() * 0.6, wave: rng() < 0.5 ? 'sin' : 'tri',
        attack: 0.4, release: 0.6, gain: 0.5 + rng() * 0.3, detune: 0.003,
      });
      mixInto(buf, bar * BAR + rng() * 0.6, note);
    }
  }
  const phi0 = rng() * 2 * Math.PI;
  onePoleLPSweepInPlace(buf, (t) => 450 + 900 * E.bright * (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / (2 * LOOP) + phi0)));
}

// ---------------------------------------------------------------------------
// Recettes de synthèse — LEAD (pentatonique de La mineur, motif seedé)
//
// Retour playtest #1 : « l'effet boucle manque de fun musical ». Les leads
// bouclent donc sur 4 MESURES (2× la boucle de base — le moteur accepte tout
// multiple entier) en structure A/A' : la seconde moitié varie le motif et se
// termine par un CLIMAX (montée, filtre ouvert, note haute tenue). Un écho
// circulaire par genre (LEAD_ECHO) donne l'espace qui manquait aux timbres.
// ---------------------------------------------------------------------------

/** Écho du lead par genre : delay en s (à 120 BPM : croche 0.25, pointée 0.375). */
const LEAD_ECHO = {
  Techno: { delay: 0.375, feedback: 0.4, wet: 0.35 }, // croche pointée dub
  Pop: { delay: 0.375, feedback: 0.3, wet: 0.25 },
  Jazz: { delay: 0.25, feedback: 0.25, wet: 0.15 }, // discret
  Ambient: { delay: 0.5, feedback: 0.5, wet: 0.5 }, // nappe d'échos
  Metal: { delay: 0.125, feedback: 0.25, wet: 0.15 }, // slapback serré
};

/** Les descriptions « voix/vocal/cri » basculent sur le timbre formants+AM. */
function leadTimbre(description) {
  return {
    voice: /voix|vocal|chant|cri|ch(?:œ|oe)ur/i.test(description),
    robot: /robot/i.test(description),
  };
}

function leadTechno(buf, rng, E, timbre) {
  // arpège acide en doubles-croches (croches en Calme) ; moitié A' relevée
  // d'une octave par endroits, dernière mesure : montée + filtre grand ouvert
  const motif = Array.from({ length: 8 }, () => choose(rng, [0, 2, 3, 4, 5, 7]));
  motif[0] = 0; // ancre sur la tonique
  const div = E.dens < 0.7 ? 2 : 1;
  for (let half = 0; half < 2; half++) {
    const t0 = half * LOOP;
    for (let s = 0; s < 32; s += div) {
      const climax = half === 1 && s >= 24;
      let deg = motif[(s / div) % 8] + (half === 1 && !climax && rng() < 0.3 ? 5 : 0);
      if (climax) deg = 4 + Math.round(((s - 24) / 8) * 6); // montée vers l'aigu
      const accent = climax ? 1.15 : s % 4 === 0 ? 1 : 0.75;
      let note;
      if (timbre.voice) {
        note = voiceTone({ freq: pentaHz(deg, 0), dur: 0.1 * div, robot: timbre.robot, gain: accent, attack: 0.004, release: 0.03 });
      } else {
        note = tone({ freq: pentaHz(deg, -12), dur: 0.09 * div, wave: 'square', attack: 0.002, release: 0.03, gain: accent });
        // Le filtre balaye les 64 pas de la boucle longue, ouvert en grand au climax.
        const phase = (half * 32 + s) / 64;
        const sweep = climax ? 1 : 0.5 + 0.5 * Math.sin(2 * Math.PI * phase - Math.PI / 2);
        biquadLPInPlace(note, 400 + (400 + 2000 * E.bright) * sweep, 5);
        applyDrive(note, 1 + E.drive);
      }
      mixInto(buf, t0 + s * STEP, note);
    }
  }
}

function leadMetal(buf, rng, E, timbre) {
  // riff agressif sur 4 mesures ; la dernière : montée en doubles → cri tenu
  const motif = Array.from({ length: 8 }, (_, i) => (i % 4 === 3 && rng() < 0.35 ? null : choose(rng, [0, 1, 2, 3, 5])));
  motif[0] = 0;
  for (let bar = 0; bar < 4; bar++) {
    const climaxBar = bar === 3;
    for (let e = 0; e < 8; e++) {
      let deg = motif[e];
      if (climaxBar) {
        deg = e < 6 ? choose(rng, [2, 3, 5, 7]) : e === 6 ? 7 : 9; // montée → sommet
      } else if (bar === 1 && e >= 6) {
        deg = choose(rng, [5, 7]); // fin de riff qui monte
      }
      if (deg === null) continue;
      const finalCry = climaxBar && e === 7;
      const doubles = !finalCry && (climaxBar || (E.dens >= 1 && rng() < 0.4)) ? 2 : 1;
      for (let k = 0; k < doubles; k++) {
        const note = timbre.voice
          ? voiceTone({ freq: pentaHz(deg, 0), dur: finalCry ? 0.5 : 0.13, robot: timbre.robot, gain: finalCry ? 1.1 : 1, attack: 0.006, release: finalCry ? 0.25 : 0.12, drive: 2 + E.drive })
          : tone({ freq: pentaHz(deg, -24), dur: finalCry ? 0.55 : 0.16 / doubles, wave: 'saw', attack: 0.002, release: finalCry ? 0.2 : 0.04, gain: finalCry ? 1.1 : 1, drive: 3 * E.drive, cutoff: 800 + 1700 * E.bright, vibHz: finalCry ? 5.5 : 0, vibDepth: finalCry ? 0.01 : 0 });
        mixInto(buf, bar * 2 + e * 2 * STEP + k * STEP, note);
      }
    }
  }
}

function leadPop(buf, rng, E, timbre) {
  // hook en croches : couplet A (2 mesures), A' varié, envolée finale à l'octave
  const motif = Array.from({ length: 8 }, () => (rng() < 0.2 ? null : choose(rng, [0, 2, 3, 4, 5, 7])));
  motif[0] = choose(rng, [4, 5]); // départ haut, accrocheur
  for (let bar = 0; bar < 4; bar++) {
    const lastBar = bar === 3;
    for (let e = 0; e < 8; e++) {
      let deg = motif[e];
      if (bar === 1 && e >= 6) deg = e === 6 ? 2 : 0; // cadence du couplet
      if (bar === 2 && deg !== null && rng() < 0.35) deg += 2; // variation A'
      if (lastBar && e >= 5) deg = e === 5 ? 5 : e === 6 ? 7 : 9; // envolée finale
      if (deg === null) continue;
      const finalNote = lastBar && e === 7;
      const dur = finalNote ? 0.6 : 0.18 + (e % 2) * 0.04;
      const gain = finalNote ? 1.15 : e % 4 === 0 ? 1.1 : 0.9;
      const note = timbre.voice
        ? voiceTone({ freq: pentaHz(deg, 0), dur, gain, attack: 0.015, release: finalNote ? 0.3 : 0.12 })
        : tone({ freq: pentaHz(deg, 0), dur, wave: 'pulse25', attack: 0.008, release: finalNote ? 0.25 : 0.08, gain, cutoff: 1200 + 1800 * E.bright, vibHz: 5, vibDepth: finalNote ? 0.008 : 0.004 });
      mixInto(buf, bar * 2 + e * 2 * STEP, note);
    }
  }
}

function leadJazz(buf, rng, E, timbre) {
  // phrase swing « improvisée » sur 16 temps : triolets, marche par degrés ;
  // temps 13-15 : run ascendant, temps 16 : résolution longue sur l'aigu
  let deg = choose(rng, [4, 5, 6]);
  for (let b = 0; b < 16; b++) {
    const climax = b >= 12 && b < 15;
    const resolution = b === 15;
    if (!climax && !resolution && rng() < 0.25 * (1.6 - E.dens)) continue; // respirations
    if (resolution) {
      const note = timbre.voice
        ? voiceTone({ freq: pentaHz(7, -12), dur: 0.8, gain: 1, attack: 0.03, release: 0.35 })
        : tone({ freq: pentaHz(7, -12), dur: 0.8, wave: 'tri', attack: 0.02, release: 0.3, gain: 1, cutoff: 900 + 1100 * E.bright, harmonics: [0.25], vibHz: 5.5, vibDepth: 0.007 });
      mixInto(buf, b * BEAT, note);
      continue;
    }
    const r = rng();
    const ks = climax ? [0, 1, 2] : r < 0.45 ? [0] : r < 0.8 ? [0, 2] : [0, 1, 2]; // positions ternaires
    for (let j = 0; j < ks.length; j++) {
      deg = climax
        ? Math.min(9, deg + 1) // montée continue vers la résolution
        : Math.max(0, Math.min(9, deg + choose(rng, [-2, -1, -1, 1, 1, 2])));
      const dur = j === ks.length - 1 ? 0.26 : 0.12;
      const note = timbre.voice
        ? voiceTone({ freq: pentaHz(deg, -12), dur, gain: 0.7 + rng() * 0.4, attack: 0.02 })
        : tone({ freq: pentaHz(deg, -12), dur, wave: 'pulse12', attack: 0.02, release: 0.09, gain: 0.7 + rng() * 0.4, cutoff: 700 + 1100 * E.bright, vibHz: 5.5, vibDepth: 0.005 });
      mixInto(buf, b * BEAT + (ks[j] * BEAT) / 3, note);
    }
  }
}

function leadAmbient(buf, rng, E, timbre) {
  // arc sur la boucle longue : notes planantes, apex lumineux vers les 3/4
  // (octave supérieure, un peu plus fort), retour au calme pour resboucler
  const nNotes = 5 + (rng() < E.dens ? 2 : 0);
  let t = 0;
  for (let k = 0; k < nNotes; k++) {
    const apex = t > LOOP * 1.2 && t < LOOP * 1.7;
    const deg = apex ? choose(rng, [5, 7]) : choose(rng, [0, 2, 3, 4]);
    const freq = pentaHz(deg, 0) * (apex || rng() < 0.3 ? 2 : 1);
    const dur = 0.9 + rng() * 0.9;
    const gain = apex ? 1.1 : 0.85;
    const note = timbre.voice
      ? voiceTone({ freq, dur, gain, attack: 0.35, release: 0.5, amHz: 4 })
      : tone({ freq, dur, wave: 'sin', attack: 0.4, release: 0.6, gain, vibHz: 3, vibDepth: 0.008, harmonics: [0.15] });
    mixInto(buf, t, note);
    t += 0.75 + rng() * 0.75;
  }
}

// ---------------------------------------------------------------------------
// Table (slot × genre) et pipeline par stem
// ---------------------------------------------------------------------------

const RECETTES = {
  rythme: { Techno: rythmeTechno, Metal: rythmeMetal, Pop: rythmePop, Jazz: rythmeJazz, Ambient: rythmeAmbient },
  basse: { Techno: basseTechno, Metal: basseMetal, Pop: bassePop, Jazz: basseJazz, Ambient: basseAmbient },
  harmonie: { Techno: harmonieTechno, Metal: harmonieMetal, Pop: harmoniePop, Jazz: harmonieJazz, Ambient: harmonieAmbient },
  lead: { Techno: leadTechno, Metal: leadMetal, Pop: leadPop, Jazz: leadJazz, Ambient: leadAmbient },
};

function generateStem(card, slot) {
  const rng = mulberry32(fnv1a(`${card.id}/${slot}`));
  const E = ENERGIE[card.energy];
  const fn = RECETTES[slot]?.[card.genre];
  if (!E || !fn) throw new Error(`recette inconnue : ${card.id} (${card.genre}/${card.energy}) slot ${slot}`);
  // Tous les stems bouclent sur 4 mesures : la progression Am→F→C→G a besoin
  // de la boucle longue, et le moteur accepte tout multiple entier de la base.
  const buf = new Float64Array(STEM_N);
  fn(buf, rng, E, leadTimbre(card.slots[slot].description));

  // Écho circulaire du lead (par genre) : appliqué avant la normalisation
  // pour que le pic cible reste tenu, échos compris.
  if (slot === 'lead') {
    const echo = LEAD_ECHO[card.genre];
    if (echo) circularEcho(buf, echo.delay, echo.feedback, echo.wet);
  }

  // Post : retrait du DC, normalisation, crush 8-bit sur le signal à ±1
  // (pleine échelle de quantification), puis mise au pic cible.
  const n = buf.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += buf[i];
  mean /= n;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    buf[i] -= mean;
    const a = Math.abs(buf[i]);
    if (a > peak) peak = a;
  }
  if (peak < 1e-9) throw new Error(`stem silencieux : ${card.id}/${slot}`);
  for (let i = 0; i < n; i++) buf[i] /= peak;
  chipCrushInPlace(buf);
  // Retour playtest : l'harmonie prenait trop de place dans le mix — voie
  // légèrement en retrait (~ -2 dB) par rapport aux trois autres.
  const slotTrim = slot === 'harmonie' ? 0.78 : 1;
  const scale = E.peak * slotTrim;
  for (let i = 0; i < n; i++) buf[i] *= scale;
  // PAS de fades ici : ils sont posés par canal APRÈS l'élargissement stéréo
  // (la rotation Haas doit tourner un signal circulairement continu).
  return buf;
}

// ---------------------------------------------------------------------------
// Canaux, fades et écriture WAV
// ---------------------------------------------------------------------------

/** Micro-fades de ~3 ms aux bords d'un canal (bouclage sans discontinuité). */
function applyEdgeFades(ch) {
  const FADE = Math.round(0.003 * SR);
  for (let i = 0; i < FADE; i++) {
    const g = i / FADE;
    ch[i] *= g;
    ch[ch.length - 1 - i] *= g;
  }
}

/** Rotation CIRCULAIRE : le signal généré est continu modulo la boucle,
 *  donc le canal tourné reste bouclable — c'est ce qui rend l'élargissement
 *  Haas sûr au rebouclage. */
function rotated(buf, shift) {
  const out = new Float64Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[(i + shift) % buf.length];
  return out;
}

/** Décalage Haas (~12.5 ms) : élargit sans déplacer l'image au centre. */
const HAAS_SAMPLES = Math.round(0.0125 * SR);
/** Slots écrits en stéréo élargie (le reste est mono : poids des assets). */
const STEREO_SLOTS = new Set(['harmonie']);

function stemChannels(card, slot) {
  const mono = generateStem(card, slot);
  if (!STEREO_SLOTS.has(slot)) {
    applyEdgeFades(mono);
    return [mono];
  }
  const right = rotated(mono, HAAS_SAMPLES);
  for (let i = 0; i < right.length; i++) right[i] *= 0.94;
  applyEdgeFades(mono);
  applyEdgeFades(right);
  return [mono, right];
}

/** Décimation d'écriture : le crush tient chaque valeur 4 échantillons à
 *  44.1 kHz, écrire à 22 050 Hz est donc sans perte — et divise le poids
 *  des assets par deux (chargement mobile). */
const OUT_DECIM = 2;
const OUT_SR = SR / OUT_DECIM;

function writeWav(path, channels) {
  const nOut = Math.floor(channels[0].length / OUT_DECIM);
  const nc = channels.length;
  const blockAlign = nc * 2;
  const dataBytes = nOut * blockAlign;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // taille du chunk fmt
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(nc, 22);
  buf.writeUInt32LE(OUT_SR, 24);
  buf.writeUInt32LE(OUT_SR * blockAlign, 28); // octets/s
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(16, 34); // bits/échantillon
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < nOut; i++) {
    for (let c = 0; c < nc; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i * OUT_DECIM]));
      buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + (i * nc + c) * 2);
    }
  }
  writeFileSync(path, buf);
}

// ---------------------------------------------------------------------------
// SFX — applaudissements de fin de scène (docs/playtest-2026-08-14.md §4)
// ---------------------------------------------------------------------------

/**
 * Foule qui applaudit : des dizaines de « mains » claquant à des instants
 * aléatoires (claps = bursts de bruit filtré), sur une enveloppe globale qui
 * monte vite et retombe. Déterministe (PRNG seedé), ~2.8 s.
 */
function generateApplause() {
  const rng = mulberry32(fnv1a('sfx/applause'));
  const dur = 2.8;
  const n = Math.round(dur * SR);
  const out = new Float64Array(n);
  const NB_CLAPS = 260;
  for (let c = 0; c < NB_CLAPS; c++) {
    // Densité maximale vers 0.5 s, claps plus rares vers la fin.
    const at = Math.min(dur - 0.1, Math.abs(rng() + rng() - 0.7) * dur * 0.75);
    const s0 = Math.round(at * SR);
    const decay = 0.008 + rng() * 0.012;
    const gain = 0.25 + rng() * 0.5;
    const len = Math.min(Math.round(decay * 6 * SR), n - s0);
    for (let i = 0; i < len; i++) {
      out[s0 + i] += (rng() * 2 - 1) * Math.exp(-i / SR / decay) * gain;
    }
  }
  // Corps de foule : souffle continu discret sous les claps.
  let hiss = 0;
  for (let i = 0; i < n; i++) {
    hiss += 0.15 * ((rng() * 2 - 1) - hiss);
    out[i] += hiss * 0.5;
  }
  onePoleHPInPlace(out, 400);
  onePoleLPInPlace(out, 7000);
  // Enveloppe globale : montée ~0.15 s, plateau, fondu final.
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const rise = Math.min(1, t / 0.15);
    const fall = t > dur - 0.8 ? (dur - t) / 0.8 : 1;
    out[i] *= rise * fall;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 1e-9) for (let i = 0; i < n; i++) out[i] /= peak;
  chipCrushInPlace(out); // foule lo-fi, cohérente avec le mix 8-bit
  for (let i = 0; i < n; i++) out[i] *= 0.6;
  return out;
}

/**
 * Stingers de pose (la boussole sonore, retour playtest #4) : le public réagit
 * À CHAQUE pose — accord montant si la carte synergise, buzz descendant si
 * elle frotte, gimmick chromatique pour une contradiction demandée.
 */
function generateStinger(kind) {
  const rng = mulberry32(fnv1a(`sfx/pose-${kind}`));
  const dur = 0.5;
  const n = Math.round(dur * SR);
  const out = new Float64Array(n);
  const put = (t0, freq, noteDur, gain, wave = 'pulse25') => {
    const note = tone({ freq, dur: noteDur, wave, attack: 0.004, release: 0.06, gain });
    for (let i = 0; i < note.length && Math.round(t0 * SR) + i < n; i++) {
      out[Math.round(t0 * SR) + i] += note[i];
    }
  };
  if (kind === 'good') {
    // arpège pentatonique montant, bref et lumineux
    put(0, pentaHz(4, 0), 0.06, 0.8);
    put(0.07, pentaHz(5, 0), 0.06, 0.9);
    put(0.14, pentaHz(7, 0), 0.14, 1);
  } else if (kind === 'bad') {
    // seconde mineure descendante qui bourdonne : la moue du public
    put(0, hz(-10), 0.16, 0.9, 'saw');
    put(0.1, hz(-11), 0.22, 0.9, 'saw');
    onePoleLPInPlace(out, 900);
  } else {
    // « dare » : glissé chromatique interrogatif (le public hausse un sourcil)
    put(0, hz(0), 0.07, 0.8);
    put(0.09, hz(1), 0.07, 0.8);
    put(0.18, hz(3), 0.12, 0.95);
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 1e-9) for (let i = 0; i < n; i++) out[i] /= peak;
  chipCrushInPlace(out);
  for (let i = 0; i < n; i++) out[i] *= 0.5;
  // fondu de fin (pas une boucle : simple one-shot propre)
  const FADE = Math.round(0.02 * SR);
  for (let i = 0; i < FADE; i++) out[n - 1 - i] *= i / FADE;
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const t0 = Date.now();
  const force = process.argv.includes('--force');
  const { cards } = JSON.parse(readFileSync(join(ROOT, 'data', 'cards.json'), 'utf8'));
  let generated = 0;
  let skipped = 0;
  for (const card of cards) {
    for (const slot of SLOTS) {
      const dir = join(OUT_DIR, card.id);
      const file = join(dir, `${slot}.wav`);
      if (!force && existsSync(file)) {
        skipped++;
        continue;
      }
      mkdirSync(dir, { recursive: true });
      writeWav(file, stemChannels(card, slot));
      generated++;
    }
  }
  const sfxDir = join(ROOT, 'public', 'assets', 'sfx');
  mkdirSync(sfxDir, { recursive: true });
  const applauseFile = join(sfxDir, 'applause.wav');
  if (force || !existsSync(applauseFile)) {
    writeWav(applauseFile, [generateApplause()]);
    generated++;
  } else {
    skipped++;
  }
  for (const kind of ['good', 'bad', 'dare']) {
    const file = join(sfxDir, `pose-${kind}.wav`);
    if (force || !existsSync(file)) {
      writeWav(file, [generateStinger(kind)]);
      generated++;
    } else {
      skipped++;
    }
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`stems placeholder : ${generated} générés, ${skipped} ignorés (${dt} s)`);
}

main();
