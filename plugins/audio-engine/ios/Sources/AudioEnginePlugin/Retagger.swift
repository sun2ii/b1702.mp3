import Foundation
import AVFoundation
import UIKit

/// Rewrites tags (and optionally cover art) on a file already in Library/Music.
///
/// M4A: AVAssetExportSession in *passthrough* mode copies the audio untouched and writes new
/// metadata atoms — no re-encode, so no quality loss. MP3: AVFoundation cannot write ID3 tags,
/// so the library index is the source of truth for those and the file is left as-is.
enum Retagger {
    struct Result { let retagged: Bool; let artworkFileName: String? }

    static func retag(fileName: String, title: String, artist: String, album: String,
                      artworkSourcePath: String?, artworkFileName: String?) async throws -> Result {
        let fm = FileManager.default
        let file = AudioEngine.musicDir.appendingPathComponent(fileName)
        guard fm.fileExists(atPath: file.path) else {
            throw NSError(domain: "Retagger", code: 1, userInfo: [NSLocalizedDescriptionKey: "File not on this phone"])
        }

        // 1. New cover (if any): normalize to a ≤1000px JPEG in Library/Artwork.
        var artName = artworkFileName
        if let src = artworkSourcePath {
            let url = src.hasPrefix("file://") ? URL(string: src)! : URL(fileURLWithPath: src)
            guard let img = UIImage(contentsOfFile: url.path) else {
                throw NSError(domain: "Retagger", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not read image"])
            }
            let jpeg = resized(img, maxSide: 1000).jpegData(compressionQuality: 0.88)!
            let name = "\(UUID().uuidString).jpg"
            try jpeg.write(to: AudioEngine.artworkDir.appendingPathComponent(name))
            artName = name
        }

        // 2. MP3: tags live in library.json only.
        guard file.pathExtension.lowercased() == "m4a" else {
            return Result(retagged: false, artworkFileName: artName)
        }

        // 3. M4A: passthrough export with fresh metadata, then swap the file in place.
        let asset = AVURLAsset(url: file)
        guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else {
            throw NSError(domain: "Retagger", code: 3, userInfo: [NSLocalizedDescriptionKey: "Cannot open file for tagging"])
        }
        func tag(_ id: AVMetadataIdentifier, _ value: String) -> AVMutableMetadataItem {
            let item = AVMutableMetadataItem()
            item.identifier = id; item.value = value as NSString; item.extendedLanguageTag = "und"
            return item
        }
        var metadata = [tag(.commonIdentifierTitle, title), tag(.commonIdentifierArtist, artist), tag(.commonIdentifierAlbumName, album)]
        // Keep the original recording date if the file had one.
        if let existing = try? await asset.load(.commonMetadata),
           let date = AVMetadataItem.metadataItems(from: existing, filteredByIdentifier: .commonIdentifierCreationDate).first,
           let s = try? await date.load(.stringValue) {
            metadata.append(tag(.commonIdentifierCreationDate, s))
        }
        let artURL = artName.map { AudioEngine.artworkDir.appendingPathComponent($0) } ?? AudioEngine.defaultArtwork
        if let art = try? Data(contentsOf: artURL) {
            let item = AVMutableMetadataItem()
            item.identifier = .commonIdentifierArtwork; item.value = art as NSData
            item.dataType = kCMMetadataBaseDataType_JPEG as String; item.extendedLanguageTag = "und"
            metadata.append(item)
        }

        let tmp = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("\(UUID().uuidString).m4a")
        export.metadata = metadata
        export.outputURL = tmp
        export.outputFileType = .m4a
        await export.export()
        if let error = export.error { throw error }
        guard export.status == .completed else {
            throw NSError(domain: "Retagger", code: 4, userInfo: [NSLocalizedDescriptionKey: "Tag write did not complete"])
        }
        _ = try fm.replaceItemAt(file, withItemAt: tmp)
        return Result(retagged: true, artworkFileName: artName)
    }

    static func deleteFiles(fileName: String?, artworkFileName: String?) {
        let fm = FileManager.default
        if let f = fileName, !f.isEmpty { try? fm.removeItem(at: AudioEngine.musicDir.appendingPathComponent(f)) }
        if let a = artworkFileName, a != "_default.jpg" { try? fm.removeItem(at: AudioEngine.artworkDir.appendingPathComponent(a)) }
    }

    private static func resized(_ img: UIImage, maxSide: CGFloat) -> UIImage {
        let scale = min(1, maxSide / max(img.size.width, img.size.height))
        if scale >= 1 { return img }
        let size = CGSize(width: img.size.width * scale, height: img.size.height * scale)
        return UIGraphicsImageRenderer(size: size).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
    }
}
