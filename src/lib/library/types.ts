/**
 * A track in the library. Paths are RELATIVE file names inside the app's Library/Music
 * and Library/Artwork folders — iOS changes the app container path on reinstall, so
 * absolute paths would silently break.
 */
export interface Track {
  id: string;
  /** Which MusicSource owns this track ("local" now, "gdrive" later). */
  sourceId: string;
  /** File name inside Library/Music. For a Drive track this is the cached copy (or empty until cached). */
  fileName: string;
  title: string;
  artist: string;
  album: string;
  trackNumber?: number;
  duration: number; // seconds
  artworkFileName?: string;
  fileType: string; // "mp3" | "m4a" | ...
  addedAt: string; // ISO date
}

/**
 * The seam for Google Drive.
 *
 *   LocalFileSource.ensureLocal(track)  -> returns track.fileName (already on disk)
 *   GoogleDriveSource.ensureLocal(track) -> downloads into Library/Music, then returns the name
 *
 * The player only ever calls ensureLocal() before loading. It never knows where a file came from.
 */
export interface MusicSource {
  readonly id: string;
  ensureLocal(track: Track): Promise<string>;
}

export interface Album {
  key: string;
  title: string;
  artist: string;
  tracks: Track[];
  artworkFileName?: string;
}

export interface Artist {
  name: string;
  tracks: Track[];
  albums: Album[];
}
