'use client';

import { useEffect, useState } from 'react';
import { bootLibrary, importFromFiles, libraryStore } from '@/lib/library/library';
import { useStore } from '@/lib/store-util';
import { LibraryView, type Tab } from '@/components/LibraryView';
import { MiniPlayer, NowPlaying } from '@/components/Player';

export default function Home() {
  const lib = useStore(libraryStore);
  const [tab, setTab] = useState<Tab>('songs');
  const [showNowPlaying, setShowNowPlaying] = useState(false);

  // All Capacitor access happens after mount: the static export is prerendered at build
  // time in Node, where no bridge exists.
  useEffect(() => { void bootLibrary(); }, []);

  return (
    <div className="app">
      <header className="header">
        <span className="brand">Winamp</span>
        <button className="import-btn" disabled={lib.importing} onClick={() => void importFromFiles()}>
          {lib.importing ? 'Importing…' : '+ Import'}
        </button>
      </header>

      <nav className="tabs">
        {(['songs', 'albums', 'artists'] as Tab[]).map((t) => (
          <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      {lib.lastError && <div className="error">{lib.lastError}</div>}

      {lib.ready && lib.tracks.length === 0 ? (
        <div className="empty">
          <span className="brand">Library empty</span>
          Tap <b>+ Import</b> and pick MP3 or M4A files from the Files app.
        </div>
      ) : (
        <LibraryView key={tab} tracks={lib.tracks} tab={tab} />
      )}

      <MiniPlayer onOpen={() => setShowNowPlaying(true)} />
      {showNowPlaying && <NowPlaying onClose={() => setShowNowPlaying(false)} />}
    </div>
  );
}
