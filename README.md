# Winamp (personal iPhone music player)

A personal MP3 player in the spirit of classic Winamp. V1 = import files from the Files app, browse, play, keep playing when locked.

## How it's put together

```
┌──────────── WebView: Next.js static export (src/) ─────────────┐
│  components/   Library (Songs/Albums/Artists), NowPlaying, Mini │
│  lib/player/   queue · shuffle · repeat · persistence           │
│  lib/library/  Track model · MusicSource seam · library.json    │
│  lib/native/   typed bridge to the Swift plugin                 │
└──────────────────────────────┬─────────────────────────────────┘
                               │ Capacitor bridge (calls + events)
┌──────────────────────────────▼─────────────────────────────────┐
│  plugins/audio-engine (Swift, in-repo Capacitor plugin)         │
│  AudioEngine.swift     AVPlayer + AVAudioSession(.playback)     │
│                        MPNowPlayingInfoCenter (Lock Screen)     │
│                        MPRemoteCommandCenter (remote controls)  │
│  TrackImporter.swift   copy into Library/Music + read tags      │
│  AudioEnginePlugin.swift  thin bridge, no logic                 │
└────────────────────────────────────────────────────────────────┘
```

**Why the engine is native:** WKWebView's `<audio>` is suspended when the phone locks and the web MediaSession API doesn't drive the iOS Lock Screen. A ~200-line Swift plugin owns playback; the web layer only decides *what* plays. This is also the seam for EQ / visualizer / skins later.

**Storage layout (app sandbox, `Library/`):**

```
Library/
  library.json      index of tracks (JSON, version 1)
  Music/<file>      audio files, original names, de-duplicated
  Artwork/<id>.jpg  extracted cover art
```

Only *relative* file names are stored: iOS moves the app container on reinstall.

**Google Drive seam:** `MusicSource.ensureLocal(track) → fileName`. `LocalFileSource` returns the name as-is; a future `GoogleDriveSource` downloads into `Library/Music` first. The player calls `ensureLocal` before every load and never knows where bytes came from.

**Skins:** every visual token is a CSS variable in `src/app/globals.css` (the "skin contract"). Playback logic never touches the DOM.

## Build & run

```bash
npm install
npm run sync          # next build → out/ → copied into ios/App, plugin Package.swift regenerated
npx cap open ios      # Xcode: pick your team under Signing, select your iPhone, ⌘R
```

Any change under `src/` needs `npm run sync` then ⌘R. Changes under `plugins/audio-engine` only need ⌘R.

`next.config.ts` uses `output: 'export'`: the phone runs static files; any future server code in this repo deploys separately and is called over HTTPS.

## V1 milestone checklist

1. Import one MP3 → appears in Songs
2. Tap → hear music
3. Lock phone → keeps playing
4. Lock Screen shows title/artist/art, play/pause/next/prev/scrub work
5. Kill app, relaunch → library and last track/position restored

## Deferred (architected for, not built)

Google Drive · download management · 10-band EQ · visualizer/FFT · skins · playlists · crossfade · gapless · ReplayGain · CarPlay · lyrics · AirPlay
