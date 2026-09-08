'use client';

import { useState } from 'react';
import { artworkSrc } from '@/lib/library/library-store';
import { cycleRepeat, next, playerStore, previous, seek, toggleShuffle, togglePlay } from '@/lib/player/player';
import { useStore } from '@/lib/store-util';
import { ChevronDown, Next, Pause, Play, Prev, Repeat, Shuffle } from './Icons';
import { fmtTime } from './LibraryView';

function fmtDate(iso?: string) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "REC Sep 8, 2026 · DRIVE Sep 8, 2026 · M4A" — what you'd want to glance at on an LCD. */
function metaLine(t: { recordedAt?: string; uploadedAt?: string; pendingUpload?: boolean; sourceId: string; fileName: string }) {
  const parts: string[] = [];
  const r = fmtDate(t.recordedAt);
  const u = fmtDate(t.uploadedAt);
  if (r) parts.push(`REC ${r}`);
  if (u) parts.push(`DRIVE ${u}`);
  else if (t.pendingUpload) parts.push('DRIVE pending');
  else if (t.sourceId === 'local') parts.push('LOCAL only');
  if (t.sourceId === 'gdrive' && !t.fileName) parts.push('not downloaded');
  return parts.join(' · ');
}

/** Persistent bar at the bottom of the library. Tap it to open Now Playing. */
export function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const p = useStore(playerStore);
  if (!p.current) return null;
  const src = artworkSrc(p.current);
  const pct = p.duration ? (p.position / p.duration) * 100 : 0;
  return (
    <div className="mini" onClick={onOpen}>
      <img className="art" src={src} alt="" />
      <div className="meta">
        <div className="t">{p.current.title}</div>
        <div className="s">{p.loading ? 'Downloading…' : p.error ? p.error : p.current.artist}</div>
      </div>
      <button className="icon-btn" onClick={(e) => { e.stopPropagation(); void togglePlay(); }}>
        {p.playing ? <Pause /> : <Play />}
      </button>
      <button className="icon-btn" onClick={(e) => { e.stopPropagation(); void next(); }}><Next /></button>
      <div className="progress" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Full-screen Now Playing. */
export function NowPlaying({ onClose }: { onClose: () => void }) {
  const p = useStore(playerStore);
  // While the thumb is being dragged we show the drag position, not the engine's ticks.
  const [drag, setDrag] = useState<number | null>(null);
  if (!p.current) return null;

  const src = artworkSrc(p.current);
  const pos = drag ?? p.position;
  const pct = p.duration ? (pos / p.duration) * 100 : 0;

  return (
    <div className="np">
      <div className="np-top">
        <button className="icon-btn" onClick={onClose}><ChevronDown /></button>
        <span className="brand">Now Playing</span>
        <span style={{ width: 40 }} />
      </div>

      <div className="np-art">
        <img src={src} alt="" />
      </div>

      <div className="np-title">{p.current.title}</div>
      <div className="np-artist">{p.current.artist} — {p.current.album}</div>
      <div className="np-meta">{metaLine(p.current)}</div>

      <div className="lcd">
        <span>{fmtTime(pos)}</span>
        <span>{p.loading ? 'DOWNLOADING' : p.current.fileType.toUpperCase()}{p.playing ? ' ▶' : ' ❚❚'}</span>
        <span>-{fmtTime(Math.max(0, p.duration - pos))}</span>
      </div>
      <input
        className="seek"
        type="range"
        min={0}
        max={p.duration || 1}
        step={0.1}
        value={pos}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => setDrag(parseFloat(e.target.value))}
        onPointerUp={() => { if (drag != null) { void seek(drag); setDrag(null); } }}
        onTouchEnd={() => { if (drag != null) { void seek(drag); setDrag(null); } }}
      />

      <div className="transport">
        <button className={`icon-btn mode${p.shuffle ? ' on' : ''}`} onClick={toggleShuffle}><Shuffle /></button>
        <button className="icon-btn" onClick={() => void previous()}><Prev /></button>
        <button className="icon-btn play" onClick={() => void togglePlay()}>{p.playing ? <Pause /> : <Play />}</button>
        <button className="icon-btn" onClick={() => void next()}><Next /></button>
        <button className={`icon-btn mode${p.repeat !== 'off' ? ' on' : ''}`} onClick={cycleRepeat}>
          <Repeat />{p.repeat === 'one' && <span className="badge">1</span>}
        </button>
      </div>
    </div>
  );
}
