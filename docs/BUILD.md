# Build guide

These are the commands for building the mobile app (Expo / React Native) and the web app (Vite + React), in debug and release mode.

Install dependencies once from the repo root. The repo uses npm workspaces for `packages/*`, `mobile`, and `web`:

```powershell
npm install
```

## Mobile (Android)

### Prerequisites

- Node.js 20+
- Android Studio with the Android SDK, an emulator or a USB device with debugging enabled
- JDK 17. Android Studio's bundled JBR works; set `JAVA_HOME` to it if Gradle can't find Java.

### Debug

Start the dev server and build/install on a connected device or emulator:

```powershell
cd mobile
npm start          # Expo dev server (press a / i / w)
npm run android    # expo run:android: builds the debug APK, installs it, and starts Metro
```

To build a debug APK without installing it:

```powershell
cd mobile\android
.\gradlew.bat assembleDebug
```

Output: `mobile\android\app\build\outputs\apk\debug\app-debug.apk`

A debug APK loads JavaScript from Metro, so run `npm start` in `mobile\` while you use it.

### Release

Build the release variant and install it on a connected device:

```powershell
cd mobile
npx expo run:android --variant release
```

Build a standalone release APK, with the JS bundle embedded and no Metro needed:

```powershell
cd mobile\android
.\gradlew.bat assembleRelease
```

Output: `mobile\android\app\build\outputs\apk\release\app-release.apk`

Build an Android App Bundle for the Play Store:

```powershell
cd mobile\android
.\gradlew.bat bundleRelease
```

Output: `mobile\android\app\build\outputs\bundle\release\app-release.aab`

Install a built APK manually:

```powershell
adb install -r mobile\android\app\build\outputs\apk\release\app-release.apk
```

> [!IMPORTANT]
> `mobile/android/app/build.gradle` currently signs the `release` build with the **debug keystore**. That's fine for sideloading. Before you publish to the Play Store, generate your own upload keystore and wire it into `signingConfigs.release` (see [Signed APK (React Native)](https://reactnative.dev/docs/signed-apk-android)). Don't commit the keystore or its passwords.

### Useful Gradle tasks

```powershell
cd mobile\android
.\gradlew.bat clean               # clear native build outputs
.\gradlew.bat installDebug        # build + install debug APK
.\gradlew.bat installRelease      # build + install release APK
```

### Regenerating the native project

If you change `app.json`, native config, or Expo plugins, regenerate `mobile/android` before you build:

```powershell
cd mobile
npx expo prebuild --platform android          # add --clean to recreate from scratch
```

## Mobile (iOS)

### Debug (macOS + Xcode)

```powershell
cd mobile
npm run ios                                    # expo run:ios (simulator)
```

### Release (macOS + Xcode)

```powershell
cd mobile
npx expo run:ios --configuration Release
```

### Without a Mac

Run the manual [iOS unsigned build](https://github.com/KothaNikhil/Finance-Tracker/actions/workflows/ios-build.yml) GitHub Actions workflow (`workflow_dispatch`). It produces an unsigned `.ipa` that you can sign with a free Apple ID through Sideloadly or AltStore.

## Web

### Debug (dev server)

```powershell
npm run dev --workspace web      # Vite dev server at http://localhost:5173
```

### Release (production build)

From the repo root:

```powershell
npm run build:web                # tsc -b && vite build
```

Output: `web\dist\`

Preview the production build locally:

```powershell
cd web
npx vite preview                 # serves web\dist at http://localhost:4173
```

Netlify deploys with the same command (see `netlify.toml`): `npm run build:web`, publishing `web/dist`.

The optional `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_GOOGLE_CLIENT_ID` environment variables override the built-in defaults at build time.

## Checks before a release build

```powershell
npm run typecheck                          # mobile + web TypeScript
npm test                                   # mobile unit tests
npm run test:web                           # web unit tests (vitest)
npm run lint --workspace mobile            # ESLint (expo)
npm run test:e2e --workspace web           # Playwright e2e (web)
```
