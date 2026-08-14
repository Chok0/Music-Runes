/**
 * Préchargement des stems (architecture §3.1 et §4.2-4.3).
 *
 * cards.json stocke un chemin canonique en `.ogg` ; le format réellement
 * présent sur disque dépend de l'environnement (`.m4a` pour Safari,
 * `.wav` pour les placeholders de scripts/generate-stems.mjs).
 *
 * Stratégie : PAS de requêtes HEAD (certains hébergeurs statiques les
 * refusent en 403/405) ni de sniff de content-type — on tente directement
 * le chargement/décodage : une 404 (même déguisée en fallback HTML du
 * serveur de dev) fait échouer le décodage, on passe à l'extension
 * suivante. L'extension gagnante du premier stem est mémorisée et les 47
 * autres se chargent EN PARALLÈLE avec elle (repli individuel si besoin).
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

/**
 * Charge un stem en essayant les extensions candidates (celle du cache en
 * premier). Met à jour `cache.ext` sur succès. null si tout échoue.
 */
async function loadStem(
  canonicalPath: string,
  cache: { ext: StemExtension | null },
): Promise<Tone.ToneAudioBuffer | null> {
  const base = canonicalPath.replace(/\.[a-z0-9]+$/i, '');
  const candidates: StemExtension[] = cache.ext
    ? [cache.ext, ...STEM_EXTENSIONS.filter((e) => e !== cache.ext)]
    : [...STEM_EXTENSIONS];
  for (const ext of candidates) {
    try {
      const buffer = await Tone.ToneAudioBuffer.fromUrl(`${import.meta.env.BASE_URL}${base}.${ext}`);
      cache.ext = ext;
      return buffer;
    } catch {
      // Extension absente ou réponse indécodable : on essaie la suivante.
    }
  }
  return null;
}

/**
 * Charge TOUS les buffers avant de résoudre (architecture §4.3 : aucun
 * décodage pendant le jeu). Le premier stem sert de sonde d'extension
 * (séquentiel), tout le reste part en parallèle — le navigateur limite
 * lui-même la concurrence des fetchs. Retourne une Map clé `stemKey` →
 * buffer ; les stems manquants sont signalés en console et absents de la Map.
 */
export async function loadAllStems(
  cards: readonly Card[],
): Promise<Map<string, Tone.ToneAudioBuffer>> {
  const buffers = new Map<string, Tone.ToneAudioBuffer>();
  const cache: { ext: StemExtension | null } = { ext: null };

  const jobs: { key: string; path: string; label: string }[] = [];
  for (const card of cards) {
    for (const slot of SLOT_IDS) {
      jobs.push({
        key: stemKey(card.id, slot),
        path: card.slots[slot].stem,
        label: `« ${card.name} » (${slot})`,
      });
    }
  }
  if (jobs.length === 0) return buffers;

  const run = async (job: (typeof jobs)[number]): Promise<void> => {
    const buffer = await loadStem(job.path, cache);
    if (buffer) buffers.set(job.key, buffer);
    else console.warn(`Stem introuvable pour ${job.label} : voie silencieuse.`);
  };

  // Sonde : le premier stem fixe l'extension du déploiement…
  await run(jobs[0]!);
  // …puis tout le reste en parallèle avec cette extension en tête.
  await Promise.all(jobs.slice(1).map(run));
  return buffers;
}
