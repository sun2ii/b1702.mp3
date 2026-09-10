import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { Track } from '../library/types';

/** Mirror of AudioEnginePlugin.swift. If you add a method there, add it here. */
export interface EngineState {
  playing: boolean;
  position: number; // seconds
  duration: number; // seconds
}

export interface AudioEnginePlugin {
  /** Copy a picked file into Library/Music and read its tags. Native half of LocalFileSource. */
  importFile(opts: { path: string }): Promise<Track>;
  /** Load a track (by file name inside Library/Music) and publish it to the Lock Screen. */
  loadTrack(opts: {
    fileName: string;
    title: string;
    artist: string;
    album: string;
    artworkFileName?: string;
    duration?: number;
  }): Promise<EngineState>;
  play(): Promise<EngineState>;
  pause(): Promise<EngineState>;
  seek(opts: { position: number }): Promise<EngineState>;
  getState(): Promise<EngineState>;
  /** Download to a temp file (streams to disk). Feed the result to importFile(). */
  downloadFile(opts: { url: string; authorization?: string; fileName: string }): Promise<{ path: string }>;
  /** Upload a file from Library/Music (streams from disk). Returns the JSON response body. */
  uploadFile(opts: {
    fileName: string;
    url: string;
    method?: 'PUT' | 'POST';
    contentType?: string;
    authorization?: string;
  }): Promise<Record<string, unknown>>;
  /** Extract the audio track of a video into a temp .m4a (AAC). Feed the result to importFile(). */
  exportAudio(opts: { path: string; title: string; artist?: string; album?: string; recordedAt?: string }): Promise<{ path: string }>;

  /** Rewrite tags (+ optional new cover from an image path). M4A files are re-tagged in place; MP3 = index only. */
  retag(opts: {
    fileName: string; title: string; artist: string; album: string;
    artworkSourcePath?: string; artworkFileName?: string;
  }): Promise<{ retagged: boolean; artworkFileName?: string }>;
  deleteFiles(opts: { fileName?: string; artworkFileName?: string }): Promise<void>;

  addListener(event: 'state', fn: (s: EngineState) => void): Promise<PluginListenerHandle>;
  addListener(event: 'ended', fn: () => void): Promise<PluginListenerHandle>;
  addListener(
    event: 'remote',
    fn: (e: { command: 'next' | 'previous' }) => void,
  ): Promise<PluginListenerHandle>;
}

export const AudioEngine = registerPlugin<AudioEnginePlugin>('AudioEngine');
