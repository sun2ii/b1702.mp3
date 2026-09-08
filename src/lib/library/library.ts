import { createStore } from '../store-util';
import { localSource } from './local-source';
import { loadLibrary, resolveLibraryUri, saveLibrary } from './library-store';
import type { Track } from './types';
import { initPlayer, removeFromQueue } from '../player/player';

export interface LibraryState {
  tracks: Track[];
  ready: boolean;
  importing: boolean;
  lastError: string | null;
}

export const libraryStore = createStore<LibraryState>({
  tracks: [],
  ready: false,
  importing: false,
  lastError: null,
});

/** App boot: read the index, resolve the artwork base URL, then let the player restore itself. */
export async function bootLibrary() {
  await resolveLibraryUri();
  const tracks = await loadLibrary();
  libraryStore.set({ tracks, ready: true });
  await initPlayer(tracks);
}

export async function importFromFiles() {
  libraryStore.set({ importing: true, lastError: null });
  try {
    const { tracks: imported, errors } = await localSource.importFromFiles();
    if (imported.length) {
      const tracks = [...libraryStore.get().tracks, ...imported];
      libraryStore.set({ tracks });
      await saveLibrary(tracks);
    }
    if (errors.length) libraryStore.set({ lastError: errors.join('\n') });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    // The picker rejects with "pickFiles canceled." when the user dismisses it: not an error.
    if (!/cancel/i.test(msg)) libraryStore.set({ lastError: msg });
  } finally {
    libraryStore.set({ importing: false });
  }
}

export async function removeTracks(ids: string[]) {
  const set = new Set(ids);
  const tracks = libraryStore.get().tracks.filter((t) => !set.has(t.id));
  libraryStore.set({ tracks });
  removeFromQueue(set);
  await saveLibrary(tracks);
  // Note: audio files are left on disk in V1. A "reclaim space" step belongs with download management.
}
