import Foundation

/// Downloads a remote file into a temp folder so the existing TrackImporter can treat it
/// exactly like a file picked from the Files app. This is the native half of GoogleDriveSource.
enum Downloader {
    static func download(url: URL, authorization: String?, fileName: String) async throws -> URL {
        var req = URLRequest(url: url)
        if let authorization { req.setValue(authorization, forHTTPHeaderField: "Authorization") }

        // URLSession streams to disk; the file never sits in memory (matters for large FLAC/WAV later).
        let (tmp, resp) = try await URLSession.shared.download(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
            throw NSError(domain: "Downloader", code: code,
                          userInfo: [NSLocalizedDescriptionKey: "Download failed (HTTP \(code))"])
        }

        let dir = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appendingPathComponent(fileName)
        try FileManager.default.moveItem(at: tmp, to: dest)
        return dest
    }
}

/// Uploads a file from Library/Music to a URL (Drive resumable-upload session URI).
/// URLSession reads straight from disk, so large files never sit in memory.
enum Uploader {
    static func upload(fileName: String, to url: URL, method: String, contentType: String,
                       authorization: String?) async throws -> [String: Any] {
        let file = AudioEngine.musicDir.appendingPathComponent(fileName)
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue(contentType, forHTTPHeaderField: "Content-Type")
        if let authorization { req.setValue(authorization, forHTTPHeaderField: "Authorization") }
        let (data, resp) = try await URLSession.shared.upload(for: req, fromFile: file)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
            throw NSError(domain: "Uploader", code: code,
                          userInfo: [NSLocalizedDescriptionKey: "Upload failed (HTTP \(code))"])
        }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }
}
