import Foundation
import AVFoundation
import UIKit

/// Copies an audio file the user picked into our private Music directory and reads its tags.
/// This is the native half of `LocalFileSource`. Everything it returns is plain JSON.
enum TrackImporter {

    struct ImportError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    static func importFile(sourcePath: String) async throws -> [String: Any] {
        // The Files picker hands us either "file:///..." or a bare path.
        let source: URL
        if sourcePath.hasPrefix("file://"), let u = URL(string: sourcePath) {
            source = u
        } else {
            let raw = sourcePath.replacingOccurrences(of: "file://", with: "")
            source = URL(fileURLWithPath: raw.removingPercentEncoding ?? raw)
        }

        // Files picked from other apps/iCloud are security-scoped; without this call
        // the copy fails with permission denied.
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }

        let fm = FileManager.default
        try fm.createDirectory(at: AudioEngine.musicDir, withIntermediateDirectories: true)
        try fm.createDirectory(at: AudioEngine.artworkDir, withIntermediateDirectories: true)

        // 1. Copy into Library/Music, de-duplicating names.
        let originalName = source.lastPathComponent
        let ext = source.pathExtension.lowercased()
        var fileName = sanitize(originalName)
        var dest = AudioEngine.musicDir.appendingPathComponent(fileName)
        var n = 2
        while fm.fileExists(atPath: dest.path) {
            let stem = (sanitize(originalName) as NSString).deletingPathExtension
            fileName = "\(stem) (\(n)).\(ext)"
            dest = AudioEngine.musicDir.appendingPathComponent(fileName)
            n += 1
        }
        try fm.copyItem(at: source, to: dest)
        // The picker gave us a temp copy; don't let 2 TB of temp copies pile up.
        if source.path.contains("/tmp/") { try? fm.removeItem(at: source) }

        // 2. Read tags. AVAsset understands ID3 (mp3) and iTunes atoms (m4a) uniformly
        //    through "common" metadata; track number is format-specific so we check both.
        let asset = AVURLAsset(url: dest)
        let id = UUID().uuidString
        var result: [String: Any] = [
            "id": id,
            "fileName": fileName,
            "fileType": ext,
            "title": (originalName as NSString).deletingPathExtension,  // fallback
            "artist": "Unknown Artist",
            "album": "Unknown Album",
            "duration": 0.0,
            "addedAt": ISO8601DateFormatter().string(from: Date()),
        ]

        do {
            let (common, all, duration) = try await asset.load(.commonMetadata, .metadata, .duration)
            if duration.seconds.isFinite { result["duration"] = duration.seconds }

            if let v = await string(common, .commonIdentifierTitle), !v.isEmpty { result["title"] = v }
            if let v = await string(common, .commonIdentifierArtist), !v.isEmpty { result["artist"] = v }
            if let v = await string(common, .commonIdentifierAlbumName), !v.isEmpty { result["album"] = v }

            if let track = await trackNumber(all) { result["trackNumber"] = track }
            if let v = await string(common, .commonIdentifierCreationDate), !v.isEmpty { result["recordedAt"] = v }

            if let artItem = AVMetadataItem.metadataItems(from: common, filteredByIdentifier: .commonIdentifierArtwork).first,
               let data = try? await artItem.load(.dataValue),
               let image = UIImage(data: data),
               let jpeg = image.jpegData(compressionQuality: 0.85) {
                let artName = "\(id).jpg"
                try? jpeg.write(to: AudioEngine.artworkDir.appendingPathComponent(artName))
                result["artworkFileName"] = artName
            }
        } catch {
            // Unreadable tags are not fatal: the file still plays, with filename as title.
        }

        return result
    }

    // MARK: - Helpers

    private static func string(_ items: [AVMetadataItem], _ id: AVMetadataIdentifier) async -> String? {
        guard let item = AVMetadataItem.metadataItems(from: items, filteredByIdentifier: id).first else { return nil }
        return try? await item.load(.stringValue)
    }

    /// ID3 stores "3/12" as text; iTunes/M4A stores a binary blob [0,0,track,track,total,total,0,0].
    private static func trackNumber(_ items: [AVMetadataItem]) async -> Int? {
        if let item = AVMetadataItem.metadataItems(from: items, filteredByIdentifier: .id3MetadataTrackNumber).first,
           let s = try? await item.load(.stringValue),
           let n = Int(s.split(separator: "/").first ?? "") { return n }
        if let item = AVMetadataItem.metadataItems(from: items, filteredByIdentifier: .iTunesMetadataTrackNumber).first,
           let d = try? await item.load(.dataValue), d.count >= 4 {
            return Int(d[2]) << 8 | Int(d[3])
        }
        return nil
    }

    private static func sanitize(_ name: String) -> String {
        name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
    }
}
