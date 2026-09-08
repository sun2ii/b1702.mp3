import Foundation
import Capacitor
import CryptoKit
import Security

/// Google auth without any sign-in: a Service Account.
///
/// The app holds the service account's private key. To get an access token it builds a JWT
/// ("I am <robot>, acting as <ben@binary1702.com>, I want Drive"), signs it with the key,
/// and trades it at Google's token endpoint for a 1-hour access token. No browser, no user.
///
///   JWT = base64url(header) . base64url(claims) . base64url( RSA-SHA256( header.claims ) )
///
/// "Acting as" (the `sub` claim) is domain-wide delegation: files end up owned by the real user.
@objc(GoogleAuthPlugin)
public class GoogleAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GoogleAuthPlugin"
    public let jsName = "GoogleAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getAccessToken", returnType: CAPPluginReturnPromise),
    ]

    // Access tokens live ~1h; cache in memory and refresh a minute early.
    private var accessToken: String?
    private var accessTokenExpiry: Date = .distantPast

    @objc func getAccessToken(_ call: CAPPluginCall) {
        if let t = accessToken, accessTokenExpiry > Date().addingTimeInterval(60) {
            call.resolve(["accessToken": t]); return
        }
        guard let clientEmail = call.getString("clientEmail"),
              let privateKeyPem = call.getString("privateKey"),
              !clientEmail.isEmpty, !privateKeyPem.isEmpty else {
            call.reject("Service account not configured (clientEmail / privateKey missing)"); return
        }
        let subject = call.getString("subject")            // user to impersonate (domain-wide delegation)
        let scopes = call.getArray("scopes", String.self) ?? ["https://www.googleapis.com/auth/drive"]

        Task {
            do {
                let jwt = try Self.makeJWT(clientEmail: clientEmail, subject: subject,
                                           scopes: scopes, privateKeyPem: privateKeyPem)
                let tokens = try await Self.exchange(jwt: jwt)
                accessToken = tokens["access_token"] as? String
                let ttl = (tokens["expires_in"] as? Double) ?? 3600
                accessTokenExpiry = Date().addingTimeInterval(ttl)
                call.resolve(["accessToken": accessToken ?? ""])
            } catch {
                call.reject("Service account auth failed: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - JWT

    private static func makeJWT(clientEmail: String, subject: String?, scopes: [String], privateKeyPem: String) throws -> String {
        let now = Int(Date().timeIntervalSince1970)
        var claims: [String: Any] = [
            "iss": clientEmail,
            "scope": scopes.joined(separator: " "),
            "aud": "https://oauth2.googleapis.com/token",
            "iat": now,
            "exp": now + 3600,
        ]
        if let subject, !subject.isEmpty { claims["sub"] = subject }

        let header = try JSONSerialization.data(withJSONObject: ["alg": "RS256", "typ": "JWT"])
        let payload = try JSONSerialization.data(withJSONObject: claims)
        let signingInput = "\(base64URL(header)).\(base64URL(payload))"

        let key = try loadRSAPrivateKey(pem: privateKeyPem)
        var err: Unmanaged<CFError>?
        guard let sig = SecKeyCreateSignature(key, .rsaSignatureMessagePKCS1v15SHA256,
                                              Data(signingInput.utf8) as CFData, &err) as Data? else {
            throw err?.takeRetainedValue() ?? NSError(domain: "GoogleAuth", code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Could not sign JWT"])
        }
        return "\(signingInput).\(base64URL(sig))"
    }

    /// Google's key file is PEM "PRIVATE KEY" = PKCS#8. Security.framework wants PKCS#1,
    /// which is the same bytes minus a fixed 26-byte PKCS#8 wrapper for 2048-bit RSA keys.
    private static func loadRSAPrivateKey(pem: String) throws -> SecKey {
        let body = pem
            .components(separatedBy: "\n")
            .filter { !$0.hasPrefix("-----") }
            .joined()
            .replacingOccurrences(of: "\\n", with: "")
            .replacingOccurrences(of: " ", with: "")
        guard var der = Data(base64Encoded: body) else {
            throw NSError(domain: "GoogleAuth", code: 3, userInfo: [NSLocalizedDescriptionKey: "Private key is not valid base64"])
        }
        if der.count > 26, der[0] == 0x30, der[4] == 0x02, der[5] == 0x01, der[6] == 0x00 {
            der = der.subdata(in: 26..<der.count)   // strip PKCS#8 header -> PKCS#1
        }
        let attrs: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
            kSecAttrKeySizeInBits as String: 2048,
        ]
        var err: Unmanaged<CFError>?
        guard let key = SecKeyCreateWithData(der as CFData, attrs as CFDictionary, &err) else {
            throw err?.takeRetainedValue() ?? NSError(domain: "GoogleAuth", code: 4,
                userInfo: [NSLocalizedDescriptionKey: "Could not parse private key"])
        }
        return key
    }

    // MARK: - Token endpoint

    private static func exchange(jwt: String) async throws -> [String: Any] {
        var req = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=\(jwt)".data(using: .utf8)
        let (data, resp) = try await URLSession.shared.data(for: req)
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else {
            let desc = json["error_description"] as? String ?? json["error"] as? String ?? "HTTP error"
            throw NSError(domain: "GoogleAuth", code: 1, userInfo: [NSLocalizedDescriptionKey: desc])
        }
        return json
    }

    private static func base64URL(_ d: Data) -> String {
        d.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
