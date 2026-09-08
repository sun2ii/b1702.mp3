import { FilePicker } from '@capawesome/capacitor-file-picker';
import { AudioEngine } from '../native/audio-engine';
import type { MusicSource, Track } from './types';

/**
 * V1's only source: files the user imports from the Files app.
 * Import = Files picker -> native copy into Library/Music -> native tag extraction -> Track.
 */
export class LocalFileSource implements MusicSource {
  readonly id = 'local';

  async ensureLocal(track: Track): Promise<string> {
    return track.fileName; // already on disk by definition
  }

  /** Opens the iOS Files picker and imports every selected audio file. */
  async importFromFiles(): Promise<{ tracks: Track[]; errors: string[] }> {
    const result = await FilePicker.pickFiles({
      types: ['audio/*'], // the picker maps this to UTType.audio and hands back a temp copy
      readData: false,
    });

    const tracks: Track[] = [];
    const errors: string[] = [];
    for (const f of result.files) {
      if (!f.path) {
        errors.push(`${f.name}: no path returned by picker`);
        continue;
      }
      try {
        const t = await AudioEngine.importFile({ path: f.path });
        tracks.push({ ...t, sourceId: this.id });
      } catch (e) {
        errors.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    return { tracks, errors };
  }
}

export const localSource = new LocalFileSource();
