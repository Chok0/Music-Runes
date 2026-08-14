/**
 * Rendu SVG d'une carte — la triple lecture du GDD §3bis :
 * FORME = Genre, COULEUR = Énergie (via data-energy en CSS), GLYPHE = identité.
 * Le texte (nom, genre/énergie) confirme ce que la forme/couleur enseigne.
 */
import type { Card, Genre } from '../types';
import { el } from './dom';
import { monogram } from './format';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function polygon(points: string): SVGPolygonElement {
  const p = svgEl('polygon');
  p.setAttribute('points', points);
  return p;
}

/** Forme par Genre (modele-de-donnees §1) + ancrage vertical du monogramme. */
const SHAPES: Record<Genre, { build: () => SVGElement; glyphY: number }> = {
  Techno: {
    build: () => {
      const c = svgEl('circle');
      c.setAttribute('cx', '50');
      c.setAttribute('cy', '50');
      c.setAttribute('r', '40');
      return c;
    },
    glyphY: 50,
  },
  Metal: { build: () => polygon('50,6 94,50 50,94 6,50'), glyphY: 50 },
  Pop: {
    build: () => {
      const r = svgEl('rect');
      r.setAttribute('x', '13');
      r.setAttribute('y', '13');
      r.setAttribute('width', '74');
      r.setAttribute('height', '74');
      r.setAttribute('rx', '8');
      return r;
    },
    glyphY: 50,
  },
  // Triangle : centre optique plus bas que le centre géométrique.
  Jazz: { build: () => polygon('50,9 93,87 7,87'), glyphY: 63 },
  Ambient: { build: () => polygon('50,5 89,27.5 89,72.5 50,95 11,72.5 11,27.5'), glyphY: 50 },
};

/**
 * Mini-pictogramme d'un Genre (sa forme) pour les consignes (GDD §5 : la
 * consigne doit se lire dans le même vocabulaire visuel que les cartes).
 * `energy` colore la forme ; absente = forme « n'importe quelle énergie »
 * (contour seul, pour ne pas se confondre avec le gris de Neutre).
 */
export function genreShapePicto(genre: Genre, energy?: string): SVGSVGElement {
  const svg = svgEl('svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('picto');
  const shape = SHAPES[genre].build();
  shape.classList.add('picto__shape');
  if (energy) svg.dataset['energy'] = energy;
  svg.appendChild(shape);
  return svg;
}

export interface CardViewOptions {
  /** Description du stem pour le slot où la carte est posée (info audio/UI). */
  stemDescription?: string;
}

export function createCardElement(card: Card, opts: CardViewOptions = {}): HTMLElement {
  const rootEl = el('div', 'card');
  rootEl.dataset['cardId'] = card.id;
  rootEl.dataset['genre'] = card.genre;
  rootEl.dataset['energy'] = card.energy;
  rootEl.tabIndex = 0;
  rootEl.setAttribute('role', 'button');
  rootEl.setAttribute('aria-label', `${card.name} — ${card.genre}, ${card.energy}`);

  const svg = svgEl('svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('card__svg');

  const spec = SHAPES[card.genre];
  const shape = spec.build();
  shape.classList.add('card__shape');
  svg.appendChild(shape);

  const glyph = svgEl('text');
  glyph.setAttribute('x', '50');
  glyph.setAttribute('y', String(spec.glyphY));
  glyph.setAttribute('text-anchor', 'middle');
  glyph.setAttribute('dominant-baseline', 'central');
  glyph.classList.add('card__glyph');
  glyph.textContent = monogram(card.name);
  svg.appendChild(glyph);

  rootEl.appendChild(svg);
  // Valeur commerciale (1-3) : points de set au drop — pas d'effet étoiles.
  const value = el('div', 'card__value', String(card.value));
  value.title = `Valeur : ${card.value} pt${card.value > 1 ? 's' : ''} au drop`;
  rootEl.appendChild(value);
  rootEl.appendChild(el('div', 'card__name', card.name));
  rootEl.appendChild(el('div', 'card__tags', `${card.genre} · ${card.energy}`));
  if (opts.stemDescription) {
    rootEl.appendChild(el('div', 'card__stem', opts.stemDescription));
  }
  return rootEl;
}
