'use client';

import { useMemo, useState } from 'react';
import { artworkSrc, groupAlbums, groupArtists, sortSongs } from '@/lib/library/library-store';
import type { Album, Artist, Track } from '@/lib/library/types';
import { playTrack, playerStore } from '@/lib/player/player';
import { useStore } from '@/lib/store-util';
import { ChevronLeft, Cloud, CloudOff, More } from './Icons';
import { editAlbum, editTrack } from '@/lib/library/library';

export type Tab = 'songs' | 'albums' | 'artists';

export function fmtTime(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function Art({ track, big }: { track?: { artworkFileName?: string }; big?: boolean }) {
  const src = artworkSrc(track);
  const cls = `art${big ? ' big' : ''}`;
  return <img className={cls} src={src} alt="" />;
}

function TrackRow({ t, context, showNumber }: { t: Track; context: Track[]; showNumber?: boolean }) {
  const { current } = useStore(playerStore);
  return (
    <button className={`row${current?.id === t.id ? ' current' : ''}`} onClick={() => void playTrack(t, context)}>
      {showNumber ? <span className="num">{t.trackNumber ?? '–'}</span> : <Art track={t} />}
      <div className="meta">
        <div className="t">{t.title}</div>
        <div className="s">{t.artist}{!showNumber && ` · ${t.album}`}</div>
      </div>
      {t.sourceId === 'gdrive' && !t.fileName
        ? <span className="cloud"><Cloud /></span>
        : t.pendingUpload
          ? <span className="cloud pending"><CloudOff /></span>
          : <span className="dur">{fmtTime(t.duration)}</span>}
      <span className="more" onClick={(e) => { e.stopPropagation(); void editTrack(t.id); }}><More /></span>
    </button>
  );
}

function matches(t: Track, q: string) {
  if (!q) return true;
  const n = q.toLowerCase();
  return t.title.toLowerCase().includes(n) || t.artist.toLowerCase().includes(n) || t.album.toLowerCase().includes(n);
}

export function LibraryView({ tracks: all, tab, query = '' }: { tracks: Track[]; tab: Tab; query?: string }) {
  const [album, setAlbum] = useState<Album | null>(null);
  const [artist, setArtist] = useState<Artist | null>(null);

  const tracks = useMemo(() => all.filter((t) => matches(t, query.trim())), [all, query]);
  const songs = useMemo(() => sortSongs(tracks), [tracks]);
  const albums = useMemo(() => groupAlbums(tracks), [tracks]);
  const artists = useMemo(() => groupArtists(tracks), [tracks]);

  // Drill-down: album detail
  if (album) {
    // Re-resolve from fresh data so imports/deletes reflect immediately.
    const live = albums.find((a) => a.key === album.key) ?? album;
    return (
      <div className="scroll">
        <button className="back" onClick={() => setAlbum(null)}><ChevronLeft /> {artist ? artist.name : 'Albums'}</button>
        <div className="section-head">
          <div className="section-title">{live.title}</div>
          <span className="more" onClick={() => void editAlbum(live.key, { title: live.title, artist: live.artist })}><More /></span>
        </div>
        <div className="section-sub">{live.artist} · {live.tracks.length} tracks</div>
        {live.tracks.map((t) => <TrackRow key={t.id} t={t} context={live.tracks} showNumber />)}
      </div>
    );
  }

  // Drill-down: artist detail
  if (artist) {
    const live = artists.find((a) => a.name === artist.name) ?? artist;
    return (
      <div className="scroll">
        <button className="back" onClick={() => setArtist(null)}><ChevronLeft /> Artists</button>
        <div className="section-title">{live.name}</div>
        <div className="section-sub">{live.albums.length} albums · {live.tracks.length} tracks</div>
        {live.albums.map((a) => (
          <button key={a.key} className="row" onClick={() => setAlbum(a)}>
            <Art track={a} big />
            <div className="meta"><div className="t">{a.title}</div><div className="s">{a.tracks.length} tracks</div></div>
          </button>
        ))}
      </div>
    );
  }

  if (tab === 'songs') {
    return (
      <div className="scroll">
        {songs.map((t) => <TrackRow key={t.id} t={t} context={songs} />)}
      </div>
    );
  }

  if (tab === 'albums') {
    return (
      <div className="scroll">
        {albums.map((a) => (
          <button key={a.key} className="row" onClick={() => { setArtist(null); setAlbum(a); }}>
            <Art track={a} big />
            <div className="meta"><div className="t">{a.title}</div><div className="s">{a.artist} · {a.tracks.length} tracks</div></div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="scroll">
      {artists.map((a) => (
        <button key={a.name} className="row" onClick={() => setArtist(a)}>
          <div className="art big">{a.name.slice(0, 1).toUpperCase()}</div>
          <div className="meta"><div className="t">{a.name}</div><div className="s">{a.albums.length} albums · {a.tracks.length} tracks</div></div>
        </button>
      ))}
    </div>
  );
}
