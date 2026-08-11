import './style.css';
import { Game } from './src/core/Game.ts';

const app = document.getElementById('app');
const ui = document.getElementById('ui-layer');

if (!app || !ui) {
  throw new Error('Missing #app or #ui-layer in the document.');
}

new Game(app, ui);
