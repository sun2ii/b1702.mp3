import Foundation
import AVFoundation

/// Pulls the audio track out of a video and writes it as an M4A (AAC).
/// iOS ships an AAC encoder but no MP3 encoder, which is why the output is .m4a.
enum AudioExporter {
    static func exportAudio(from sourcePath: String, title: String) async throws -> URL {
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

        // Write a title tag so the importer (and Drive) see a real name instead of IMG_1234.
        let titleItem = AVMutableMetadataItem()
        titleItem.identifier = .commonIdentifierTitle
        titleItem.value = title as NSString
        export.metadata = [titleItem]

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
