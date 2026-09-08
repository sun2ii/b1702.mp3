import { FilePicker } from '@capawesome/capacitor-file-picker';
import { AudioEngine } from '../native/audio-engine';
import { createStore } from '../store-util';
import { localSource } from './local-source';
import { loadLibrary, resolveLibraryUri, saveLibrary } from './library-store';
import type { Track } from './types';
import { initPlayer, removeFromQueue } from '../player/player';
import { driveSource } from '../drive/drive-source';
import { driveConfigured } from '../drive/config';

export interface LibraryState {
  tracks: Track[];
  ready: boolean;
  importing: boolean;
  lastError: string | null;
  driveSignedIn: boolean;
  driveSyncing: boolean;
}

export const libraryStore = createStore<LibraryState>({
  tracks: [],
  ready: false,
  importing: false,
  lastError: null,
  driveSignedIn: false,
  driveSyncing: false,
});

/** App boot: read the index, resolve the artwork base URL, then let the player restore itself. */
export async function bootLibrary() {
  await resolveLibraryUri();
  const tracks = await loadLibrary();
  libraryStore.set({ tracks, ready: true });

  // When a Drive track finishes downloading, replace its stub with the tagged, cached version.
  driveSource.onCached = async (updated) => {
    const next = libraryStore.get().tracks.map((t) => (t.id === updated.id ? updated : t));
    libraryStore.set({ tracks: next });
    await saveLibrary(next);
  };
  if (driveConfigured()) {
    try { libraryStore.set({ driveSignedIn: await driveSource.isSignedIn() }); } catch { /* plugin missing */ }
  }

  await initPlayer(tracks);
}

/** Sign in (if needed) and merge the Drive folder into the library. Never removes cached files. */
export async function syncDrive() {
  if (!driveConfigured()) {
    libraryStore.set({ lastError: 'Google Drive is not configured: paste your client ID in src/lib/drive/config.ts' });
    return;
  }
  libraryStore.set({ driveSyncing: true, lastError: null });
  try {
    if (!(await driveSource.isSignedIn())) await driveSource.signIn();
    libraryStore.set({ driveSignedIn: true });

    await retryPendingUploads();
    const stubs = await driveSource.sync();
    const existing = libraryStore.get().tracks;
    const byId = new Map(existing.map((t) => [t.id, t]));
    const remoteIds = new Set(stubs.map((s) => s.id));

    const merged = [
      // keep local tracks and Drive tracks that still exist remotely
      ...existing.filter((t) => t.sourceId !== 'gdrive' || remoteIds.has(t.id)),
      // add stubs for new Drive files
      ...stubs.filter((s) => !byId.has(s.id)),
    ];
    libraryStore.set({ tracks: merged });
    await saveLibrary(merged);
  } catch (e) {
    libraryStore.set({ lastError: (e as Error).message ?? String(e) });
  } finally {
    libraryStore.set({ driveSyncing: false });
  }
}

export async function signOutDrive() {
  await driveSource.signOut();
  libraryStore.set({ driveSignedIn: false });
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

/**
 * Photos → video → M4A → library → Drive.
 * The track is playable the moment the export finishes; the upload happens right after and,
 * if it fails (no network), the track stays local with pendingUpload and Sync retries it.
 */
export async function importFromPhotos() {
  libraryStore.set({ importing: true, lastError: null });
  try {
    const picked = await FilePicker.pickVideos({ limit: 0, skipTranscoding: true });
    const errors: string[] = [];
    for (const f of picked.files) {
      if (!f.path) { errors.push(`${f.name}: no path returned by picker`); continue; }
      try {
        const title = recordingTitle(f.modifiedAt);
        const { path } = await AudioEngine.exportAudio({ path: f.path, title });
        const imported = await AudioEngine.importFile({ path });
        let track: Track = { ...imported, sourceId: 'local', album: 'Phone Recordings', pendingUpload: true };
        await upsert(track);

        if (driveConfigured()) {
          try {
            if (!(await driveSource.isSignedIn())) await driveSource.signIn();
            const uploaded = await driveSource.upload(track);
            await replace(track.id, uploaded);
            track = uploaded;
          } catch (e) {
            errors.push(`${title}: saved on phone, Drive upload failed (${(e as Error).message})`);
          }
        }
      } catch (e) {
        errors.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    if (errors.length) libraryStore.set({ lastError: errors.join('\n') });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (!/cancel/i.test(msg)) libraryStore.set({ lastError: msg });
  } finally {
    libraryStore.set({ importing: false });
  }
}

/** Retry uploads that failed earlier. Called from syncDrive. */
async function retryPendingUploads() {
  for (const t of libraryStore.get().tracks.filter((t) => t.pendingUpload && t.fileName)) {
    try { await replace(t.id, await driveSource.upload(t)); } catch { /* still pending; next sync */ }
  }
}

function recordingTitle(modifiedAt?: number) {
  const d = modifiedAt ? new Date(modifiedAt) : new Date();
  const p = (n: number) => n.toString().padStart(2, '0');
  return `Recording ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
}

async function upsert(track: Track) {
  const tracks = [...libraryStore.get().tracks.filter((t) => t.id !== track.id), track];
  libraryStore.set({ tracks });
  await saveLibrary(tracks);
}

async function replace(oldId: string, track: Track) {
  const tracks = libraryStore.get().tracks.map((t) => (t.id === oldId ? track : t));
  libraryStore.set({ tracks });
  await saveLibrary(tracks);
}

export async function removeTracks(ids: string[]) {
  const set = new Set(ids);
  const tracks = libraryStore.get().tracks.filter((t) => !set.has(t.id));
  libraryStore.set({ tracks });
  removeFromQueue(set);
  await saveLibrary(tracks);
  // Note: audio files are left on disk in V1. A "reclaim space" step belongs with download management.
}
