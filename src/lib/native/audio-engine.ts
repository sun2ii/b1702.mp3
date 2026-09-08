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
  }): Promise<EngineState>;
  play(): Promise<EngineState>;
  pause(): Promise<EngineState>;
  seek(opts: { position: number }): Promise<EngineState>;
  getState(): Promise<EngineState>;

  addListener(event: 'state', fn: (s: EngineState) => void): Promise<PluginListenerHandle>;
  addListener(event: 'ended', fn: () => void): Promise<PluginListenerHandle>;
  addListener(
    event: 'remote',
    fn: (e: { command: 'next' | 'previous' }) => void,
  ): Promise<PluginListenerHandle>;
}

export const AudioEngine = registerPlugin<AudioEnginePlugin>('AudioEngine');
