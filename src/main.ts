/**
 * Point d'entrée : monte l'app et affiche lisiblement toute erreur de
 * chargement de données (DataError du module src/data) au lieu d'une page
 * blanche — roadmap M0 : erreurs explicites si les données sont invalides.
 */
import './styles.css';
import { mountApp } from './ui/app';

function renderFatalError(root: HTMLElement, err: unknown): void {
  const isError = err instanceof Error;
  const box = document.createElement('div');
  box.className = 'fatal-error';

  const title = document.createElement('h1');
  title.className = 'fatal-error__title';
  title.textContent = 'Impossible de démarrer le jeu';

  const kind = document.createElement('p');
  kind.className = 'fatal-error__kind';
  kind.textContent =
    isError && err.name === 'DataError' ? 'Erreur de chargement des données' : 'Erreur inattendue';

  const message = document.createElement('pre');
  message.className = 'fatal-error__message';
  message.textContent = isError ? err.message : String(err);

  const hint = document.createElement('p');
  hint.className = 'fatal-error__hint';
  hint.textContent =
    'Vérifie les fichiers data/cards.json, data/recipes.json et data/scoring.json, puis recharge la page.';

  box.append(title, kind, message, hint);
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
