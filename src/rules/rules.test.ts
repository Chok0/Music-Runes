/**
 * Tests du moteur de règles/scoring (Proposition 1 paramétrée).
 *
 * Les valeurs attendues sont calculées À LA MAIN à partir des vraies données
 * (data/*.json) et de la spec docs/modele-de-donnees.md §3-4 ; le détail des
 * calculs est en commentaire au-dessus de chaque assertion.
 *
 * Rappel des tags des cartes utilisées (data/cards.json) :
 *   loup-statique      Techno  Intense
 *   echo-bleute        Techno  Calme
 *   lame-cercle        Techno  Neutre
 *   enclume-rouge      Metal   Intense
 *   cendre-grise       Metal   Neutre
 *   neon-carre         Pop     Intense
 *   ruban-doux         Pop     Calme
 *   marteau-carre      Pop     Neutre
 *   velours-triangle   Jazz    Neutre
 *   cuivre-calme       Jazz    Calme
 *   brume-hexagone     Ambient Calme
 *   poussiere-d-etoile Ambient Neutre
 *
 * Barème (data/scoring.json) : même Genre +2, même Énergie +1, contraste
 * Calme↔Intense +2, conflit de Genre non demandé −2, condition remplie +5,
 * bonus audacieux +10. Conflits : Metal↔Ambient, Metal↔Jazz, Techno↔Jazz,
 * Techno↔Ambient.
 */
import { describe, expect, it } from 'vitest';
import { loadGameData } from '../data/load';
import type { Card, Energy, Genre, Recipe, ScoringConfig } from '../types';
import { createRules } from './index';

const data = loadGameData();
const rules = createRules();
const cfg = data.scoring;

function card(id: string): Card {
  const c = data.cardById.get(id);
  if (!c) throw new Error(`carte absente des données de test : ${id}`);
  return c;
}

function recipe(id: string): Recipe {
  const r = data.recipeById.get(id);
  if (!r) throw new Error(`recette absente des données de test : ${id}`);
  return r;
}

/** Carte synthétique pour isoler une interaction précise (tags seuls lus par le score). */
function fakeCard(id: string, genre: Genre, energy: Energy): Card {
  const variant = { description: 'stub de test', stem: `assets/stems/${id}.ogg` };
  return {
    id,
    name: id,
    genre,
    energy,
    value: 1, // la valeur n'entre pas dans evaluateBoard (cash, pas étoiles)
    rarity: 'commune',
    slots: { rythme: variant, basse: variant, harmonie: variant, lead: variant },
  };
}

// ---------------------------------------------------------------------------
// 1. matchesFilter — ET entre champs, OU dans un champ
// ---------------------------------------------------------------------------
describe('matchesFilter', () => {
  const filter = { genre: ['Jazz', 'Ambient'] as Genre[], energy: ['Calme'] as Energy[] };

  it('accepte une carte qui matche chaque champ (OU dans le champ genre)', () => {
    // cuivre-calme : Jazz ∈ {Jazz, Ambient} ET Calme ∈ {Calme}
    expect(rules.matchesFilter(card('cuivre-calme'), filter)).toBe(true);
    // brume-hexagone : Ambient ∈ {Jazz, Ambient} (OU) ET Calme
    expect(rules.matchesFilter(card('brume-hexagone'), filter)).toBe(true);
  });

  it('rejette si UN champ échoue (ET entre champs)', () => {
    // velours-triangle : Jazz ✓ mais Neutre ∉ {Calme}
    expect(rules.matchesFilter(card('velours-triangle'), filter)).toBe(false);
    // echo-bleute : Calme ✓ mais Techno ∉ {Jazz, Ambient}
    expect(rules.matchesFilter(card('echo-bleute'), filter)).toBe(false);
  });

  it('un champ absent ne contraint pas ; filtre vide = tout matche', () => {
    expect(rules.matchesFilter(card('loup-statique'), { energy: ['Intense'] })).toBe(true);
    expect(rules.matchesFilter(card('loup-statique'), {})).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. « Set monochrome » : 3 Techno + 1 Pop → condition non remplie
// ---------------------------------------------------------------------------
describe('« Set monochrome » (all_same_genre)', () => {
  it('3 Techno + 1 Pop : condition non remplie, 3 paires même genre', () => {
    // Plateau : loup-statique (Techno Intense), echo-bleute (Techno Calme),
    // lame-cercle (Techno Neutre), marteau-carre (Pop Neutre).
    // Paires (C(4,2) = 6) :
    //   loup×echo    : même genre +2, contraste Intense↔Calme +2  → +4
    //   loup×lame    : même genre +2                              → +2
    //   echo×lame    : même genre +2                              → +2
    //   loup×marteau : rien (Techno/Pop non en conflit)           →  0
    //   echo×marteau : rien                                       →  0
    //   lame×marteau : même énergie Neutre +1                     → +1
    // coherence = 9 ; all_same_genre non remplie (Pop présent) → objective = 0
    // audacious = 0 ; total = 9.
    const placed = [card('loup-statique'), card('echo-bleute'), card('lame-cercle'), card('marteau-carre')];
    const b = rules.evaluateBoard(placed, recipe('set-monochrome'), cfg);

    const sameGenre = b.pairs.filter((p) => p.kind === 'same_genre');
    expect(sameGenre).toHaveLength(3);
    expect(sameGenre.every((p) => p.points === 2)).toBe(true);
    // Les 3 paires même genre sont bien entre les 3 Techno.
    const technos = new Set(['loup-statique', 'echo-bleute', 'lame-cercle']);
    expect(sameGenre.every((p) => technos.has(p.a) && technos.has(p.b))).toBe(true);

    expect(b.conditions[0]?.met).toBe(false);
    expect(b.conditions[0]?.points).toBe(0);
    expect(b.coherence).toBe(9);
    expect(b.objective).toBe(0);
    expect(b.audacious).toBe(0);
    expect(b.audaciousApplied).toBe(false);
    expect(b.total).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// 3. « Techno Romantique » : conflit demandé → exemption + bonus audacieux
// ---------------------------------------------------------------------------
describe('« Techno Romantique » (conflit demandé)', () => {
  it('Techno + Jazz Calme : pas de −2, +10 audacieux, +5 +5, contraste +2', () => {
    // Plateau : loup-statique (Techno Intense), cuivre-calme (Jazz Calme),
    // marteau-carre (Pop Neutre) + pop-neutre-bis (Pop Neutre synthétique).
    // Nota : aucune carte du set ne peut être totalement neutre vis-à-vis de
    // {Techno Intense, Jazz Calme} ET de l'autre remplisseuse ; deux Pop
    // Neutre n'interagissent qu'entre elles (+2 même genre, +1 même énergie).
    // Paires :
    //   loup×cuivre : conflit Techno↔Jazz DEMANDÉ (loup matche la condition
    //     min_count genre [Techno], cuivre matche min_count genre
    //     [Jazz, Ambient] + énergie [Calme], deux conditions différentes)
    //     → requested_conflict 0 (exempté de −2) ; contraste Intense↔Calme +2
    //   loup×marteau, loup×bis, cuivre×marteau, cuivre×bis : rien → 0
    //   marteau×bis : même genre +2, même énergie +1
    // coherence = 2 + 2 + 1 = 5
    // Conditions : ≥1 Techno remplie (+5), ≥1 (Jazz|Ambient) Calme remplie (+5)
    // → objective = 10 ; audacious = 10 ; total = 5 + 10 + 10 = 25.
    const placed = [
      card('loup-statique'),
      card('cuivre-calme'),
      card('marteau-carre'),
      fakeCard('pop-neutre-bis', 'Pop', 'Neutre'),
    ];
    const b = rules.evaluateBoard(placed, recipe('techno-romantique'), cfg);

    expect(b.pairs.filter((p) => p.kind === 'conflict')).toHaveLength(0);
    const requested = b.pairs.filter((p) => p.kind === 'requested_conflict');
    expect(requested).toEqual([
      { a: 'loup-statique', b: 'cuivre-calme', kind: 'requested_conflict', points: 0 },
    ]);
    expect(b.pairs.filter((p) => p.kind === 'contrast')).toEqual([
      { a: 'loup-statique', b: 'cuivre-calme', kind: 'contrast', points: 2 },
    ]);
    expect(b.conditions.map((c) => c.met)).toEqual([true, true]);
    expect(b.coherence).toBe(5);
    expect(b.objective).toBe(10);
    expect(b.audaciousApplied).toBe(true);
    expect(b.audacious).toBe(10);
    expect(b.total).toBe(25);
  });

  it('bonus audacieux accordé UNE fois ; 2e conflit non nécessaire pénalisé', () => {
    // Plateau : loup-statique (Techno Intense), cuivre-calme (Jazz Calme),
    // lame-cercle (Techno Neutre), velours-triangle (Jazz Neutre).
    // Paires :
    //   loup×cuivre    : contraste +2 ; conflit demandé → 0
    //   loup×lame      : même genre +2
    //   loup×velours   : conflit Techno↔Jazz NON demandé (velours Neutre ne
    //                    matche pas la condition [Jazz|Ambient] Calme) → −2
    //   cuivre×lame    : conflit demandé (lame matche [Techno], cuivre matche
    //                    [Jazz|Ambient] Calme) → 0 (2e paire demandée)
    //   cuivre×velours : même genre +2
    //   lame×velours   : même énergie Neutre +1 ; conflit non demandé −2 → −1
    // coherence = 2 + 2 − 2 + 0 + 2 − 1 = 3
    // Conditions remplies : +5 +5 → 10 ; audacieux +10 UNE SEULE fois
    // (malgré 2 paires demandées) ; total = 3 + 10 + 10 = 23.
    const placed = [
      card('loup-statique'),
      card('cuivre-calme'),
      card('lame-cercle'),
      card('velours-triangle'),
    ];
    const b = rules.evaluateBoard(placed, recipe('techno-romantique'), cfg);

    expect(b.pairs.filter((p) => p.kind === 'requested_conflict')).toHaveLength(2);
    // Les deux conflits impliquant velours-triangle restent pénalisés.
    expect(b.pairs.filter((p) => p.kind === 'conflict')).toEqual([
      { a: 'loup-statique', b: 'velours-triangle', kind: 'conflict', points: -2 },
      { a: 'lame-cercle', b: 'velours-triangle', kind: 'conflict', points: -2 },
    ]);
    expect(b.coherence).toBe(3);
    expect(b.objective).toBe(10);
    expect(b.audacious).toBe(10);
    expect(b.total).toBe(23);
  });
});

// ---------------------------------------------------------------------------
// 4. La même paire Techno↔Jazz sur « Ouverture club » → pénalisée
// ---------------------------------------------------------------------------
describe('« Ouverture club » (conflit non demandé)', () => {
  it('pairDetails : loup×cuivre → contraste +2 et conflit −2, pas d’exemption', () => {
    // « Ouverture club » n'a qu'une condition min_count (Techno) : la règle
    // « demandée » exige DEUX conditions min_count différentes → non demandée.
    const details = rules.pairDetails(card('loup-statique'), card('cuivre-calme'), recipe('ouverture-club'), cfg);
    expect(details).toEqual([
      { a: 'loup-statique', b: 'cuivre-calme', kind: 'contrast', points: 2 },
      { a: 'loup-statique', b: 'cuivre-calme', kind: 'conflict', points: -2 },
    ]);
  });

  it('evaluateBoard : pas de bonus audacieux', () => {
    // Plateau partiel [loup, cuivre] : contraste +2, conflit −2 → coherence 0 ;
    // min_count 2 Techno non remplie (1 seul Techno) → objective 0 ; total 0.
    const b = rules.evaluateBoard([card('loup-statique'), card('cuivre-calme')], recipe('ouverture-club'), cfg);
    expect(b.audaciousApplied).toBe(false);
    expect(b.audacious).toBe(0);
    expect(b.coherence).toBe(0);
    expect(b.conditions[0]?.met).toBe(false);
    expect(b.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Bonus de contraste — et sa désactivation (Proposition 1 stricte)
// ---------------------------------------------------------------------------
describe('bonus de contraste', () => {
  it('paire Calme+Intense sans autre interaction → +2', () => {
    // enclume-rouge (Metal Intense) × ruban-doux (Pop Calme) : genres
    // différents et non en conflit (Metal↔Pop absent de la matrice) → seul
    // détail : contraste +2.
    const details = rules.pairDetails(card('enclume-rouge'), card('ruban-doux'), recipe('ouverture-club'), cfg);
    expect(details).toEqual([
      { a: 'enclume-rouge', b: 'ruban-doux', kind: 'contrast', points: 2 },
    ]);
  });

  it('contrast_pair_bonus = 0 → aucun détail contrast (Proposition 1 stricte)', () => {
    const strict: ScoringConfig = structuredClone(cfg);
    strict.coherence.contrast_pair_bonus = 0;
    const details = rules.pairDetails(card('enclume-rouge'), card('ruban-doux'), recipe('ouverture-club'), strict);
    expect(details).toEqual([]);
    // Sur un plateau aussi : plus aucun détail contrast.
    const b = rules.evaluateBoard(
      [card('loup-statique'), card('echo-bleute'), card('lame-cercle'), card('marteau-carre')],
      recipe('set-monochrome'),
      strict,
    );
    expect(b.pairs.filter((p) => p.kind === 'contrast')).toHaveLength(0);
    // coherence du cas 2 sans le contraste loup×echo : 9 − 2 = 7.
    expect(b.coherence).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// 6. « Metal pour bébé » (min_count + none)
// ---------------------------------------------------------------------------
describe('« Metal pour bébé »', () => {
  it('cendre-grise + 3 non-Intenses → les 2 conditions remplies', () => {
    // Plateau : cendre-grise (Metal Neutre), ruban-doux (Pop Calme),
    // marteau-carre (Pop Neutre), echo-bleute (Techno Calme).
    // Paires :
    //   cendre×ruban   : rien → 0        cendre×marteau : même énergie +1
    //   cendre×echo    : rien → 0        ruban×marteau  : même genre +2
    //   ruban×echo     : même énergie +1 marteau×echo   : rien → 0
    // coherence = 4 ; ≥1 Metal remplie (+5), aucune Intense remplie (+5)
    // → objective = 10 ; total = 14.
    const placed = [card('cendre-grise'), card('ruban-doux'), card('marteau-carre'), card('echo-bleute')];
    const b = rules.evaluateBoard(placed, recipe('metal-pour-bebe'), cfg);
    expect(b.conditions.map((c) => c.met)).toEqual([true, true]);
    expect(b.coherence).toBe(4);
    expect(b.objective).toBe(10);
    expect(b.total).toBe(14);
  });

  it('avec une carte Intense → la condition none échoue', () => {
    // Plateau : cendre-grise, ruban-doux, marteau-carre, loup-statique (Intense).
    // Paires : cendre×marteau +1 (Neutre), ruban×marteau +2 (Pop),
    // ruban×loup contraste +2 ; le reste 0 (Metal↔Techno non en conflit).
    // coherence = 5 ; ≥1 Metal remplie (+5), none Intense ÉCHOUE (0)
    // → objective = 5 ; total = 10.
    const placed = [card('cendre-grise'), card('ruban-doux'), card('marteau-carre'), card('loup-statique')];
    const b = rules.evaluateBoard(placed, recipe('metal-pour-bebe'), cfg);
    expect(b.conditions.map((c) => c.met)).toEqual([true, false]);
    expect(b.coherence).toBe(5);
    expect(b.objective).toBe(5);
    expect(b.total).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// 7. « Improvisation totale » (all_different_genres)
// ---------------------------------------------------------------------------
describe('« Improvisation totale »', () => {
  it('4 genres différents → remplie', () => {
    // Plateau : loup-statique (Techno Intense), enclume-rouge (Metal Intense),
    // neon-carre (Pop Intense), velours-triangle (Jazz Neutre).
    // Paires :
    //   loup×enclume : même énergie +1     loup×neon    : même énergie +1
    //   loup×velours : conflit Techno↔Jazz non demandé −2 (pas de min_count)
    //   enclume×neon : même énergie +1
    //   enclume×velours : conflit Metal↔Jazz −2
    //   neon×velours : rien → 0
    // coherence = 1+1+1−2−2 = −1 ; condition remplie +5 → total = 4.
    const placed = [card('loup-statique'), card('enclume-rouge'), card('neon-carre'), card('velours-triangle')];
    const b = rules.evaluateBoard(placed, recipe('improvisation-totale'), cfg);
    expect(b.conditions[0]?.met).toBe(true);
    expect(b.coherence).toBe(-1);
    expect(b.total).toBe(4);
  });

  it('avec un doublon de genre → non remplie', () => {
    // Techno ×2 (loup, echo) + Metal + Pop → 3 genres distincts seulement.
    const placed = [card('loup-statique'), card('echo-bleute'), card('enclume-rouge'), card('neon-carre')];
    const b = rules.evaluateBoard(placed, recipe('improvisation-totale'), cfg);
    expect(b.conditions[0]?.met).toBe(false);
  });

  it('avec seulement 3 cartes posées → non remplie (exige 4 cartes)', () => {
    const placed = [card('loup-statique'), card('enclume-rouge'), card('neon-carre')];
    const b = rules.evaluateBoard(placed, recipe('improvisation-totale'), cfg);
    expect(b.conditions[0]?.met).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. starsFor — bornes exactes des paliers
// ---------------------------------------------------------------------------
describe('starsFor', () => {
  // Paliers (data/scoring.json) : 3★ ≥ 0.8 · 2★ ≥ 0.5 · 1★ ≥ 0.25.
  it('bornes exactes des paliers', () => {
    expect(rules.starsFor(80, 100, cfg)).toBe(3); // ratio 0.8 pile
    expect(rules.starsFor(799, 1000, cfg)).toBe(2); // 0.799 < 0.8
    expect(rules.starsFor(50, 100, cfg)).toBe(2); // 0.5 pile
    expect(rules.starsFor(25, 100, cfg)).toBe(1); // 0.25 pile
    expect(rules.starsFor(249, 1000, cfg)).toBe(0); // 0.249 < 0.25
    expect(rules.starsFor(100, 100, cfg)).toBe(3); // ratio 1
    expect(rules.starsFor(0, 100, cfg)).toBe(0);
  });

  it('total négatif → 0★', () => {
    expect(rules.starsFor(-5, 100, cfg)).toBe(0);
  });

  it('max ≤ 0 : ratio conventionnel (1 si total ≥ 0, 0 sinon)', () => {
    expect(rules.starsFor(10, 0, cfg)).toBe(3);
    expect(rules.starsFor(0, 0, cfg)).toBe(3);
    expect(rules.starsFor(-1, 0, cfg)).toBe(0);
    expect(rules.starsFor(5, -10, cfg)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 9. theoreticalMax — mini-deck vérifié à la main
// ---------------------------------------------------------------------------
describe('theoreticalMax', () => {
  it('deck de 5 cartes, « Ouverture club » : max des C(5,4) = 5 combinaisons', () => {
    // Deck : loup-statique (Techno I), echo-bleute (Techno C), lame-cercle
    // (Techno N), marteau-carre (Pop N), cendre-grise (Metal N).
    // Totaux des 5 combinaisons (min_count 2 Techno = +5 si ≥ 2 Techno) :
    //   {loup,echo,lame,marteau} : paires 4+2+2+0+0+1 = 9  +5 → 14
    //     (loup×echo = même genre +2 + contraste +2)
    //   {loup,echo,lame,cendre}  : 4+2+2+0+0+1 (lame×cendre Neutre) = 9 +5 → 14
    //   {loup,echo,marteau,cendre}: 4+0+0+0+0+1 (marteau×cendre) = 5 +5 → 10
    //   {loup,lame,marteau,cendre}: 2+0+0+1+1+1 = 5 +5 → 10
    //   {echo,lame,marteau,cendre}: 2+0+0+1+1+1 = 5 +5 → 10
    // Max = 14.
    const deck = [
      card('loup-statique'),
      card('echo-bleute'),
      card('lame-cercle'),
      card('marteau-carre'),
      card('cendre-grise'),
    ];
    expect(rules.theoreticalMax(deck, recipe('ouverture-club'), cfg)).toBe(14);
  });

  it('deck de moins de 4 cartes : la combinaison complète unique', () => {
    // [loup, echo, lame] : paires 4 (genre+contraste) + 2 + 2 = 8 ;
    // ≥2 Techno remplie (+5) → 13.
    const deck = [card('loup-statique'), card('echo-bleute'), card('lame-cercle')];
    expect(rules.theoreticalMax(deck, recipe('ouverture-club'), cfg)).toBe(13);
  });

  it('deck complet : énumère toutes les combinaisons C(n,4) sans erreur', () => {
    // Borne de cohérence (pas de valeur pointée à la main sur 495 combos) :
    // le max est au moins celui d'une combinaison connue, ici 14 (cf. ci-dessus).
    const max = rules.theoreticalMax(data.cards, recipe('ouverture-club'), cfg);
    expect(max).toBeGreaterThanOrEqual(14);
    expect(Number.isFinite(max)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. Plateau partiel (2 cartes) — feedback hypothétique pendant la pose
// ---------------------------------------------------------------------------
describe('plateau partiel', () => {
  it('2 cartes : pas de crash, all_same_genre non remplie', () => {
    // [loup, echo] sur « Set monochrome » : 1 paire, même genre +2 +
    // contraste +2 → coherence 4 ; all_same_genre exige 4 cartes → non
    // remplie ; total = 4.
    const b = rules.evaluateBoard([card('loup-statique'), card('echo-bleute')], recipe('set-monochrome'), cfg);
    expect(b.pairs).toHaveLength(2);
    expect(b.conditions[0]?.met).toBe(false);
    expect(b.coherence).toBe(4);
    expect(b.total).toBe(4);
  });

  it('1 carte : aucune paire, conditions évaluées sur les cartes présentes', () => {
    // « Metal pour bébé » avec cendre-grise seule : ≥1 Metal remplie (+5),
    // none Intense remplie (+5) → total 10, coherence 0.
    const b = rules.evaluateBoard([card('cendre-grise')], recipe('metal-pour-bebe'), cfg);
    expect(b.pairs).toEqual([]);
    expect(b.conditions.map((c) => c.met)).toEqual([true, true]);
    expect(b.total).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Cumul de détails sur une même paire
// ---------------------------------------------------------------------------
describe('cumul de détails sur une paire', () => {
  it('même énergie ET conflit de genre sur la même paire', () => {
    // lame-cercle (Techno Neutre) × velours-triangle (Jazz Neutre) sur
    // « Ouverture club » : même énergie +1 ET conflit Techno↔Jazz −2.
    const details = rules.pairDetails(card('lame-cercle'), card('velours-triangle'), recipe('ouverture-club'), cfg);
    expect(details).toEqual([
      { a: 'lame-cercle', b: 'velours-triangle', kind: 'same_energy', points: 1 },
      { a: 'lame-cercle', b: 'velours-triangle', kind: 'conflict', points: -2 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// conditionLabel — libellés français
// ---------------------------------------------------------------------------
describe('conditionLabel', () => {
  it('min_count : pluriel, genre seul', () => {
    expect(rules.conditionLabel({ type: 'min_count', count: 2, filter: { genre: ['Techno'] } })).toBe(
      'Au moins 2 cartes Techno',
    );
  });

  it('min_count : genre + énergie simples', () => {
    expect(
      rules.conditionLabel({ type: 'min_count', count: 2, filter: { genre: ['Pop'], energy: ['Intense'] } }),
    ).toBe('Au moins 2 cartes Pop Intense');
  });

  it('min_count : singulier, OU de genres + énergie', () => {
    expect(
      rules.conditionLabel({
        type: 'min_count',
        count: 1,
        filter: { genre: ['Jazz', 'Ambient'], energy: ['Calme'] },
      }),
    ).toBe('Au moins 1 carte Jazz ou Ambient, Calme');
  });

  it('min_count : singulier, genre seul', () => {
    expect(rules.conditionLabel({ type: 'min_count', count: 1, filter: { genre: ['Metal'] } })).toBe(
      'Au moins 1 carte Metal',
    );
  });

  it('none : énergie seule', () => {
    expect(rules.conditionLabel({ type: 'none', filter: { energy: ['Intense'] } })).toBe('Aucune carte Intense');
  });

  it('all_same_genre / all_different_genres', () => {
    expect(rules.conditionLabel({ type: 'all_same_genre' })).toBe('Les 4 cartes du même Genre');
    expect(rules.conditionLabel({ type: 'all_different_genres' })).toBe('Les 4 cartes de 4 Genres différents');
  });

  it('les ConditionDetail du breakdown portent le libellé', () => {
    const b = rules.evaluateBoard([card('loup-statique')], recipe('ouverture-club'), cfg);
    expect(b.conditions[0]?.label).toBe('Au moins 2 cartes Techno');
    expect(b.conditions[0]?.index).toBe(0);
  });
});
