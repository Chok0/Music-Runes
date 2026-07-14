/**
 * Préchargement des stems (architecture §3.1 et §4.2-4.3).
 *
 * cards.json stocke un chemin canonique en `.ogg` ; le format réellement
 * présent sur disque dépend de l'environnement (`.m4a` pour Safari,
 * `.wav` pour les placeholders de scripts/generate-stems.mjs). On sonde
 * donc les extensions par fetch HEAD et on charge la première qui répond.
 * Un stem introuvable n'est jamais fatal : la voie restera silencieuse.
 */
import * as Tone from 'tone';
import { SLOT_IDS, type Card, type SlotId } from '../types';

/** Extensions candidates, dans l'ordre de préférence (modele-de-donnees §2). */
const STEM_EXTENSIONS = ['ogg', 'm4a', 'wav'] as const;
type StemExtension = (typeof STEM_EXTENSIONS)[number];

/** Clé d'un buffer/voie : une par (carte, slot). */
export function stemKey(cardId: string, slot: SlotId): string {
  return `${cardId}/${slot}`;
}

/** true si l'URL répond et n'est pas le fallback HTML du serveur de dev. */
async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    return res.ok && !type.includes('text/html');
  } catch {
    return false;
  }
}

/**
 * Résout l'URL réelle d'un stem à partir du chemin canonique `.ogg`.
 * `cache.ext` mémorise la première extension qui marche : elle est essayée
 * en premier pour les stems suivants (un seul format par déploiement).
 */
async function resolveStemUrl(
  canonicalPath: string,
  cache: { ext: StemExtension | null },
): Promise<string | null> {
  const base = canonicalPath.replace(/\.[a-z0-9]+$/i, '');
  const candidates: StemExtension[] = cache.ext
    ? [cache.ext, ...STEM_EXTENSIONS.filter((e) => e !== cache.ext)]
    : [...STEM_EXTENSIONS];
  for (const ext of candidates) {
    const url = `/${base}.${ext}`;
    if (await probe(url)) {
      cache.ext = ext;
      return url;
    }
  }
  return null;
}

/**
 * Charge TOUS les buffers avant de résoudre (architecture §4.3 : aucun
 * décodage pendant le jeu). Cartes en séquence pour que le cache d'extension
 * profite aux suivantes ; les 4 slots d'une carte sont sondés en parallèle.
 * Retourne une Map clé `stemKey` → buffer ; les stems manquants sont
 * signalés en console et absents de la Map.
 */
export async function loadAllStems(
  cards: readonly Card[],
): Promise<Map<string, Tone.ToneAudioBuffer>> {
  const buffers = new Map<string, Tone.ToneAudioBuffer>();
  const cache: { ext: StemExtension | null } = { ext: null };
  for (const card of cards) {
    await Promise.all(
      SLOT_IDS.map(async (slot) => {
        const url = await resolveStemUrl(card.slots[slot].stem, cache);
        if (url === null) {
          console.warn(`Stem introuvable pour « ${card.name} » (${slot}) : voie silencieuse.`);
          return;
        }
        try {
          buffers.set(stemKey(card.id, slot), await Tone.ToneAudioBuffer.fromUrl(url));
        } catch {
          console.warn(
            `Échec de décodage du stem ${url} (« ${card.name} », ${slot}) : voie silencieuse.`,
          );
        }
      }),
    );
  }
  return buffers;
}
