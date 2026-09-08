import { Preferences } from '@capacitor/preferences';
import { createStore } from './store-util';

/**
 * A skin is nothing but values for the CSS variables in globals.css (the "skin contract").
 * Playback, library and Drive code never see this file. Adding a skin = adding an object here.
 */
export interface Skin {
  id: string;
  name: string;
  vars: Record<string, string>;
}

export const SKINS: Skin[] = [
  {
    id: 'llama',
    name: 'Llama',
    vars: {
      '--bg': '#0d0f12', '--panel': '#161a1f', '--panel-2': '#1f252c', '--line': '#2a323b',
      '--text': '#e6e9ee', '--text-dim': '#8b95a3',
      '--accent': '#9dff5c', '--accent-dim': '#4f8a2e', '--lcd-bg': '#0a1a0d', '--lcd-text': '#b9ff7a',
    },
  },
  {
    id: 'amber',
    name: 'Amber',
    vars: {
      '--bg': '#100c08', '--panel': '#1b1510', '--panel-2': '#261d15', '--line': '#3a2c1f',
      '--text': '#f1e6d6', '--text-dim': '#a08a72',
      '--accent': '#ffb347', '--accent-dim': '#8a5a1e', '--lcd-bg': '#1a1006', '--lcd-text': '#ffc46b',
    },
  },
  {
    id: 'ice',
    name: 'Ice',
    vars: {
      '--bg': '#eef2f7', '--panel': '#ffffff', '--panel-2': '#f5f8fc', '--line': '#d6dde8',
      '--text': '#101720', '--text-dim': '#5f6f85',
      '--accent': '#1f7cff', '--accent-dim': '#8fb8ff', '--lcd-bg': '#e3edff', '--lcd-text': '#1553b3',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    vars: {
      '--bg': '#0a0714', '--panel': '#140f24', '--panel-2': '#1d1633', '--line': '#2c2349',
      '--text': '#ece7ff', '--text-dim': '#9a8fc4',
      '--accent': '#c084fc', '--accent-dim': '#6d3fa8', '--lcd-bg': '#160d2b', '--lcd-text': '#d8b4fe',
    },
  },
  {
    id: 'terminal',
    name: 'Terminal',
    vars: {
      '--bg': '#000000', '--panel': '#0a0a0a', '--panel-2': '#141414', '--line': '#262626',
      '--text': '#d4d4d4', '--text-dim': '#7a7a7a',
      '--accent': '#ffffff', '--accent-dim': '#5a5a5a', '--lcd-bg': '#0a0a0a', '--lcd-text': '#e5e5e5',
    },
  },
];

const KEY = 'skin';
export const skinStore = createStore<{ id: string }>({ id: SKINS[0].id });

function apply(skin: Skin) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(skin.vars)) root.style.setProperty(k, v);
  root.dataset.skin = skin.id;
  // Status bar / scroll-bounce background follows the skin.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', skin.vars['--bg']);
}

export async function loadSkin() {
  const saved = (await Preferences.get({ key: KEY })).value;
  const skin = SKINS.find((s) => s.id === saved) ?? SKINS[0];
  apply(skin);
  skinStore.set({ id: skin.id });
}

export async function setSkin(id: string) {
  const skin = SKINS.find((s) => s.id === id);
  if (!skin) return;
  apply(skin);
  skinStore.set({ id });
  await Preferences.set({ key: KEY, value: id });
}
