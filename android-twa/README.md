# ARHIDOM Android TWA

This project packages `https://www.remhaos.com/` as a Trusted Web Activity for Android stores.

## Release identity

- Package ID: `com.remhaos.app`
- Version: `1.0.0` (`versionCode` 1)
- Target and compile SDK: 35
- Notifications, geolocation, and billing: disabled

## Local verification

Use JDK 17 and an Android SDK containing platform/build-tools 35, then run:

```sh
./gradlew lintRelease assembleRelease bundleRelease
```

The generated APK and AAB are intentionally unsigned. Production signing keys, passwords, and Gradle signing properties must be stored outside the repository.

Before a RuStore release, sign the selected artifact with the long-lived production certificate and publish that certificate's SHA-256 fingerprint in `https://www.remhaos.com/.well-known/assetlinks.json` for package `com.remhaos.app`. The package ID, signing certificate, and Digital Asset Links entry must match or the app will fall back to a Custom Tab with browser chrome.
