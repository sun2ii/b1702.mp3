'use client';

import { useEffect, useState } from 'react';
import { bootLibrary, importFromFiles, importFromPhotos, libraryStore, syncDrive } from '@/lib/library/library';
import { Cloud } from '@/components/Icons';
import { useStore } from '@/lib/store-util';
import { LibraryView, type Tab } from '@/components/LibraryView';
import { MiniPlayer, NowPlaying } from '@/components/Player';
import { NameSheet } from '@/components/NameSheet';

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
        <div className="header-actions">
          <button className="import-btn" disabled={lib.driveSyncing} onClick={() => void syncDrive()}>
            <Cloud /> {lib.driveSyncing ? 'Syncing…' : 'Sync'}
          </button>
          <button className="import-btn" disabled={lib.importing} onClick={() => void importFromPhotos()}>
            {lib.importing ? '…' : '+ Video'}
          </button>
          <button className="import-btn" disabled={lib.importing} onClick={() => void importFromFiles()}>
            {lib.importing ? '…' : '+ Files'}
          </button>
        </div>
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
          <b>Sync</b> pulls in your Google Drive library.<br /><b>+ Video</b> turns a Photos video into a track and uploads it.<br /><b>+ Files</b> imports MP3/M4A from the Files app.
        </div>
      ) : (
        <LibraryView key={tab} tracks={lib.tracks} tab={tab} />
      )}

      <MiniPlayer onOpen={() => setShowNowPlaying(true)} />
      {showNowPlaying && <NowPlaying onClose={() => setShowNowPlaying(false)} />}
      <NameSheet />
    </div>
  );
}
