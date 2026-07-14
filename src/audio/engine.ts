/**
 * Moteur audio Tone.js (architecture §3.1 et §4).
 *
 * Lecture glitch-free : un Player par (carte, slot) — 48 pour le deck MVP —
 * tous en boucle, synchronisés sur le transport et démarrés à 0. Comme tout
 * part du même instant, toutes les boucles restent en phase en permanence :
 * « changer de carte » = automation de gain (couper l'ancienne voie, ouvrir
 * la nouvelle), jamais un start/stop de player (architecture §4.3 : voies en
 * actif permanent, gain à 0 quand inaudible).
 */
import * as Tone from 'tone';
import { SLOT_IDS, type AudioEngine, type AudioEngineOptions, type GameData, type SlotId } from '../types';
import { loadAllStems, stemKey } from './loader';

/**
 * Gain staging : 4 voies simultanées à 0.7 chacune peuvent en théorie sommer
 * au-delà de 0 dBFS, mais les stems ne sont pas corrélés ; le limiteur master
 * à -1 dBFS absorbe les crêtes résiduelles. Choix : marge simple par voie
 * + filet de sécurité, plutôt qu'une normalisation stricte par 1/N.
 */
const VOICE_GAIN = 0.7;
/** Micro-rampe anti-clic sur les changements de voie (~10 ms). */
const RAMP_SECONDS = 0.01;
/** Preview : volume modéré (elle se superpose au mix) et fades courts. */
const PREVIEW_VOLUME_DB = -8;
const PREVIEW_FADE_SECONDS = 0.02;

interface Voice {
  player: Tone.Player;
  gain: Tone.Gain;
}

function slotRecord<T>(value: T): Record<SlotId, T> {
  return { rythme: value, basse: value, harmonie: value, lead: value };
}

export function createAudioEngine(data: GameData, opts: AudioEngineOptions): AudioEngine {
  const transport = Tone.getTransport();
  /** Filet anti-clipping du master (cf. VOICE_GAIN). */
  const master = new Tone.Limiter(-1).toDestination();

  /** Voies du mix, clé stemKey(cardId, slot). Absente = stem manquant. */
  const voices = new Map<string, Voice>();
  let buffers = new Map<string, Tone.ToneAudioBuffer>();
  /** Carte audible (ou en passe de l'être au point de quantification) par slot. */
  const applied = slotRecord<string | null>(null);
  /** Id d'évènement transport du changement programmé par slot (dernier gagne). */
  const pending = slotRecord<number | null>(null);

  let initPromise: Promise<void> | null = null;
  let previewPlayer: Tone.Player | null = null;
  let disposed = false;

  /** Rampe le gain d'une voie vers `target` à l'instant `time` (contexte audio). */
  function rampVoice(cardId: string, slot: SlotId, target: number, time: number): void {
    const voice = voices.get(stemKey(cardId, slot));
    if (!voice) return; // stem manquant : voie silencieuse, déjà signalé au chargement
    const g = voice.gain.gain;
    g.cancelScheduledValues(time);
    g.setRampPoint(time);
    g.linearRampToValueAtTime(target, time + RAMP_SECONDS);
  }

  /** Bascule effective du slot : ancienne voie → 0, nouvelle → VOICE_GAIN. */
  function applySwitch(slot: SlotId, cardId: string | null, time: number): void {
    const old = applied[slot];
    if (old === cardId) return;
    if (old !== null) rampVoice(old, slot, 0, time);
    if (cardId !== null) rampVoice(cardId, slot, VOICE_GAIN, time);
    applied[slot] = cardId;
  }

  /**
   * Prochain point de quantification, exprimé en ticks du transport.
   * On ne passe PAS '@1m' à scheduleOnce : Tone 15 y évalue nextSubdivision()
   * en temps du contexte audio puis le relit comme des secondes de transport,
   * ce qui décale l'échéance dès que le transport n'a pas démarré à t=0.
   */
  function nextQuantizedTicks(): string {
    const subdiv = Math.max(1, Math.round(transport.toTicks(opts.quantize)));
    const next = (Math.floor(transport.ticks / subdiv) + 1) * subdiv;
    return `${next}i`;
  }

  async function doInit(): Promise<void> {
    // À appeler depuis un geste utilisateur : débloque l'AudioContext
    // (autoplay policy, architecture §4.4).
    await Tone.start();
    transport.bpm.value = opts.bpm;
    buffers = await loadAllStems(data.cards);

    // Longueur musicale théorique d'une boucle (4/4). Poser loopEnd dessus
    // verrouille la phase même si l'encodeur a ajouté du padding en queue
    // (architecture §4.2).
    const loopSeconds = (opts.loopMeasures * 4 * 60) / opts.bpm;
    for (const card of data.cards) {
      for (const slot of SLOT_IDS) {
        const buffer = buffers.get(stemKey(card.id, slot));
        if (!buffer) continue;
        // Si un setSlot a précédé init, la voie naît déjà ouverte.
        const gain = new Tone.Gain(applied[slot] === card.id ? VOICE_GAIN : 0).connect(master);
        const player = new Tone.Player(buffer);
        player.loop = true;
        if (buffer.duration >= loopSeconds) player.loopEnd = loopSeconds;
        player.connect(gain);
        player.sync().start(0);
        voices.set(stemKey(card.id, slot), { player, gain });
      }
    }
  }

  function stopPreview(): void {
    const player = previewPlayer;
    if (!player) return;
    previewPlayer = null;
    if (player.state === 'started') {
      player.stop(); // le fadeOut s'applique, onstop libère le player
    } else {
      player.dispose();
    }
  }

  return {
    init(): Promise<void> {
      initPromise ??= doInit();
      return initPromise;
    },

    async start(): Promise<void> {
      await Tone.start(); // sans effet si le contexte tourne déjà
      if (transport.state !== 'started') transport.start();
    },

    setSlot(slot: SlotId, cardId: string | null): void {
      if (disposed) return;
      // Dernier gagne : annule le changement déjà programmé pour ce slot.
      const prev = pending[slot];
      if (prev !== null) {
        transport.clear(prev);
        pending[slot] = null;
      }
      if (cardId !== null && !data.cardById.has(cardId)) {
        console.warn(`Carte inconnue « ${cardId} » : slot ${slot} inchangé.`);
        return;
      }
      if (transport.state !== 'started') {
        // Avant le démarrage du transport : application immédiate.
        applySwitch(slot, cardId, Tone.now());
        return;
      }
      pending[slot] = transport.scheduleOnce((time) => {
        pending[slot] = null;
        applySwitch(slot, cardId, time);
      }, nextQuantizedTicks());
    },

    previewCard(cardId: string, slot: SlotId): void {
      if (disposed) return;
      stopPreview(); // un seul preview à la fois
      const buffer = buffers.get(stemKey(cardId, slot));
      if (!buffer) return; // stem manquant, déjà signalé au chargement
      // One-shot hors mix : non synchronisé, jamais raccordé aux voies des
      // slots ; passe par le limiteur master pour l'anti-clipping global.
      const player = new Tone.Player(buffer).connect(master);
      player.fadeIn = PREVIEW_FADE_SECONDS;
      player.fadeOut = PREVIEW_FADE_SECONDS;
      player.volume.value = PREVIEW_VOLUME_DB;
      player.onstop = () => {
        player.dispose();
        if (previewPlayer === player) previewPlayer = null;
      };
      previewPlayer = player;
      player.start(Tone.now(), 0, Math.min(opts.previewSeconds, buffer.duration));
    },

    stopPreview,

    setMuted(muted: boolean): void {
      // Mute global de la destination : l'état des slots (gains, pending)
      // est intact, le mix revient tel quel au unmute.
      Tone.getDestination().mute = muted;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopPreview();
      for (const slot of SLOT_IDS) {
        const id = pending[slot];
        if (id !== null) transport.clear(id);
        pending[slot] = null;
      }
      if (transport.state !== 'stopped') transport.stop();
      for (const voice of voices.values()) {
        voice.player.unsync();
        voice.player.dispose();
        voice.gain.dispose();
      }
      voices.clear();
      for (const buffer of buffers.values()) buffer.dispose();
      buffers.clear();
      master.dispose();
      // Le transport est un singleton global : on l'arrête, on ne le dispose pas.
    },
  };
}
