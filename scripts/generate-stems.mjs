#!/usr/bin/env node
/**
 * Générateur de stems placeholder — Music Runes.
 *
 * Synthétise en pur Node (aucune dépendance npm) les 48 boucles audio du deck
 * MVP (12 cartes × 4 slots) décrites par data/cards.json, en WAV PCM 16-bit
 * mono 44100 Hz, dans public/assets/stems/<id>/<slot>.wav.
 *
 * Contraintes (docs/architecture-technique.md §4) :
 * - 2 mesures à 120 BPM en 4/4 = 4.000 s exactement (176400 échantillons) ;
 * - tonalité commune La mineur : tous les stems sont superposables ;
 * - bouclage propre : queues écrites circulairement (modulo la boucle) +
 *   micro-fades de ~3 ms aux bords ;
 * - pic normalisé ≈ 0.5 pour que 4 voies se superposent sans clipper.
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
const LOOP = AUDIO.loop_measures * 4 * BEAT; // en 4/4 (4.000 s par défaut)
const N = Math.round(SR * LOOP); // échantillons par boucle
const STEP = BEAT / 4; // grille de doubles-croches
const SLOTS = ['rythme', 'basse', 'harmonie', 'lead'];

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
};

/** Mixe `arr` dans `buf` à partir de t0, en écriture CIRCULAIRE (modulo la
 *  boucle) : les queues qui dépassent retombent au début → bouclage propre. */
function mixInto(buf, t0, arr, gain = 1) {
  const s0 = Math.round(t0 * SR);
  const len = Math.min(arr.length, N);
  for (let i = 0; i < len; i++) buf[(s0 + i) % N] += arr[i] * gain;
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
  // four-on-the-floor : kick chaque noire, hats sur les contretemps
  for (let b = 0; b < 8; b++) {
    mixInto(buf, b * BEAT, kickHit({ f0: 105, f1: 45, ampTau: 0.085, drive: 1 + E.drive * 0.8 }));
    mixInto(buf, b * BEAT + BEAT / 2, hatHit(rng, { decay: 0.02 + 0.012 * E.bright, gain: 0.32 }));
  }
  // doubles-croches fantômes selon la densité
  for (let s = 0; s < 32; s++) {
    if (s % 2 === 0) continue;
    if (rng() < (E.dens - 0.5) * 0.8) {
      mixInto(buf, s * STEP, hatHit(rng, { decay: 0.012, gain: 0.14, hp: 6500 }));
    }
  }
  if (E.dens >= 1) {
    // charley ouvert en fin de mesure
    for (const t of [1.75, 3.75]) mixInto(buf, t, hatHit(rng, { decay: 0.09, gain: 0.26, hp: 5000 }));
  }
}

function rythmeMetal(buf, rng, E) {
  // double pédale : rafales de doubles-croches, snare backbeat (temps 2 et 4)
  for (let b = 0; b < 8; b++) {
    const sub = rng() < 0.15 + 0.6 * E.dens ? 4 : 2;
    for (let k = 0; k < sub; k++) {
      mixInto(buf, b * BEAT + (k * BEAT) / sub,
        kickHit({ f0: 130, f1: 52, dur: 0.14, ampTau: 0.045, drive: 1.5 + E.drive, gain: k % 2 ? 0.8 : 1 }));
    }
    if (b % 2 === 1) mixInto(buf, b * BEAT, snareHit(rng, { gain: 1.1, decay: 0.09 }));
  }
  if (E.dens >= 1) mixInto(buf, 0, hatHit(rng, { decay: 0.45, gain: 0.22, hp: 4500 })); // pseudo-crash sur le 1
}

function rythmePop(buf, rng, E) {
  const brushes = E.dens < 0.7; // « beat léger, brushes » en Calme
  const kicks = [0, 8, 16, 24];
  if (rng() < 0.7) kicks.push(choose(rng, [10, 11, 22, 26])); // syncope
  for (const s of kicks) mixInto(buf, s * STEP, kickHit({ f0: 95, f1: 50, ampTau: 0.06, drive: 1 + E.drive * 0.4 }));
  for (const s of [4, 12, 20, 28]) {
    mixInto(buf, s * STEP, brushes
      ? brushHit(rng, { gain: 0.6, attack: 0.005, decay: 0.09 })
      : snareHit(rng, { gain: 0.9, decay: 0.11, body: 190 }));
  }
  for (let s = 0; s < 32; s += 2) {
    const accent = s % 4 === 2 ? 1 : 0.6;
    mixInto(buf, s * STEP, brushes
      ? brushHit(rng, { gain: 0.18 * accent, attack: 0.004, decay: 0.03 })
      : hatHit(rng, { decay: E.bright > 1 ? 0.03 : 0.02, gain: 0.22 * accent, hp: 6000 }));
  }
}

function rythmeJazz(buf, rng, E) {
  // ride « ding ding-a-ding » : la skip-note tombe au 2/3 du temps (ternaire)
  for (let b = 0; b < 8; b++) {
    mixInto(buf, b * BEAT, hatHit(rng, { decay: 0.18, gain: 0.4 * (b % 2 ? 0.85 : 1), hp: 4200 }));
    if (b % 2 === 1) {
      if (rng() < 0.4 + 0.6 * E.dens) {
        mixInto(buf, b * BEAT + (2 * BEAT) / 3, hatHit(rng, { decay: 0.12, gain: 0.28, hp: 4200 }));
      }
      mixInto(buf, b * BEAT, hatHit(rng, { decay: 0.012, gain: 0.18, hp: 2500 })); // charley au pied
    }
    if (b % 2 === 0 || E.dens > 0.7) mixInto(buf, b * BEAT, brushHit(rng, { gain: 0.2 }));
  }
}

function rythmeAmbient(buf, rng, E) {
  // percussions éparses : quelques hits résonnants accordés (pentatonique basse)
  const nHits = Math.max(2, Math.round((3 + rng() * 3) * E.dens));
  const used = new Set();
  for (let k = 0; k < nHits; k++) {
    let s = Math.floor(rng() * 32);
    if (used.has(s)) s = (s + 7) % 32;
    used.add(s);
    const deg = choose(rng, [0, 1, 2, 4]);
    mixInto(buf, s * STEP, percResonant(rng, { freq: pentaHz(deg, -24), gain: 0.7 + rng() * 0.4 }));
  }
}

// ---------------------------------------------------------------------------
// Recettes de synthèse — BASSE
// ---------------------------------------------------------------------------

function basseTechno(buf, rng, E) {
  // ligne acide en croches : square + passe-bas résonnant dont le cutoff marche
  let cutoff = 300;
  for (let e = 0; e < 16; e++) {
    if (rng() < 0.25 * (1 - E.dens)) continue;
    const semi = choose(rng, [0, 0, 0, 12, 3, 10]); // A1, octave, C, G
    const accent = rng() < 0.3;
    cutoff = Math.max(200, Math.min(3200, cutoff + (rng() * 2 - 1) * 700 * E.bright + (accent ? 400 : 0)));
    const note = tone({ freq: hz(-36 + semi), dur: 0.16, wave: 'square', attack: 0.003, release: 0.05, gain: accent ? 1.15 : 0.9 });
    biquadLPInPlace(note, cutoff * (0.6 + 0.4 * E.bright), 5);
    applyDrive(note, 1.2 + E.drive * 0.8);
    mixInto(buf, e * 2 * STEP, note);
  }
}

function basseMetal(buf, rng, E) {
  // palm-mute saccadé sur A1 : saw courte très saturée, rafales avec des trous
  for (let s = 0; s < 32; s++) {
    const onBeat = s % 4 === 0;
    if (!onBeat && rng() > 0.35 + 0.55 * E.dens) continue;
    const semi = rng() < 0.12 ? choose(rng, [3, 10]) : 0;
    const note = tone({ freq: hz(-36 + semi), dur: 0.085, wave: 'saw', attack: 0.002, release: 0.03, gain: onBeat ? 1 : 0.8, drive: 2.5 * E.drive });
    onePoleLPInPlace(note, 300 + 700 * E.bright);
    mixInto(buf, s * STEP, note);
  }
}

function bassePop(buf, rng, E) {
  // ronde et groovy : sinus, attaque douce, motif syncopé
  const grid = [0, 6, 8, 14, 16, 22, 24, 28];
  for (let i = 0; i < grid.length; i++) {
    if (i % 2 === 1 && rng() > 0.3 + 0.7 * E.dens) continue;
    const semi = rng() < 0.7 ? 0 : choose(rng, [12, 7, 3]); // A, octave, E, C
    const note = tone({ freq: hz(-36 + semi), dur: 0.3 + 0.1 * (1 - E.dens), wave: 'sin', attack: 0.02, release: 0.12, gain: 1, drive: 1.2, harmonics: [0.2] });
    mixInto(buf, grid[i] * STEP, note);
  }
}

function basseJazz(buf, rng, E) {
  // walking bass en noires sur la gamme de Am, résolution vers A au rebouclage
  let s = 0; // degré de gamme relatif à A2
  for (let q = 0; q < 8; q++) {
    let cur = s;
    if (q === 0) cur = 0;
    if (q === 7) cur = rng() < 0.5 ? -1 : 1; // G ou B : sensible vers la tonique
    const note = tone({ freq: scaleHz(-24, cur), dur: 0.42, wave: 'sin', attack: 0.008, release: 0.09, gain: 0.85 + rng() * 0.3, harmonics: [0.3, 0.12] });
    mixInto(buf, q * BEAT, note);
    s = Math.max(-4, Math.min(8, cur + choose(rng, [-2, -1, 1, 1, 2])));
  }
}

function basseAmbient(buf, rng, E) {
  // drone A1 tenu : détune de 0.25 Hz et LFO à cycles entiers sur 4 s → périodique
  const tmp = new Float64Array(N);
  const phi = rng() * 2 * Math.PI;
  let p1 = rng(), p2 = rng(), p3 = rng();
  const octGain = 0.2 + rng() * 0.15;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    p1 += 55 / SR;
    p2 += 55.25 / SR;
    p3 += 110 / SR;
    const amp = 0.8 + 0.2 * Math.sin(2 * Math.PI * 0.25 * t + phi);
    tmp[i] = (Math.sin(2 * Math.PI * p1) + Math.sin(2 * Math.PI * p2) * 0.8 + Math.sin(2 * Math.PI * p3) * octGain) * amp;
  }
  onePoleLPSweepInPlace(tmp, (t) => 120 + 90 * E.bright * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.5 * t)));
  mixInto(buf, 0, tmp);
}

// ---------------------------------------------------------------------------
// Recettes de synthèse — HARMONIE (accords construits sur Am)
// ---------------------------------------------------------------------------

function harmonieTechno(buf, rng, E) {
  // nappe saw sombre : Am7 grave, saws détunées, passe-bas balayé lentement
  const pad = new Float64Array(N);
  for (const semi of [-24, -21, -17, -12]) { // A2 C3 E3 A3
    const f = hz(semi);
    const d = choose(rng, [0.25, 0.5]); // détune en Hz à cycles entiers sur la boucle
    let p1 = rng(), p2 = rng();
    for (let i = 0; i < N; i++) {
      p1 += f / SR;
      p2 += (f + d) / SR;
      pad[i] += (OSC.saw(p1) + OSC.saw(p2)) * 0.125;
    }
  }
  onePoleLPSweepInPlace(pad, (t) => 300 + 380 * E.bright * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.5 * t - Math.PI / 2)));
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    pad[i] = Math.tanh(pad[i] * (2 + E.drive)) * (0.75 + 0.25 * Math.sin(Math.PI * t / LOOP) ** 2);
  }
  mixInto(buf, 0, pad);
}

function harmonieMetal(buf, rng, E) {
  // power chord A5 (A2-E3-A3) distordu, martelé en croches
  const A5 = [-24, -17, -12];
  for (let e = 0; e < 16; e++) {
    if (rng() < 0.1 * (1.2 - E.dens)) continue;
    const muted = rng() < 0.3;
    const hit = chordHit(A5, {
      dur: muted ? 0.09 : 0.19, wave: 'saw', attack: 0.003, release: 0.04,
      gain: e % 4 === 0 ? 1 : 0.82, drive: 2.5 + 1.5 * E.drive,
      cutoff: 900 + 1400 * E.bright, q: 0.8,
    });
    mixInto(buf, e * 2 * STEP, hit);
  }
}

function harmoniePop(buf, rng, E) {
  // accords plaqués brillants : Am et ses renversements (superposables sur Am)
  const chords = [
    [-12, -9, -5], // Am  (A3 C4 E4)
    [-9, -5, 0],   // Am/C (C4 E4 A4)
    [-12, -9, -5, -2], // Am7 (A3 C4 E4 G4)
    [-17, -12, -9],    // Am/E (E3 A3 C4)
  ];
  for (let h = 0; h < 4; h++) {
    const hit = chordHit(chords[h], {
      dur: 0.6, wave: 'saw', attack: 0.005, release: 0.3, gain: 1,
      strum: 0.009, cutoff: 900 + 1900 * E.bright, q: 0.9, detune: 0.004,
    });
    mixInto(buf, h * BEAT * 2, hit); // un accord par blanche
    if (E.dens >= 1) {
      mixInto(buf, h * BEAT * 2 + BEAT * 1.5,
        chordHit(chords[h], { dur: 0.1, wave: 'saw', attack: 0.004, release: 0.06, gain: 0.5, cutoff: 900 + 1900 * E.bright }));
    }
  }
}

function harmonieJazz(buf, rng, E) {
  // Am7/9 feutré type rhodes : sinus + partiels, trémolo léger, comping swing
  const voicing = [-12, -9, -5, -2, 2]; // A3 C4 E4 G4 B4
  const swing = [0, 0.833, 1.5, 2.0, 2.833, 3.5]; // temps + « ands » ternaires
  for (let i = 0; i < swing.length; i++) {
    if (i !== 0 && rng() > 0.25 + 0.5 * E.dens) continue;
    const hit = chordHit(voicing, {
      dur: 0.8 + rng() * 0.4, wave: 'sin', attack: 0.012, release: 0.5,
      gain: 0.8 + rng() * 0.3, harmonics: [0.35, 0.1], amHz: 5.2, amDepth: 0.22,
    });
    mixInto(buf, swing[i], hit);
  }
}

function harmonieAmbient(buf, rng, E) {
  // textures évolutives : tons d'Am en sinus/tri, LFO d'amplitude déphasés
  // (fréquences de LFO à cycles entiers sur 4 s → boucle continue)
  const pad = new Float64Array(N);
  const tones = [-24, -17, -12, -9, -5]; // A2 E3 A3 C4 E4
  for (const semi of tones) {
    const f = hz(semi);
    const lfoHz = choose(rng, [0.25, 0.5, 0.75]);
    const phi = rng() * 2 * Math.PI;
    let p1 = rng(), p2 = rng();
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      p1 += f / SR;
      p2 += (f + 0.25) / SR;
      const amp = 0.25 + 0.375 * (1 + Math.sin(2 * Math.PI * lfoHz * t + phi));
      pad[i] += (Math.sin(2 * Math.PI * p1) + OSC.tri(p2) * 0.4) * amp * 0.2;
    }
  }
  const phi0 = rng() * 2 * Math.PI;
  onePoleLPSweepInPlace(pad, (t) => 450 + 900 * E.bright * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.25 * t + phi0)));
  mixInto(buf, 0, pad);
}

// ---------------------------------------------------------------------------
// Recettes de synthèse — LEAD (pentatonique de La mineur, motif seedé)
// ---------------------------------------------------------------------------

/** Les descriptions « voix/vocal/cri » basculent sur le timbre formants+AM. */
function leadTimbre(description) {
  return {
    voice: /voix|vocal|chant|cri|ch(?:œ|oe)ur/i.test(description),
    robot: /robot/i.test(description),
  };
}

function leadTechno(buf, rng, E, timbre) {
  // arpège acide en doubles-croches (croches en Calme), cutoff balayé sur la boucle
  const motif = Array.from({ length: 8 }, () => choose(rng, [0, 2, 3, 4, 5, 7]));
  motif[0] = 0; // ancre sur la tonique
  const div = E.dens < 0.7 ? 2 : 1;
  for (let s = 0; s < 32; s += div) {
    const deg = motif[(s / div) % 8] + (s >= 16 && rng() < 0.3 ? 5 : 0);
    const accent = s % 4 === 0 ? 1 : 0.75;
    let note;
    if (timbre.voice) {
      note = voiceTone({ freq: pentaHz(deg, 0), dur: 0.1 * div, robot: timbre.robot, gain: accent, attack: 0.004, release: 0.03 });
    } else {
      note = tone({ freq: pentaHz(deg, -12), dur: 0.09 * div, wave: 'square', attack: 0.002, release: 0.03, gain: accent });
      const sweep = 0.5 + 0.5 * Math.sin((2 * Math.PI * s) / 32 - Math.PI / 2);
      biquadLPInPlace(note, 400 + (400 + 2000 * E.bright) * sweep, 5);
      applyDrive(note, 1 + E.drive);
    }
    mixInto(buf, s * STEP, note);
  }
}

function leadMetal(buf, rng, E, timbre) {
  // riff agressif : motif d'une mesure en croches, répété avec variation de fin
  const motif = Array.from({ length: 8 }, (_, i) => (i % 4 === 3 && rng() < 0.35 ? null : choose(rng, [0, 1, 2, 3, 5])));
  motif[0] = 0;
  for (let bar = 0; bar < 2; bar++) {
    for (let e = 0; e < 8; e++) {
      let deg = motif[e];
      if (deg === null) continue;
      if (bar === 1 && e >= 6) deg = choose(rng, [5, 7]); // fin de riff qui monte
      const doubles = E.dens >= 1 && rng() < 0.4 ? 2 : 1;
      for (let k = 0; k < doubles; k++) {
        const note = timbre.voice
          ? voiceTone({ freq: pentaHz(deg, 0), dur: 0.13, robot: timbre.robot, gain: 1, attack: 0.006, drive: 2 + E.drive })
          : tone({ freq: pentaHz(deg, -24), dur: 0.16 / doubles, wave: 'saw', attack: 0.002, release: 0.04, gain: 1, drive: 3 * E.drive, cutoff: 800 + 1700 * E.bright });
        mixInto(buf, bar * 2 + e * 2 * STEP + k * STEP, note);
      }
    }
  }
}

function leadPop(buf, rng, E, timbre) {
  // hook en croches : motif répété 2x, cadence finale vers la tonique
  const motif = Array.from({ length: 8 }, () => (rng() < 0.2 ? null : choose(rng, [0, 2, 3, 4, 5, 7])));
  motif[0] = choose(rng, [4, 5]); // départ haut, accrocheur
  for (let bar = 0; bar < 2; bar++) {
    for (let e = 0; e < 8; e++) {
      let deg = motif[e];
      if (bar === 1 && e >= 6) deg = e === 6 ? 2 : 0;
      if (deg === null) continue;
      const dur = 0.18 + (e % 2) * 0.04;
      const note = timbre.voice
        ? voiceTone({ freq: pentaHz(deg, 0), dur, gain: e % 4 === 0 ? 1.1 : 0.9, attack: 0.015 })
        : tone({ freq: pentaHz(deg, 0), dur, wave: 'tri', attack: 0.008, release: 0.08, gain: 1, cutoff: 1200 + 1800 * E.bright, vibHz: 5, vibDepth: 0.004 });
      mixInto(buf, bar * 2 + e * 2 * STEP, note);
    }
  }
}

function leadJazz(buf, rng, E, timbre) {
  // phrase swing « improvisée » : triolets, marche par degrés pentatoniques
  let deg = choose(rng, [4, 5, 6]);
  for (let b = 0; b < 8; b++) {
    if (rng() < 0.25 * (1.6 - E.dens)) continue; // respirations
    const r = rng();
    const ks = r < 0.45 ? [0] : r < 0.8 ? [0, 2] : [0, 1, 2]; // positions ternaires
    for (let j = 0; j < ks.length; j++) {
      deg = Math.max(0, Math.min(9, deg + choose(rng, [-2, -1, -1, 1, 1, 2])));
      const dur = j === ks.length - 1 ? 0.26 : 0.12;
      const note = timbre.voice
        ? voiceTone({ freq: pentaHz(deg, -12), dur, gain: 0.7 + rng() * 0.4, attack: 0.02 })
        : tone({ freq: pentaHz(deg, -12), dur, wave: 'tri', attack: 0.02, release: 0.09, gain: 0.7 + rng() * 0.4, cutoff: 700 + 1100 * E.bright, harmonics: [0.25], vibHz: 5.5, vibDepth: 0.005 });
      mixInto(buf, b * BEAT + (ks[j] * BEAT) / 3, note);
    }
  }
}

function leadAmbient(buf, rng, E, timbre) {
  // notes longues aériennes, chevauchées ; queues bouclées circulairement
  const nNotes = 3 + (rng() < E.dens ? 1 : 0);
  let t = 0;
  for (let k = 0; k < nNotes; k++) {
    const deg = choose(rng, [0, 2, 3, 4, 5, 7]);
    const freq = pentaHz(deg, 0) * (rng() < 0.3 ? 2 : 1);
    const dur = 0.9 + rng() * 0.9;
    const note = timbre.voice
      ? voiceTone({ freq, dur, gain: 0.9, attack: 0.35, release: 0.5, amHz: 4 })
      : tone({ freq, dur, wave: 'sin', attack: 0.4, release: 0.6, gain: 0.9, vibHz: 3, vibDepth: 0.008, harmonics: [0.15] });
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
  const buf = new Float64Array(N);
  fn(buf, rng, E, leadTimbre(card.slots[slot].description));

  // Post : retrait du DC, normalisation au pic cible, micro-fades de ~3 ms
  // aux bords (garantit un point de bouclage sans discontinuité).
  let mean = 0;
  for (let i = 0; i < N; i++) mean += buf[i];
  mean /= N;
  let peak = 0;
  for (let i = 0; i < N; i++) {
    buf[i] -= mean;
    const a = Math.abs(buf[i]);
    if (a > peak) peak = a;
  }
  if (peak < 1e-9) throw new Error(`stem silencieux : ${card.id}/${slot}`);
  const scale = E.peak / peak;
  for (let i = 0; i < N; i++) buf[i] *= scale;
  const FADE = Math.round(0.003 * SR);
  for (let i = 0; i < FADE; i++) {
    const g = i / FADE;
    buf[i] *= g;
    buf[N - 1 - i] *= g;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Écriture WAV (PCM 16-bit mono 44100 Hz)
// ---------------------------------------------------------------------------

function writeWav(path, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // taille du chunk fmt
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28); // octets/s
  buf.writeUInt16LE(2, 32); // alignement de bloc
  buf.writeUInt16LE(16, 34); // bits/échantillon
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2);
  }
  writeFileSync(path, buf);
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
      writeWav(file, generateStem(card, slot));
      generated++;
    }
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`stems placeholder : ${generated} générés, ${skipped} ignorés (${dt} s)`);
}

main();
