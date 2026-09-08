import Foundation
import AVFoundation

/// Pulls the audio track out of a video and writes it as an M4A (AAC).
/// iOS ships an AAC encoder but no MP3 encoder, which is why the output is .m4a.
enum AudioExporter {
    static func exportAudio(from sourcePath: String, title: String, artist: String?, album: String?, recordedAt: String?) async throws -> URL {
        let source: URL
        if sourcePath.hasPrefix("file://"), let u = URL(string: sourcePath) {
            source = u
        } else {
            let raw = sourcePath.replacingOccurrences(of: "file://", with: "")
            source = URL(fileURLWithPath: raw.removingPercentEncoding ?? raw)
        }

        let asset = AVURLAsset(url: source)
        guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            throw NSError(domain: "AudioExporter", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "This video has no exportable audio track"])
        }

        let dir = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let safeTitle = title.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: ".")
        let dest = dir.appendingPathComponent("\(safeTitle).m4a")

        // Write real tags into the file so Drive, the importer, and any other player agree on them.
        func tag(_ id: AVMetadataIdentifier, _ value: String?) -> AVMutableMetadataItem? {
            guard let value, !value.isEmpty else { return nil }
            let item = AVMutableMetadataItem()
            item.identifier = id
            item.value = value as NSString
            item.extendedLanguageTag = "und"
            return item
        }
        export.metadata = [
            tag(.commonIdentifierTitle, title),
            tag(.commonIdentifierArtist, artist),
            tag(.commonIdentifierAlbumName, album),
            tag(.commonIdentifierCreationDate, recordedAt),
        ].compactMap { $0 }

        export.outputURL = dest
        export.outputFileType = .m4a
        await export.export()
        if let error = export.error { throw error }
        guard export.status == .completed else {
            throw NSError(domain: "AudioExporter", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Export did not complete (status \(export.status.rawValue))"])
        }
        return dest
    }
}
