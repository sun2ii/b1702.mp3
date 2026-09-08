import { createStore } from './store-util';

/**
 * Promise-based UI prompts. Library code awaits `askTrackInfo()` / `askDelete()`; the sheet
 * components render whatever is pending and resolve it. Keeps import/edit loops linear.
 */
export interface TrackInfo { title: string; artist: string; album: string }

export interface InfoRequest {
  kind: 'info';
  heading: string;
  defaults: TrackInfo;
  /** Which fields the sheet shows (album edit hides title/artist). */
  fields: Array<keyof TrackInfo>;
  /** Show the "Change cover" button. */
  allowCover: boolean;
  /** Show a Delete button (resolves with { action: 'delete' }). */
  allowDelete: boolean;
  resolve: (v: InfoResult) => void;
}
export type InfoResult =
  | { action: 'save'; info: TrackInfo; coverPath?: string }
  | { action: 'delete' }
  | { action: 'cancel' };

export interface DeleteRequest {
  kind: 'delete';
  heading: string;
  /** Offer "Delete everywhere" (Drive-linked tracks). */
  hasRemote: boolean;
  resolve: (v: 'phone' | 'everywhere' | 'cancel') => void;
}

export const promptStore = createStore<{ pending: InfoRequest | DeleteRequest | null }>({ pending: null });

export function askTrackInfo(
  heading: string,
  defaults: TrackInfo,
  opts: Partial<Pick<InfoRequest, 'fields' | 'allowCover' | 'allowDelete'>> = {},
) {
  return new Promise<InfoResult>((resolve) => {
    promptStore.set({
      pending: {
        kind: 'info', heading, defaults,
        fields: opts.fields ?? ['title', 'artist', 'album'],
        allowCover: opts.allowCover ?? false,
        allowDelete: opts.allowDelete ?? false,
        resolve: (v) => { promptStore.set({ pending: null }); resolve(v); },
      },
    });
  });
}

export function askDelete(heading: string, hasRemote: boolean) {
  return new Promise<'phone' | 'everywhere' | 'cancel'>((resolve) => {
    promptStore.set({
      pending: { kind: 'delete', heading, hasRemote, resolve: (v) => { promptStore.set({ pending: null }); resolve(v); } },
    });
  });
}
