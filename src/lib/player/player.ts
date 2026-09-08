import { Preferences } from '@capacitor/preferences';
import { AudioEngine } from '../native/audio-engine';
import { localSource } from '../library/local-source';
import { driveSource } from '../drive/drive-source';
import type { MusicSource, Track } from '../library/types';
import { createStore } from '../store-util';

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlayerState {
  /** The context the user started playback from (all songs, one album, ...). */
  queue: Track[];
  /** Playback order as indices into `queue`. Identity when shuffle is off. */
  order: number[];
  /** Index into `order`. -1 = nothing loaded. */
  cursor: number;
  current: Track | null;
  playing: boolean;
  position: number;
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
  /** True while a source is fetching bytes (Drive download). */
  loading: boolean;
  error: string | null;
}

export const playerStore = createStore<PlayerState>({
  queue: [],
  order: [],
  cursor: -1,
  current: null,
  playing: false,
  position: 0,
  duration: 0,
  shuffle: false,
  repeat: 'off',
  loading: false,
  error: null,
});

/** Where a track's bytes come from. Add GoogleDriveSource here later; nothing else changes. */
const sources: Record<string, MusicSource> = {
  [localSource.id]: localSource,
  [driveSource.id]: driveSource,
};

const PREFS_KEY = 'player-state-v1';
const PREV_RESTART_THRESHOLD = 3; // seconds: "previous" restarts the song after this

// ---------- Lifecycle ----------

let initialized = false;

/** Wire engine events and restore the last session. Call once, after the library is loaded. */
export async function initPlayer(library: Track[]) {
  if (initialized) return;
  initialized = true;

  await AudioEngine.addListener('state', (s) => {
    playerStore.set({ playing: s.playing, position: s.position, duration: s.duration });
    persistThrottled();
  });
  await AudioEngine.addListener('ended', () => void onTrackEnded());
  await AudioEngine.addListener('remote', (e) => {
    if (e.command === 'next') void next();
    else if (e.command === 'previous') void previous();
  });

  await restore(library);
}

// ---------- Public controls ----------

/** Start playing `track` with `context` as the queue (e.g. the list it was tapped in). */
export async function playTrack(track: Track, context: Track[]) {
  const queue = context.length ? context : [track];
  const startIndex = Math.max(0, queue.findIndex((t) => t.id === track.id));
  const order = buildOrder(queue.length, playerStore.get().shuffle, startIndex);
  playerStore.set({ queue, order, cursor: 0 });
  await loadCurrent(true);
}

export async function togglePlay() {
  const { current, playing } = playerStore.get();
  if (!current) return;
  if (playing) await AudioEngine.pause();
  else await AudioEngine.play();
}

export async function seek(position: number) {
  playerStore.set({ position });
  await AudioEngine.seek({ position });
}

export async function next() {
  const { order, cursor, repeat } = playerStore.get();
  if (!order.length) return;
  let c = cursor + 1;
  if (c >= order.length) {
    if (repeat !== 'all') {
      // End of queue: stop on the last track, parked at the start.
      await AudioEngine.pause();
      await AudioEngine.seek({ position: 0 });
      return;
    }
    c = 0;
  }
  playerStore.set({ cursor: c });
  await loadCurrent(true);
}

export async function previous() {
  const { order, cursor, position } = playerStore.get();
  if (!order.length) return;
  if (position > PREV_RESTART_THRESHOLD || cursor === 0) {
    await seek(0);
    return;
  }
  playerStore.set({ cursor: cursor - 1 });
  await loadCurrent(true);
}

export function toggleShuffle() {
  const s = playerStore.get();
  const shuffle = !s.shuffle;
  // Re-derive order but keep the current track where it is (as the new head).
  const currentQueueIndex = s.cursor >= 0 ? s.order[s.cursor] : 0;
  const order = buildOrder(s.queue.length, shuffle, currentQueueIndex);
  playerStore.set({ shuffle, order, cursor: s.queue.length ? 0 : -1 });
  void persist();
}

export function cycleRepeat() {
  const modes: RepeatMode[] = ['off', 'all', 'one'];
  const cur = playerStore.get().repeat;
  playerStore.set({ repeat: modes[(modes.indexOf(cur) + 1) % modes.length] });
  void persist();
}

/** Called by the library when tracks are removed so the queue never references ghosts. */
export function removeFromQueue(ids: Set<string>) {
  const s = playerStore.get();
  if (!s.queue.some((t) => ids.has(t.id))) return;
  const keep = s.queue.filter((t) => !ids.has(t.id));
  const currentId = s.current?.id;
  const idx = currentId ? keep.findIndex((t) => t.id === currentId) : -1;
  const order = buildOrder(keep.length, s.shuffle, Math.max(0, idx));
  playerStore.set({ queue: keep, order, cursor: keep.length ? 0 : -1, current: idx >= 0 ? s.current : null });
  void persist();
}

// ---------- Internals ----------

async function loadCurrent(autoplay: boolean) {
  const { queue, order, cursor } = playerStore.get();
  const track = queue[order[cursor]];
  if (!track) return;

  // Resolve bytes via the source: local = instant, Drive = download first.
  const source = sources[track.sourceId] ?? localSource;
  playerStore.set({ current: track, position: 0, duration: track.duration, loading: true, error: null });
  let fileName: string;
  try {
    fileName = await source.ensureLocal(track);
  } catch (e) {
    playerStore.set({ loading: false, error: (e as Error).message });
    return;
  }
  playerStore.set({ loading: false });
  await AudioEngine.loadTrack({
    fileName,
    title: track.title,
    artist: track.artist,
    album: track.album,
    artworkFileName: track.artworkFileName,
  });
  if (autoplay) await AudioEngine.play();
  await persist();
}

async function onTrackEnded() {
  const { repeat, order, cursor } = playerStore.get();
  if (repeat === 'one') {
    await AudioEngine.seek({ position: 0 });
    await AudioEngine.play();
    return;
  }
  if (cursor + 1 >= order.length && repeat === 'off') {
    playerStore.set({ playing: false, position: 0 });
    await AudioEngine.seek({ position: 0 });
    return;
  }
  await next();
}

/** Fisher–Yates over indices, with `head` forced to the front when shuffling. */
function buildOrder(n: number, shuffle: boolean, head: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  if (!shuffle) {
    // Identity order, rotated so `head` is first only when explicitly starting from it.
    return idx.slice(head).concat(idx.slice(0, head));
  }
  const rest = idx.filter((i) => i !== head);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return n ? [head, ...rest] : [];
}

// ---------- Persistence ----------

interface Persisted {
  queueIds: string[];
  order: number[];
  cursor: number;
  position: number;
  shuffle: boolean;
  repeat: RepeatMode;
  /** True while a source is fetching bytes (Drive download). */
  loading: boolean;
  error: string | null;
}

async function persist() {
  const s = playerStore.get();
  const data: Persisted = {
    queueIds: s.queue.map((t) => t.id),
    order: s.order,
    cursor: s.cursor,
    position: s.position,
    shuffle: s.shuffle,
    repeat: s.repeat,
  };
  await Preferences.set({ key: PREFS_KEY, value: JSON.stringify(data) });
}

let lastPersist = 0;
function persistThrottled() {
  const now = Date.now();
  if (now - lastPersist > 5000) {
    lastPersist = now;
    void persist();
  }
}

async function restore(library: Track[]) {
  const r = await Preferences.get({ key: PREFS_KEY });
  if (!r.value) return;
  try {
    const p: Persisted = JSON.parse(r.value);
    const byId = new Map(library.map((t) => [t.id, t]));
    const queue = p.queueIds.map((id) => byId.get(id)).filter((t): t is Track => !!t);
    if (!queue.length) {
      playerStore.set({ shuffle: p.shuffle, repeat: p.repeat });
      return;
    }
    // If tracks vanished, the saved order is invalid; rebuild it.
    const orderValid = queue.length === p.queueIds.length && p.order.length === queue.length;
    const order = orderValid ? p.order : buildOrder(queue.length, p.shuffle, 0);
    const cursor = orderValid ? Math.min(p.cursor, order.length - 1) : 0;
    playerStore.set({ queue, order, cursor, shuffle: p.shuffle, repeat: p.repeat });
    await loadCurrent(false);
    if (p.position > 0) await AudioEngine.seek({ position: p.position });
  } catch {
    /* corrupt state: start fresh */
  }
}
