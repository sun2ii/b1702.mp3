import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

export const DEFAULT_COVER_WEB = '/cover-default.jpg';
const DEFAULT_COVER_FILE = 'Artwork/_default.jpg';
import type { Album, Artist, Track } from './types';

const LIBRARY_FILE = 'library.json';

/**
 * Persistence for the library index: one JSON file in the app's Library directory,
 * next to Music/ and Artwork/. Inspectable, diffable, and enough until the library
 * is thousands of tracks — at which point swap this file for SQLite without touching the UI.
 */
export async function loadLibrary(): Promise<Track[]> {
  try {
    const r = await Filesystem.readFile({
      path: LIBRARY_FILE,
      directory: Directory.Library,
      encoding: Encoding.UTF8,
    });
    const parsed = JSON.parse(r.data as string);
    return Array.isArray(parsed.tracks) ? parsed.tracks : [];
  } catch {
    return []; // first launch
  }
}

export async function saveLibrary(tracks: Track[]): Promise<void> {
  await Filesystem.writeFile({
    path: LIBRARY_FILE,
    directory: Directory.Library,
    encoding: Encoding.UTF8,
    data: JSON.stringify({ version: 1, tracks }, null, 2),
  });
}

/** file:// URI of the Library directory, resolved once. */
let libraryUri: string | null = null;
export async function resolveLibraryUri(): Promise<string> {
  if (!libraryUri) {
    const r = await Filesystem.getUri({ path: '', directory: Directory.Library });
    libraryUri = r.uri.replace(/\/$/, '');
  }
  return libraryUri;
}

/**
 * Copy the bundled default cover into Library/Artwork once, so the native side (Lock Screen,
 * M4A export) can use the same image the UI shows. Re-copied when the bundled file changes size.
 */
export async function installDefaultCover(): Promise<void> {
  try {
    const res = await fetch(DEFAULT_COVER_WEB);
    const blob = await res.blob();
    try {
      const st = await Filesystem.stat({ path: DEFAULT_COVER_FILE, directory: Directory.Library });
      if (st.size === blob.size) return;
    } catch { /* not installed yet */ }
    const base64 = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve((r.result as string).split(',')[1]);
      r.readAsDataURL(blob);
    });
    await Filesystem.writeFile({ path: DEFAULT_COVER_FILE, directory: Directory.Library, data: base64 });
  } catch { /* cosmetic; never block boot */ }
}

/** URL for a track's artwork; falls back to the bundled default cover. */
export function artworkSrc(track: { artworkFileName?: string } | undefined): string {
  if (!track?.artworkFileName || !libraryUri) return DEFAULT_COVER_WEB;
  return Capacitor.convertFileSrc(`${libraryUri}/Artwork/${track.artworkFileName}`);
}

/** Grouping key: case/whitespace-insensitive so "AGI", "agi " and "Agi" are one album. */
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

// ---- Grouping (pure functions over the track list) ----

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export function sortSongs(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => collator.compare(a.title, b.title));
}

export function groupAlbums(tracks: Track[]): Album[] {
  const map = new Map<string, Album>();
  // Group by album NAME only (not artist+album): a personal library where one album can hold
  // takes tagged with slightly different artist strings should still be one album.
  for (const t of tracks) {
    const key = norm(t.album);
    let album = map.get(key);
    if (!album) {
      album = { key, title: t.album.trim(), artist: t.artist.trim(), tracks: [], artworkFileName: t.artworkFileName };
      map.set(key, album);
    }
    album.tracks.push(t);
    if (!album.artworkFileName && t.artworkFileName) album.artworkFileName = t.artworkFileName;
  }
  // Album artist = the most common artist among its tracks.
  for (const a of map.values()) {
    const counts = new Map<string, number>();
    for (const t of a.tracks) counts.set(norm(t.artist), (counts.get(norm(t.artist)) ?? 0) + 1);
    const top = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
    a.artist = a.tracks.find((t) => norm(t.artist) === top)?.artist.trim() ?? a.artist;
  }
  for (const a of map.values()) {
    a.tracks.sort((x, y) => (x.trackNumber ?? 9999) - (y.trackNumber ?? 9999) || collator.compare(x.title, y.title));
  }
  return [...map.values()].sort((a, b) => collator.compare(a.title, b.title));
}

export function groupArtists(tracks: Track[]): Artist[] {
  // Group by track artist (not album artist) so each artist appears even if their
  // songs are scattered across compilation albums or "Unknown Album".
  const map = new Map<string, Artist>();
  for (const t of tracks) {
    const key = norm(t.artist);
    let artist = map.get(key);
    if (!artist) {
      artist = { name: t.artist.trim(), tracks: [], albums: [] };
      map.set(key, artist);
    }
    artist.tracks.push(t);
  }
  // Build albums per artist from their tracks
  for (const artist of map.values()) {
    artist.albums = groupAlbums(artist.tracks);
  }
  return [...map.values()].sort((a, b) => collator.compare(a.name, b.name));
}
