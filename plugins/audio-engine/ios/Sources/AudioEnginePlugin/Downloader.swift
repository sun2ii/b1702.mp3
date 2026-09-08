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
