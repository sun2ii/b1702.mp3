import { FilePicker } from '@capawesome/capacitor-file-picker';
import { Preferences } from '@capacitor/preferences';
import { askDelete, askTrackInfo, type TrackInfo } from '../prompt';
import { AudioEngine } from '../native/audio-engine';
import { createStore } from '../store-util';
import { localSource } from './local-source';
import { installDefaultCover, loadLibrary, resolveLibraryUri, saveLibrary } from './library-store';
import type { Track } from './types';
import { initPlayer, playerStore, removeFromQueue } from '../player/player';
import { driveSource } from '../drive/drive-source';
import { driveConfigured } from '../drive/config';

export interface LibraryState {
  tracks: Track[];
  ready: boolean;
  importing: boolean;
  lastError: string | null;
  driveSyncing: boolean;
}

export const libraryStore = createStore<LibraryState>({
  tracks: [],
  ready: false,
  importing: false,
  lastError: null,
  driveSyncing: false,
});

/** App boot: read the index, resolve the artwork base URL, then let the player restore itself. */
export async function bootLibrary() {
  await resolveLibraryUri();
  await installDefaultCover();
  const tracks = await loadLibrary();
  libraryStore.set({ tracks, ready: true });

  // When a Drive track finishes downloading, replace its stub with the tagged, cached version.
  driveSource.onCached = async (updated) => {
    const next = libraryStore.get().tracks.map((t) => (t.id === updated.id ? updated : t));
    libraryStore.set({ tracks: next });
    await saveLibrary(next);
  };
  await initPlayer(tracks);
}

/** Sign in (if needed) and merge the Drive folder into the library. Never removes cached files. */
export async function syncDrive() {
  if (!driveConfigured()) {
    libraryStore.set({ lastError: 'Google Drive is not configured: add src/lib/drive/service-account.json' });
    return;
  }
  libraryStore.set({ driveSyncing: true, lastError: null });
  try {
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



export async function importFromFiles() {
  libraryStore.set({ importing: true, lastError: null });
  try {
    const { tracks: imported, errors } = await localSource.importFromFiles();
    if (imported.length) {
      const tracks = [...libraryStore.get().tracks, ...imported];
      libraryStore.set({ tracks });
      await saveLibrary(tracks);

      // Drive is the master library: offer to push Files-app imports up too.
      if (driveConfigured() && window.confirm(`Upload ${imported.length} file${imported.length > 1 ? 's' : ''} to Google Drive?`)) {
        for (const t of imported) {
          try { await replace(t.id, await driveSource.upload({ ...t, pendingUpload: true })); }
          catch (e) { await replace(t.id, { ...t, pendingUpload: true }); errors.push(`${t.title}: upload failed (${(e as Error).message})`); }
        }
      }
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
    const lastArtist = (await Preferences.get({ key: 'last-artist' })).value ?? '';
    const lastAlbum = (await Preferences.get({ key: 'last-album' })).value ?? 'Phone Recordings';
    let i = 0;
    for (const f of picked.files) {
      i++;
      if (!f.path) { errors.push(`${f.name}: no path returned by picker`); continue; }
      const recordedAt = new Date(f.modifiedAt ?? Date.now()).toISOString();
      const res = await askTrackInfo(
        picked.files.length > 1 ? `Name recording ${i} of ${picked.files.length}` : 'Name this recording',
        { title: recordingTitle(f.modifiedAt), artist: lastArtist, album: lastAlbum },
      );
      if (res.action !== 'save') continue; // skipped
      const info = res.info;
      await Preferences.set({ key: 'last-artist', value: info.artist });
      await Preferences.set({ key: 'last-album', value: info.album });
      const title = info.title;
      try {
        const { path } = await AudioEngine.exportAudio({ path: f.path, ...info, recordedAt });
        const imported = await AudioEngine.importFile({ path });
        let track: Track = { ...imported, ...info, sourceId: 'local', recordedAt, pendingUpload: true };
        await upsert(track);

        if (driveConfigured()) {
          try {
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
  // Keep the player's copy in step so Now Playing / mini-player reflect edits immediately.
  const p = playerStore.get();
  if (p.queue.some((t) => t.id === oldId)) {
    playerStore.set({
      queue: p.queue.map((t) => (t.id === oldId ? track : t)),
      current: p.current?.id === oldId ? track : p.current,
    });
  }
  await saveLibrary(tracks);
}

// ---------- Edit / delete ----------

/** Apply new tags (+ optional cover) to one track: index → file → Drive. */
async function applyEdit(track: Track, info: TrackInfo, coverPath?: string): Promise<Track> {
  let next: Track = { ...track, ...info };
  let bytesChanged = false;
  if (track.fileName) {
    const r = await AudioEngine.retag({
      fileName: track.fileName, ...info,
      artworkSourcePath: coverPath, artworkFileName: track.artworkFileName,
    });
    bytesChanged = r.retagged;
    if (r.artworkFileName) next.artworkFileName = r.artworkFileName;
  }
  await replace(track.id, next);
  if (next.remoteId && driveConfigured()) {
    try { next = await driveSource.syncEdit(next, bytesChanged); await replace(next.id, next); }
    catch (e) { libraryStore.set({ lastError: `Saved on phone; Drive update failed (${(e as Error).message})` }); }
  }
  return next;
}

export async function editTrack(id: string) {
  const track = libraryStore.get().tracks.find((t) => t.id === id);
  if (!track) return;
  const res = await askTrackInfo('Edit track', { title: track.title, artist: track.artist, album: track.album },
    { allowCover: !!track.fileName, allowDelete: true });
  if (res.action === 'cancel') return;
  if (res.action === 'delete') { await deleteTrack(id); return; }
  libraryStore.set({ importing: true, lastError: null });
  try { await applyEdit(track, res.info, res.coverPath); }
  catch (e) { libraryStore.set({ lastError: (e as Error).message }); }
  finally { libraryStore.set({ importing: false }); }
}

/** Rename an album and/or set one cover for every track in it. */
export async function editAlbum(albumKey: string, current: { title: string; artist: string }) {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const members = libraryStore.get().tracks.filter((t) => norm(t.album) === albumKey);
  if (!members.length) return;
  const res = await askTrackInfo('Edit album', { title: '', artist: current.artist, album: current.title },
    { fields: ['album'], allowCover: members.some((t) => !!t.fileName) });
  if (res.action !== 'save') return;
  libraryStore.set({ importing: true, lastError: null });
  try {
    for (const t of members) {
      await applyEdit(t, { title: t.title, artist: t.artist, album: res.info.album }, res.coverPath);
    }
  } catch (e) { libraryStore.set({ lastError: (e as Error).message }); }
  finally { libraryStore.set({ importing: false }); }
}

export async function deleteTrack(id: string) {
  const track = libraryStore.get().tracks.find((t) => t.id === id);
  if (!track) return;
  const choice = await askDelete(`Delete “${track.title}”?`, !!track.remoteId);
  if (choice === 'cancel') return;
  try {
    await AudioEngine.deleteFiles({ fileName: track.fileName || undefined, artworkFileName: track.artworkFileName });
    if (choice === 'everywhere') {
      if (track.remoteId && driveConfigured()) await driveSource.trash(track);
      await removeTracks([id]);
    } else if (track.remoteId) {
      // Back to a cloud stub: still listed, downloadable again on tap.
      await replace(id, { ...track, fileName: '', artworkFileName: undefined, duration: track.duration });
      removeFromQueue(new Set([id]));
    } else {
      await removeTracks([id]);
    }
  } catch (e) { libraryStore.set({ lastError: (e as Error).message }); }
}

export async function removeTracks(ids: string[]) {
  const set = new Set(ids);
  const tracks = libraryStore.get().tracks.filter((t) => !set.has(t.id));
  libraryStore.set({ tracks });
  removeFromQueue(set);
  await saveLibrary(tracks);
  // Note: audio files are left on disk in V1. A "reclaim space" step belongs with download management.
}
