/**
 * Tests du moteur de règles/scoring v2 — « Le Verdict du Public ».
 *
 * Les valeurs attendues sont calculées À LA MAIN à partir des vraies données
 * (data/*.json) ; le détail des calculs est en commentaire au-dessus de
 * chaque assertion.
 *
 * Rappel des tags des cartes utilisées (data/cards.json) :
 *   loup-statique      Techno  Intense     turbine-noire  Techno  Intense
 *   echo-bleute        Techno  Calme       sirene-carree  Pop     Intense
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
 * Barème (data/scoring.json v2) : Paire 10, Double paire 18, Brelan 25,
 * Carré 40 ; Camaïeu(4) +20, Camaïeu(3) +8, Gradient complet +12 ;
 * verdict ×0.5 (aucune condition) / ×1 (partielle) / ×2 (toutes), floor.
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

function cards(...ids: string[]): Card[] {
  return ids.map(card);
}

function recipe(id: string): Recipe {
  const r = data.recipeById.get(id);
  if (!r) throw new Error(`recette absente des données de test : ${id}`);
  return r;
}

/** Carte synthétique pour isoler une combinaison précise. */
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

describe('matchesFilter', () => {
  const c = card('cuivre-calme'); // Jazz Calme

  it('accepte une carte qui matche chaque champ (OU dans le champ genre)', () => {
    expect(rules.matchesFilter(c, { genre: ['Jazz', 'Ambient'] })).toBe(true);
    expect(rules.matchesFilter(c, { genre: ['Jazz'], energy: ['Calme'] })).toBe(true);
  });

  it('rejette si UN champ échoue (ET entre champs)', () => {
    expect(rules.matchesFilter(c, { genre: ['Jazz'], energy: ['Intense'] })).toBe(false);
    expect(rules.matchesFilter(c, { genre: ['Pop'] })).toBe(false);
  });

  it('un champ absent ne contraint pas ; filtre vide = tout matche', () => {
    expect(rules.matchesFilter(c, { energy: ['Calme'] })).toBe(true);
    expect(rules.matchesFilter(c, {})).toBe(true);
  });
});

describe('mains de formes (Genres)', () => {
  // Recette « Balances » (≥1 Techno) : simple à contrôler dans les calculs.
  const balances = recipe('balances');

  it('Carré : 4 Techno → 40, gradient (I,C,N,I = 3 énergies) +12, envie ×2 → 104', () => {
    const b = rules.evaluateBoard(
      cards('loup-statique', 'echo-bleute', 'lame-cercle', 'turbine-noire'),
      balances,
      cfg,
    );
    expect(b.handKind).toBe('four_of_a_kind');
    expect(b.handLabel).toBe('Carré Techno');
    expect(b.handPoints).toBe(40);
    expect(b.colors.map((c) => c.kind)).toEqual(['gradient_complet']);
    expect(b.base).toBe(52);
    expect(b.multiplier).toBe(2);
    expect(b.total).toBe(104);
  });

  it('Brelan : 3 Techno + Ambient → 25, gradient +12, ×2 → 74', () => {
    const b = rules.evaluateBoard(
      cards('loup-statique', 'echo-bleute', 'lame-cercle', 'brume-hexagone'),
      balances,
      cfg,
    );
    expect(b.handKind).toBe('three_of_a_kind');
    expect(b.handLabel).toBe('Brelan Techno');
    expect(b.total).toBe(74);
  });

  it('Double paire : 2 Techno + 2 Metal → 18, gradient (I,C,I,N) +12, ×2 → 60', () => {
    const b = rules.evaluateBoard(
      cards('loup-statique', 'echo-bleute', 'enclume-rouge', 'cendre-grise'),
      balances,
      cfg,
    );
    expect(b.handKind).toBe('two_pair');
    expect(b.handLabel).toBe('Double paire');
    expect(b.total).toBe(60);
  });

  it('Paire : 2 Techno + Jazz + Pop → 10, gradient (I,C,N,N) +12, ×2 → 44', () => {
    const b = rules.evaluateBoard(
      cards('loup-statique', 'echo-bleute', 'velours-triangle', 'marteau-carre'),
      balances,
      cfg,
    );
    expect(b.handKind).toBe('pair');
    expect(b.handLabel).toBe('Paire Techno');
    expect(b.total).toBe(44);
  });

  it('Aucune main : 4 genres différents, envie ignorée → floor(12 × 0.5) = 6', () => {
    // loup(T,I), enclume(M,I), marteau(P,N), cuivre(J,C) — recette « Ouverture
    // club » (≥2 Techno) : 1 seul Techno → aucune condition remplie.
    const b = rules.evaluateBoard(
      cards('loup-statique', 'enclume-rouge', 'marteau-carre', 'cuivre-calme'),
      recipe('ouverture-club'),
      cfg,
    );
    expect(b.handKind).toBe('none');
    expect(b.handPoints).toBe(0);
    expect(b.colors.map((c) => c.kind)).toEqual(['gradient_complet']);
    expect(b.multiplier).toBe(0.5);
    expect(b.total).toBe(6);
  });
});

describe('couleurs (Énergies)', () => {
  it('Camaïeu 4 : tout Calme → +20, pas de gradient — « Session lounge » ×2 → 40', () => {
    // echo(T,C), ruban(P,C), cuivre(J,C), brume(A,C) : 4 genres ≠ → aucune main.
    // Session lounge : ≥2 Jazz|Ambient ✓ (cuivre, brume) ; aucune Intense ✓ → ×2.
    const b = rules.evaluateBoard(
      cards('echo-bleute', 'ruban-doux', 'cuivre-calme', 'brume-hexagone'),
      recipe('session-lounge'),
      cfg,
    );
    expect(b.handKind).toBe('none');
    expect(b.colors.map((c) => c.kind)).toEqual(['camaieu_4']);
    expect(b.colorPoints).toBe(20);
    expect(b.total).toBe(40);
  });

  it('Camaïeu 3 : 3 Neutres + 1 Intense → +8, paire Techno 10, ×2 → 36', () => {
    // lame(T,N), velours(J,N), marteau(P,N), loup(T,I) — « Balances » ✓ ×2.
    const b = rules.evaluateBoard(
      cards('lame-cercle', 'velours-triangle', 'marteau-carre', 'loup-statique'),
      recipe('balances'),
      cfg,
    );
    expect(b.handKind).toBe('pair');
    expect(b.colors.map((c) => c.kind)).toEqual(['camaieu_3']);
    expect(b.base).toBe(18);
    expect(b.total).toBe(36);
  });

  it('camaïeu et gradient sont exclusifs à 4 cartes (3 identiques + 1 = pas les 3 énergies… sauf si)', () => {
    // I,I,C,N : counts [2,1,1] → pas de camaïeu ; 3 énergies distinctes → gradient.
    const b = rules.evaluateBoard(
      cards('loup-statique', 'enclume-rouge', 'echo-bleute', 'lame-cercle'),
      recipe('balances'),
      cfg,
    );
    expect(b.colors.map((c) => c.kind)).toEqual(['gradient_complet']);
  });
});

describe('le verdict (multiplicateur de l’envie)', () => {
  it('partiellement servie : ×1, et l’aversion violée est comptée', () => {
    // « Metal pour bébé » : ≥1 Metal ✓ (cendre) ; aucune Intense ✗ (loup).
    // Formes M,T,T,T → Brelan Techno 25 ; énergies N,I,C,N → gradient +12.
    const b = rules.evaluateBoard(
      cards('cendre-grise', 'loup-statique', 'echo-bleute', 'lame-cercle'),
      recipe('metal-pour-bebe'),
      cfg,
    );
    expect(b.conditionsMet).toBe(1);
    expect(b.multiplier).toBe(1);
    expect(b.aversionsViolated).toBe(1);
    expect(b.total).toBe(37);
  });

  it('entièrement servie : ×2, aucune aversion violée', () => {
    // cendre(M,N), echo(T,C), lame(T,N), ruban(P,C) : Metal ✓, aucune Intense ✓.
    // Paire Techno 10 ; énergies N,C,N,C → pas de camaïeu(3+), 2 distinctes → rien.
    const b = rules.evaluateBoard(
      cards('cendre-grise', 'echo-bleute', 'lame-cercle', 'ruban-doux'),
      recipe('metal-pour-bebe'),
      cfg,
    );
    expect(b.multiplier).toBe(2);
    expect(b.aversionsViolated).toBe(0);
    expect(b.total).toBe(20);
  });

  it('ignorée : ×0.5 avec floor — paire Metal 10 → 5', () => {
    // « Balances » (≥1 Techno) sans Techno : enclume + cendre (2 cartes).
    const b = rules.evaluateBoard(cards('enclume-rouge', 'cendre-grise'), recipe('balances'), cfg);
    expect(b.handKind).toBe('pair');
    expect(b.multiplier).toBe(0.5);
    expect(b.total).toBe(5);
  });
});

describe('plateau partiel (tutoriel)', () => {
  it('2 cartes : une paire est détectable, ×2 → 20', () => {
    const b = rules.evaluateBoard(cards('loup-statique', 'echo-bleute'), recipe('balances'), cfg);
    expect(b.handKind).toBe('pair');
    expect(b.total).toBe(20); // 10 × 2, pas de couleur (2 énergies distinctes)
  });

  it('3 cartes : brelan + gradient → (25+12) × 2 = 74', () => {
    const b = rules.evaluateBoard(
      cards('loup-statique', 'echo-bleute', 'lame-cercle'),
      recipe('balances'),
      cfg,
    );
    expect(b.handKind).toBe('three_of_a_kind');
    expect(b.colors.map((c) => c.kind)).toEqual(['gradient_complet']);
    expect(b.total).toBe(74);
  });

  it('1 carte : aucune main, conditions évaluées sur les cartes présentes', () => {
    const b = rules.evaluateBoard(cards('loup-statique'), recipe('balances'), cfg);
    expect(b.handKind).toBe('none');
    expect(b.conditionsMet).toBe(1); // ≥1 Techno ✓
    expect(b.total).toBe(0);
  });
});

describe('all_same_genre / all_different_genres (inchangées)', () => {
  it('« Set monochrome » : 4 Techno → remplie ; 3 cartes → non (exige 4)', () => {
    const four = rules.evaluateBoard(
      cards('loup-statique', 'echo-bleute', 'lame-cercle', 'turbine-noire'),
      recipe('set-monochrome'),
      cfg,
    );
    expect(four.conditionsMet).toBe(1);
    const three = rules.evaluateBoard(
      cards('loup-statique', 'echo-bleute', 'lame-cercle'),
      recipe('set-monochrome'),
      cfg,
    );
    expect(three.conditionsMet).toBe(0);
  });

  it('« Improvisation totale » : 4 genres différents → remplie, doublon → non', () => {
    const ok = rules.evaluateBoard(
      cards('loup-statique', 'enclume-rouge', 'marteau-carre', 'cuivre-calme'),
      recipe('improvisation-totale'),
      cfg,
    );
    expect(ok.conditionsMet).toBe(1);
    const dup = rules.evaluateBoard(
      cards('loup-statique', 'echo-bleute', 'marteau-carre', 'cuivre-calme'),
      recipe('improvisation-totale'),
      cfg,
    );
    expect(dup.conditionsMet).toBe(0);
  });
});

describe('cardAffinity (liens du plateau)', () => {
  it('même forme, même couleur, les deux, aucune', () => {
    expect(rules.cardAffinity(card('loup-statique'), card('echo-bleute'))).toEqual({
      sameGenre: true,
      sameEnergy: false,
    });
    expect(rules.cardAffinity(card('loup-statique'), card('enclume-rouge'))).toEqual({
      sameGenre: false,
      sameEnergy: true,
    });
    expect(rules.cardAffinity(card('loup-statique'), card('turbine-noire'))).toEqual({
      sameGenre: true,
      sameEnergy: true,
    });
    expect(rules.cardAffinity(card('loup-statique'), card('cuivre-calme'))).toEqual({
      sameGenre: false,
      sameEnergy: false,
    });
  });
});

describe('starsFor', () => {
  const mk = (ratios: [number, number][]): ScoringConfig => ({
    ...cfg,
    star_thresholds: ratios.map(([stars, r]) => ({ stars, min_ratio_of_theoretical_max: r })),
  });

  it('bornes exactes des paliers', () => {
    const c = mk([
      [3, 0.8],
      [2, 0.5],
      [1, 0.25],
    ]);
    expect(rules.starsFor(80, 100, c)).toBe(3);
    expect(rules.starsFor(79, 100, c)).toBe(2);
    expect(rules.starsFor(50, 100, c)).toBe(2);
    expect(rules.starsFor(25, 100, c)).toBe(1);
    expect(rules.starsFor(24, 100, c)).toBe(0);
  });

  it('total négatif → 0★ ; max ≤ 0 : ratio conventionnel', () => {
    expect(rules.starsFor(-5, 100, cfg)).toBe(0);
    expect(rules.starsFor(0, 0, cfg)).toBe(3);
    expect(rules.starsFor(-1, 0, cfg)).toBe(0);
  });
});

describe('theoreticalMax', () => {
  it('deck de 5, « Ouverture club » : le meilleur C(5,4) = brelan + gradient ×2 = 74', () => {
    // loup, echo, lame (3 Techno) + cuivre/marteau : brelan 25 + gradient 12,
    // ≥2 Techno remplie → ×2 = 74 pour les deux compléments — c'est le max.
    const deck = cards('loup-statique', 'echo-bleute', 'lame-cercle', 'cuivre-calme', 'marteau-carre');
    expect(rules.theoreticalMax(deck, recipe('ouverture-club'), cfg)).toBe(74);
  });

  it('deck de moins de 4 cartes : la combinaison complète unique', () => {
    const deck = cards('loup-statique', 'echo-bleute', 'lame-cercle');
    expect(rules.theoreticalMax(deck, recipe('ouverture-club'), cfg)).toBe(74); // brelan+gradient ×2
  });

  it('boardSize partiel : max des paires sur 2 slots', () => {
    // Sur 2 cartes, le mieux avec ce deck : paire Techno ×2 = 20.
    const deck = cards('loup-statique', 'echo-bleute', 'cuivre-calme');
    expect(rules.theoreticalMax(deck, recipe('balances'), cfg, 2)).toBe(20);
  });

  it('deck complet : énumère toutes les combinaisons C(n,4) sans erreur', () => {
    const max = rules.theoreticalMax(data.cards, recipe('ouverture-club'), cfg);
    // Le carré Techno + gradient ×2 = 104 existe dans le pool complet.
    expect(max).toBeGreaterThanOrEqual(104);
    expect(Number.isFinite(max)).toBe(true);
  });
});

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

  it('none : énergie seule', () => {
    expect(rules.conditionLabel({ type: 'none', filter: { energy: ['Intense'] } })).toBe(
      'Aucune carte Intense',
    );
  });

  it('all_same_genre / all_different_genres', () => {
    expect(rules.conditionLabel({ type: 'all_same_genre' })).toBe('Les 4 cartes du même Genre');
    expect(rules.conditionLabel({ type: 'all_different_genres' })).toBe(
      'Les 4 cartes de 4 Genres différents',
    );
  });

  it('les ConditionDetail du breakdown portent le libellé', () => {
    const b = rules.evaluateBoard(cards('loup-statique'), recipe('balances'), cfg);
    expect(b.conditions[0]?.label).toBe('Au moins 1 carte Techno');
  });

  it('fakeCard : les mains se détectent aussi sur des cartes synthétiques', () => {
    const b = rules.evaluateBoard(
      [fakeCard('a', 'Jazz', 'Calme'), fakeCard('b', 'Jazz', 'Calme')],
      recipe('session-lounge'),
      cfg,
    );
    expect(b.handKind).toBe('pair');
    expect(b.handLabel).toBe('Paire Jazz');
  });
});
