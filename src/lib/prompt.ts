import { createStore } from './store-util';

/**
 * Promise-based UI prompt. Library code awaits `askTrackInfo()`; the NameSheet component
 * renders whatever is pending and resolves it. Keeps the import loop linear and readable.
 */
export interface TrackInfoRequest {
  heading: string;
  defaults: { title: string; artist: string; album: string };
  resolve: (v: { title: string; artist: string; album: string } | null) => void;
}

export const promptStore = createStore<{ pending: TrackInfoRequest | null }>({ pending: null });

export function askTrackInfo(heading: string, defaults: TrackInfoRequest['defaults']) {
  return new Promise<{ title: string; artist: string; album: string } | null>((resolve) => {
    promptStore.set({
      pending: {
        heading,
        defaults,
        resolve: (v) => { promptStore.set({ pending: null }); resolve(v); },
      },
    });
  });
}
