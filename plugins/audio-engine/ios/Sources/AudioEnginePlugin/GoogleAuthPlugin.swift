import Foundation
import Capacitor
import AuthenticationServices
import CryptoKit
import Security

/// Google sign-in without Google's SDK: standard OAuth 2.0 "Authorization Code + PKCE",
/// which is exactly what Google prescribes for iOS apps.
///
///   signIn()        -> system browser sheet -> Google -> redirect back with a code
///                      -> exchange code for access + refresh tokens -> refresh token into Keychain
///   getAccessToken() -> cached token if still valid, else silently refresh via the refresh token
///
/// iOS-type OAuth clients have no client secret, so nothing sensitive ships in the app.
@objc(GoogleAuthPlugin)
public class GoogleAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GoogleAuthPlugin"
    public let jsName = "GoogleAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAccessToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signOut", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isSignedIn", returnType: CAPPluginReturnPromise),
    ]

    private var session: ASWebAuthenticationSession?
    private let presenter = PresentationProvider()

    // In-memory access token cache (access tokens live ~1h; only the refresh token is persisted).
    private var accessToken: String?
    private var accessTokenExpiry: Date = .distantPast

    // MARK: - JS methods

    @objc func isSignedIn(_ call: CAPPluginCall) {
        call.resolve(["signedIn": Keychain.read(.refreshToken) != nil])
    }

    @objc func signOut(_ call: CAPPluginCall) {
        Keychain.delete(.refreshToken)
        Keychain.delete(.clientId)
        accessToken = nil
        accessTokenExpiry = .distantPast
        call.resolve()
    }

    @objc func signIn(_ call: CAPPluginCall) {
        guard let clientId = call.getString("clientId"), !clientId.isEmpty else {
            call.reject("clientId is required"); return
        }
        let scopes = call.getArray("scopes", String.self) ?? ["https://www.googleapis.com/auth/drive.readonly"]

        // Google's iOS redirect scheme is the client ID reversed: "com.googleusercontent.apps.<id>".
        let scheme = Self.redirectScheme(for: clientId)
        let redirectUri = "\(scheme):/oauthredirect"

        let verifier = Self.randomURLSafe(bytes: 32)
        let challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))

        var comps = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        comps.queryItems = [
            .init(name: "client_id", value: clientId),
            .init(name: "redirect_uri", value: redirectUri),
            .init(name: "response_type", value: "code"),
            .init(name: "scope", value: scopes.joined(separator: " ")),
            .init(name: "code_challenge", value: challenge),
            .init(name: "code_challenge_method", value: "S256"),
            .init(name: "access_type", value: "offline"),
        ]

        DispatchQueue.main.async {
            let s = ASWebAuthenticationSession(url: comps.url!, callbackURLScheme: scheme) { [weak self] url, error in
                guard let self else { return }
                if let error {
                    call.reject("Sign-in cancelled: \(error.localizedDescription)"); return
                }
                guard let url,
                      let code = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                        .queryItems?.first(where: { $0.name == "code" })?.value else {
                    call.reject("No authorization code in redirect"); return
                }
                Task {
                    do {
                        let tokens = try await self.exchange(form: [
                            "client_id": clientId,
                            "code": code,
                            "code_verifier": verifier,
                            "grant_type": "authorization_code",
                            "redirect_uri": redirectUri,
                        ])
                        guard let refresh = tokens["refresh_token"] as? String else {
                            call.reject("Google did not return a refresh token"); return
                        }
                        Keychain.write(.refreshToken, refresh)
                        Keychain.write(.clientId, clientId)
                        self.cache(tokens)
                        call.resolve(["accessToken": self.accessToken ?? ""])
                    } catch {
                        call.reject("Token exchange failed: \(error.localizedDescription)")
                    }
                }
            }
            // Share cookies with Safari so an already-signed-in Google account is offered.
            s.prefersEphemeralWebBrowserSession = false
            s.presentationContextProvider = self.presenter
            self.session = s
            s.start()
        }
    }

    @objc func getAccessToken(_ call: CAPPluginCall) {
        if let t = accessToken, accessTokenExpiry > Date().addingTimeInterval(60) {
            call.resolve(["accessToken": t]); return
        }
        guard let refresh = Keychain.read(.refreshToken), let clientId = Keychain.read(.clientId) else {
            call.reject("Not signed in"); return
        }
        Task {
            do {
                let tokens = try await exchange(form: [
                    "client_id": clientId,
                    "refresh_token": refresh,
                    "grant_type": "refresh_token",
                ])
                cache(tokens)
                call.resolve(["accessToken": accessToken ?? ""])
            } catch {
                call.reject("Token refresh failed: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Token endpoint

    private func exchange(form: [String: String]) async throws -> [String: Any] {
        var req = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = form.map { "\($0.key)=\(Self.formEncode($0.value))" }.joined(separator: "&").data(using: .utf8)
        let (data, resp) = try await URLSession.shared.data(for: req)
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else {
            let desc = json["error_description"] as? String ?? json["error"] as? String ?? "HTTP error"
            throw NSError(domain: "GoogleAuth", code: 1, userInfo: [NSLocalizedDescriptionKey: desc])
        }
        return json
    }

    private func cache(_ tokens: [String: Any]) {
        accessToken = tokens["access_token"] as? String
        let ttl = (tokens["expires_in"] as? Double) ?? 3600
        accessTokenExpiry = Date().addingTimeInterval(ttl)
    }

    // MARK: - Helpers

    static func redirectScheme(for clientId: String) -> String {
        // "123-abc.apps.googleusercontent.com" -> "com.googleusercontent.apps.123-abc"
        clientId.split(separator: ".").reversed().joined(separator: ".")
    }

    private static func randomURLSafe(bytes: Int) -> String {
        var b = [UInt8](repeating: 0, count: bytes)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes, &b)
        return base64URL(Data(b))
    }

    private static func base64URL(_ d: Data) -> String {
        d.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func formEncode(_ s: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }
}

/// ASWebAuthenticationSession needs a window to present its sheet from.
private final class PresentationProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap { $0.windows }.first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}

/// Minimal Keychain wrapper: the refresh token is a long-lived credential and does not belong in UserDefaults.
enum Keychain {
    enum Key: String { case refreshToken = "google.refreshToken", clientId = "google.clientId" }
    private static let service = "binary1702.winamp.google"

    static func write(_ key: Key, _ value: String) {
        delete(key)
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemAdd(q as CFDictionary, nil)
    }

    static func read(_ key: Key) -> String? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    static func delete(_ key: Key) {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
        ]
        SecItemDelete(q as CFDictionary)
    }
}
