'use client';

import { useEffect, useState } from 'react';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { promptStore } from '@/lib/prompt';
import { useStore } from '@/lib/store-util';

/** Auto-capitalize each word as user types (Title Case). */
function titleCase(prev: string, next: string): string {
  // Only transform if user is typing forward (not deleting)
  if (next.length <= prev.length) return next;
  // Capitalize after start or space
  const added = next.slice(prev.length);
  if (added.length === 1 && /[a-z]/.test(added)) {
    const before = next.slice(0, -1);
    if (before.length === 0 || before.endsWith(' ')) {
      return before + added.toUpperCase();
    }
  }
  return next;
}

/** Bottom sheets: name/edit a track or album, and confirm deletes. Driven by promptStore. */
export function Sheets() {
  const { pending } = useStore(promptStore);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [coverPath, setCoverPath] = useState<string | undefined>();

  useEffect(() => {
    if (pending?.kind === 'info') {
      setTitle(pending.defaults.title);
      setArtist(pending.defaults.artist);
      setAlbum(pending.defaults.album);
      setCoverPath(undefined);
    }
  }, [pending]);

  if (!pending) return null;

  if (pending.kind === 'delete') {
    return (
      <div className="sheet-backdrop" onClick={() => pending.resolve('cancel')}>
        <div className="sheet" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-title">{pending.heading}</div>
          <div className="sheet-actions column">
            <button className="import-btn" onClick={() => pending.resolve('phone')}>
              {pending.hasRemote ? 'Remove from this phone (keep in Drive)' : 'Delete from this phone'}
            </button>
            {pending.hasRemote && (
              <button className="import-btn danger" onClick={() => pending.resolve('everywhere')}>
                Delete everywhere (moves to Drive trash)
              </button>
            )}
            <button className="import-btn" onClick={() => pending.resolve('cancel')}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  const show = (f: 'title' | 'artist' | 'album') => pending.fields.includes(f);
  const ok = !show('title') || title.trim().length > 0;

  const pickCover = async () => {
    try {
      const r = await FilePicker.pickImages({ limit: 1 });
      if (r.files[0]?.path) setCoverPath(r.files[0].path);
    } catch { /* cancelled */ }
  };

  return (
    <div className="sheet-backdrop">
      <div className="sheet">
        <div className="sheet-title">{pending.heading}</div>
        {show('title') && (
          <label className="field"><span>Title</span>
            <input autoFocus value={title} onChange={(e) => setTitle(titleCase(title, e.target.value))} placeholder="Song name" /></label>
        )}
        {show('artist') && (
          <label className="field"><span>Artist</span>
            <input value={artist} onChange={(e) => setArtist(titleCase(artist, e.target.value))} placeholder="Artist" /></label>
        )}
        {show('album') && (
          <label className="field"><span>Album</span>
            <input autoFocus={!show('title')} value={album} onChange={(e) => setAlbum(titleCase(album, e.target.value))} placeholder="Album" /></label>
        )}
        {pending.allowCover && (
          <button className="import-btn" onClick={() => void pickCover()}>
            {coverPath ? '✓ New cover selected' : 'Change cover…'}
          </button>
        )}
        <div className="sheet-actions">
          {pending.allowDelete && (
            <button className="import-btn danger" onClick={() => pending.resolve({ action: 'delete' })}>Delete…</button>
          )}
          <span style={{ flex: 1 }} />
          <button className="import-btn" onClick={() => pending.resolve({ action: 'cancel' })}>Cancel</button>
          <button
            className="import-btn primary"
            disabled={!ok}
            onClick={() => pending.resolve({
              action: 'save',
              info: { title: title.trim(), artist: artist.trim() || 'Unknown Artist', album: album.trim() || 'Unknown Album' },
              coverPath,
            })}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
