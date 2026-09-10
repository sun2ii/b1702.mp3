import Foundation
import AVFoundation
import MediaPlayer
import UIKit

/// Metadata the engine needs to show a track on the Lock Screen / Control Center.
struct NowPlayingMeta {
    let title: String
    let artist: String
    let album: String
    let artworkFileName: String?
    let duration: Double
}

/// The audio engine. Owns exactly one AVPlayer and everything iOS needs to keep it
/// alive in the background: the audio session, Now Playing info, and remote commands.
///
/// It knows nothing about the library or the queue. The web layer decides *what* plays;
/// this class decides *how*. That boundary is what makes skins / EQ / visualizer possible later.
final class AudioEngine {

    // MARK: - Storage locations (relative-path contract with the web layer)
    //
    // iOS moves the app container to a new UUID path on reinstall/update, so we never
    // persist absolute paths. The library stores file *names*; the engine resolves them here.

    static var libraryDir: URL {
        FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
    }
    static var musicDir: URL { libraryDir.appendingPathComponent("Music", isDirectory: true) }
    static var artworkDir: URL { libraryDir.appendingPathComponent("Artwork", isDirectory: true) }
    /// Written by the web layer on boot from the bundled cover; used wherever a track has no art.
    static var defaultArtwork: URL { artworkDir.appendingPathComponent("_default.jpg") }

    // MARK: - State

    private let player = AVPlayer()
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var meta: NowPlayingMeta?

    /// Events flow out to JS through this closure ("state", "ended", "remote").
    var onEvent: (String, [String: Any]) -> Void = { _, _ in }

    var isPlaying: Bool { player.rate > 0 }
    var position: Double {
        let t = player.currentTime().seconds
        return t.isFinite ? t : 0
    }
    var duration: Double {
        let d = player.currentItem?.duration.seconds ?? 0
        return d.isFinite ? d : 0
    }
    var stateDict: [String: Any] {
        ["playing": isPlaying, "position": position, "duration": duration]
    }

    // MARK: - Setup

    func setup() {
        try? FileManager.default.createDirectory(at: Self.musicDir, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: Self.artworkDir, withIntermediateDirectories: true)
        // Drive is the master copy; the phone is a cache. Keep the cache out of iCloud backups.
        for dir in [Self.musicDir, Self.artworkDir] {
            var u = dir
            var rv = URLResourceValues()
            rv.isExcludedFromBackup = true
            try? u.setResourceValues(rv)
        }

        // (1) Audio session: `.playback` is what tells iOS "this app is a music player";
        //     combined with the `audio` UIBackgroundMode it keeps us alive when locked.
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default)
        try? session.setActive(true)

        player.automaticallyWaitsToMinimizeStalling = false

        // (2) Progress ticks to JS twice a second while an item is loaded.
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 600),
            queue: .main
        ) { [weak self] _ in
            guard let self, self.player.currentItem != nil else { return }
            self.onEvent("state", self.stateDict)
        }

        setupRemoteCommands()
        observeInterruptions()
    }

    // MARK: - Transport

    func load(fileName: String, meta: NowPlayingMeta) {
        let url = Self.musicDir.appendingPathComponent(fileName)
        let item = AVPlayerItem(url: url)

        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in
            self?.onEvent("ended", [:])
        }

        player.replaceCurrentItem(with: item)
        self.meta = meta
        publishNowPlaying()
        onEvent("state", stateDict)
    }

    func play() {
        try? AVAudioSession.sharedInstance().setActive(true)
        player.play()
        publishNowPlaying()
        onEvent("state", stateDict)
    }

    func pause() {
        player.pause()
        publishNowPlaying()
        onEvent("state", stateDict)
    }

    func seek(to seconds: Double, completion: (() -> Void)? = nil) {
        let target = CMTime(seconds: max(0, seconds), preferredTimescale: 600)
        player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            guard let self else { return }
            self.publishNowPlaying()
            self.onEvent("state", self.stateDict)
            completion?()
        }
    }

    // MARK: - Lock Screen / Control Center

    /// MPNowPlayingInfoCenter is a *snapshot*: iOS extrapolates the progress bar from
    /// elapsed time + rate, so we only need to republish on load/play/pause/seek.
    private func publishNowPlaying() {
        guard let meta else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }
        // Use metadata duration (known upfront) since AVPlayer duration may not be ready yet
        let dur = meta.duration > 0 ? meta.duration : duration
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: meta.title,
            MPMediaItemPropertyArtist: meta.artist,
            MPMediaItemPropertyAlbumTitle: meta.album,
            MPMediaItemPropertyPlaybackDuration: dur,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
        ]
        let artPath = meta.artworkFileName.map { Self.artworkDir.appendingPathComponent($0).path } ?? Self.defaultArtwork.path
        if let image = UIImage(contentsOfFile: artPath) ?? UIImage(contentsOfFile: Self.defaultArtwork.path) {
            info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    /// Play/pause/seek are handled natively for instant response. Next/previous need the
    /// queue, which lives in JS, so those are forwarded as "remote" events.
    private func setupRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.addTarget { [weak self] _ in self?.play(); return .success }
        center.pauseCommand.addTarget { [weak self] _ in self?.pause(); return .success }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            self.isPlaying ? self.pause() : self.play()
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let e = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.seek(to: e.positionTime)
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            self?.onEvent("remote", ["command": "next"]); return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            self?.onEvent("remote", ["command": "previous"]); return .success
        }
    }

    /// Phone call / Siri / another app grabbing audio. Resume only if iOS says we should.
    private func observeInterruptions() {
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] note in
            guard let self,
                  let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            switch type {
            case .began:
                self.onEvent("state", self.stateDict)
            case .ended:
                let opts = AVAudioSession.InterruptionOptions(
                    rawValue: note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
                if opts.contains(.shouldResume) { self.play() }
            @unknown default: break
            }
        }
    }
}
