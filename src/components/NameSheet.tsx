'use client';

import { useEffect, useState } from 'react';
import { promptStore } from '@/lib/prompt';
import { useStore } from '@/lib/store-util';

/** Bottom sheet asking for title / artist / album before a recording is imported. */
export function NameSheet() {
  const { pending } = useStore(promptStore);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');

  useEffect(() => {
    if (pending) {
      setTitle(pending.defaults.title);
      setArtist(pending.defaults.artist);
      setAlbum(pending.defaults.album);
    }
  }, [pending]);

  if (!pending) return null;
  const ok = title.trim().length > 0;

  return (
    <div className="sheet-backdrop">
      <div className="sheet">
        <div className="sheet-title">{pending.heading}</div>
        <label className="field">
          <span>Title</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song name" />
        </label>
        <label className="field">
          <span>Artist</span>
          <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist" />
        </label>
        <label className="field">
          <span>Album</span>
          <input value={album} onChange={(e) => setAlbum(e.target.value)} placeholder="Album" />
        </label>
        <div className="sheet-actions">
          <button className="import-btn" onClick={() => pending.resolve(null)}>Skip this one</button>
          <button
            className="import-btn primary"
            disabled={!ok}
            onClick={() => pending.resolve({ title: title.trim(), artist: artist.trim() || 'Unknown Artist', album: album.trim() || 'Phone Recordings' })}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
