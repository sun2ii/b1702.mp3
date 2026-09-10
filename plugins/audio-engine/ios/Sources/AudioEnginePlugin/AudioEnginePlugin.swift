import Foundation
import Capacitor

/// The Capacitor bridge. Translates JS calls <-> the AudioEngine and forwards engine
/// events to JS listeners. Deliberately thin: no logic lives here.
@objc(AudioEnginePlugin)
public class AudioEnginePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AudioEnginePlugin"
    public let jsName = "AudioEngine"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "importFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadTrack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seek", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloadFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "uploadFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "retag", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteFiles", returnType: CAPPluginReturnPromise),
    ]

    private let engine = AudioEngine()

    override public func load() {
        engine.onEvent = { [weak self] name, data in
            self?.notifyListeners(name, data: data)
        }
        engine.setup()
    }

    @objc func importFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("path is required"); return
        }
        Task {
            do {
                let track = try await TrackImporter.importFile(sourcePath: path)
                call.resolve(track)
            } catch {
                call.reject("Import failed: \(error.localizedDescription)")
            }
        }
    }

    @objc func downloadFile(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString),
              let fileName = call.getString("fileName") else {
            call.reject("url and fileName are required"); return
        }
        let auth = call.getString("authorization")
        Task {
            do {
                let dest = try await Downloader.download(url: url, authorization: auth, fileName: fileName)
                call.resolve(["path": dest.absoluteString])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func uploadFile(_ call: CAPPluginCall) {
        guard let fileName = call.getString("fileName"),
              let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("fileName and url are required"); return
        }
        let method = call.getString("method") ?? "PUT"
        let contentType = call.getString("contentType") ?? "application/octet-stream"
        let auth = call.getString("authorization")
        Task {
            do {
                let json = try await Uploader.upload(fileName: fileName, to: url, method: method,
                                                     contentType: contentType, authorization: auth)
                call.resolve(json)
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func exportAudio(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else { call.reject("path is required"); return }
        let title = call.getString("title") ?? "Recording"
        Task {
            do {
                let dest = try await AudioExporter.exportAudio(
                    from: path, title: title,
                    artist: call.getString("artist"), album: call.getString("album"),
                    recordedAt: call.getString("recordedAt"))
                call.resolve(["path": dest.absoluteString])
            } catch {
                call.reject("Audio export failed: \(error.localizedDescription)")
            }
        }
    }

    @objc func retag(_ call: CAPPluginCall) {
        guard let fileName = call.getString("fileName") else { call.reject("fileName is required"); return }
        Task {
            do {
                let r = try await Retagger.retag(
                    fileName: fileName,
                    title: call.getString("title") ?? "", artist: call.getString("artist") ?? "",
                    album: call.getString("album") ?? "",
                    artworkSourcePath: call.getString("artworkSourcePath"),
                    artworkFileName: call.getString("artworkFileName"))
                var out: [String: Any] = ["retagged": r.retagged]
                if let a = r.artworkFileName { out["artworkFileName"] = a }
                call.resolve(out)
            } catch {
                call.reject("Tag update failed: \(error.localizedDescription)")
            }
        }
    }

    @objc func deleteFiles(_ call: CAPPluginCall) {
        Retagger.deleteFiles(fileName: call.getString("fileName"), artworkFileName: call.getString("artworkFileName"))
        call.resolve()
    }

    @objc func loadTrack(_ call: CAPPluginCall) {
        guard let fileName = call.getString("fileName") else {
            call.reject("fileName is required"); return
        }
        let meta = NowPlayingMeta(
            title: call.getString("title") ?? fileName,
            artist: call.getString("artist") ?? "",
            album: call.getString("album") ?? "",
            artworkFileName: call.getString("artworkFileName"),
            duration: call.getDouble("duration") ?? 0
        )
        DispatchQueue.main.async {
            self.engine.load(fileName: fileName, meta: meta)
            call.resolve(self.engine.stateDict)
        }
    }

    @objc func play(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.engine.play(); call.resolve(self.engine.stateDict) }
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.engine.pause(); call.resolve(self.engine.stateDict) }
    }

    @objc func seek(_ call: CAPPluginCall) {
        let position = call.getDouble("position") ?? 0
        DispatchQueue.main.async {
            self.engine.seek(to: position) { call.resolve(self.engine.stateDict) }
        }
    }

    @objc func getState(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(self.engine.stateDict) }
    }
}
