import { AudioEngine } from '../native/audio-engine';
import type { MusicSource, Track } from '../library/types';
import { DRIVE_CONFIG } from './config';
import { accessToken, createUploadSession, downloadUrl, listAudioFiles, type DriveFile } from './drive-api';

/**
 * Google Drive as a MusicSource.
 *
 *   sync()               Drive folder tree  ->  Track stubs (sourceId "gdrive", fileName "")
 *   ensureLocal(track)   stub  ->  download  ->  TrackImporter (copy + tags)  ->  cached Track
 *
 * A Drive track with fileName === "" is "in the cloud"; once cached it is indistinguishable
 * from an imported file. `onCached` lets the library persist the upgraded track.
 */
export class GoogleDriveSource implements MusicSource {
  readonly id = 'gdrive';

  /** Set by the library so a freshly cached track's tags/artwork get saved. */
  onCached: (updated: Track) => Promise<void> = async () => {};

  /** Build stub tracks for every audio file in the root folder. Metadata is guessed from folders. */
  async sync(): Promise<Track[]> {
    const files = await listAudioFiles(DRIVE_CONFIG.rootFolderId);
    return files.map(toStub);
  }

  /** Push a local track's file into the Drive folder and return it re-homed as a Drive track. */
  async upload(track: Track): Promise<Track> {
    const mime = track.fileType === 'mp3' ? 'audio/mpeg' : 'audio/mp4';
    const name = track.remoteName ?? track.fileName;
    const sessionUri = await createUploadSession(name, DRIVE_CONFIG.rootFolderId, mime);
    const res = await AudioEngine.uploadFile({
      fileName: track.fileName,
      url: sessionUri,
      method: 'PUT',
      contentType: mime,
      authorization: `Bearer ${await accessToken()}`,
    });
    const remoteId = String(res.id ?? '');
    if (!remoteId) throw new Error('Drive upload returned no file id');
    return {
      ...track, id: `gdrive:${remoteId}`, sourceId: this.id, remoteId, remoteName: name,
      pendingUpload: false, uploadedAt: new Date().toISOString(),
    };
  }

  async ensureLocal(track: Track): Promise<string> {
    if (track.fileName) return track.fileName; // already cached
    if (!track.remoteId) throw new Error('Drive track has no remoteId');

    const { path } = await AudioEngine.downloadFile({
      url: downloadUrl(track.remoteId),
      authorization: `Bearer ${await accessToken()}`,
      fileName: track.remoteName ?? `${track.title}.${track.fileType || 'mp3'}`,
    });
    const imported = await AudioEngine.importFile({ path });

    // Keep identity + Drive linkage; take real tags from the file, but prefer folder-derived
    // artist/album when the file's tags are missing.
    const updated: Track = {
      ...imported,
      id: track.id,
      sourceId: this.id,
      remoteId: track.remoteId,
      remoteName: track.remoteName,
      uploadedAt: track.uploadedAt,
      recordedAt: imported.recordedAt ?? track.recordedAt,
      artist: imported.artist === 'Unknown Artist' ? track.artist : imported.artist,
      album: imported.album === 'Unknown Album' ? track.album : imported.album,
    };
    await this.onCached(updated);
    return updated.fileName;
  }
}

/** Folder convention: <root>/Artist/Album/track.mp3. Shallower paths degrade gracefully. */
function toStub(f: DriveFile): Track {
  const [a, b] = f.pathParts;
  const ext = (f.name.split('.').pop() ?? '').toLowerCase();
  return {
    id: `gdrive:${f.id}`,
    sourceId: 'gdrive',
    remoteId: f.id,
    remoteName: f.name,
    fileName: '',
    title: f.name.replace(/\.[^.]+$/, ''),
    artist: f.pathParts.length >= 2 ? a : 'Unknown Artist',
    album: f.pathParts.length >= 2 ? b : a ?? 'Unknown Album',
    duration: 0,
    fileType: ext,
    addedAt: f.createdTime ?? f.modifiedTime ?? new Date().toISOString(),
    uploadedAt: f.createdTime,
  };
}

export const driveSource = new GoogleDriveSource();
