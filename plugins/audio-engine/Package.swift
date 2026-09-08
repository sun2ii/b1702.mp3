// swift-tools-version: 5.9
import PackageDescription

// Package/product name must be "WinampAudioEngine": Capacitor derives it from the
// npm package name "winamp-audio-engine" when it generates ios/App/CapApp-SPM/Package.swift.
let package = Package(
    name: "WinampAudioEngine",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "WinampAudioEngine", targets: ["AudioEnginePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "AudioEnginePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/AudioEnginePlugin")
    ]
)
