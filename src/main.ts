/**
 * Point d'entrée : monte l'app et affiche lisiblement toute erreur de
 * chargement de données (DataError du module src/data) au lieu d'une page
 * blanche — roadmap M0 : erreurs explicites si les données sont invalides.
 */
import './styles.css';
import { mountApp } from './ui/app';
import { el } from './ui/dom';

function renderFatalError(root: HTMLElement, err: unknown): void {
  const isError = err instanceof Error;
  const box = el('div', 'fatal-error');
  box.append(
    el('h1', 'fatal-error__title', 'Impossible de démarrer le jeu'),
    el(
      'p',
      'fatal-error__kind',
      isError && err.name === 'DataError' ? 'Erreur de chargement des données' : 'Erreur inattendue',
    ),
    el('pre', 'fatal-error__message', isError ? err.message : String(err)),
    el(
      'p',
      'fatal-error__hint',
      'Vérifie les fichiers data/cards.json, data/recipes.json et data/scoring.json, puis recharge la page.',
    ),
  );
  root.replaceChildren(box);
}

const root = document.getElementById('app');
if (!root) {
  throw new Error('Élément #app introuvable dans index.html.');
}
try {
  mountApp(root);
} catch (err) {
  console.error(err);
  renderFatalError(root, err);
}
