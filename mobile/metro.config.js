// Learn more: https://docs.expo.dev/guides/customizing-metro/
// Start from Expo's default config (imported from `expo/metro-config`, not
// `@expo/metro-config`, so it tracks the installed SDK).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// --- Web support for expo-sqlite ---------------------------------------------
// On web, expo-sqlite runs a WebAssembly build of SQLite (wa-sqlite) shipped at
// node_modules/expo-sqlite/web/wa-sqlite/wa-sqlite.wasm. Metro doesn't treat
// `.wasm` as a resolvable asset by default, which is why the web bundle failed
// with "Unable to resolve module ./wa-sqlite/wa-sqlite.wasm". Register it.
config.resolver.assetExts.push('wasm');

// wa-sqlite relies on cross-origin isolation (SharedArrayBuffer), which the
// browser only grants when the page is served with COOP/COEP headers. Set them
// on the Metro dev server. (A deployed web build sets the same headers via the
// expo-router plugin `headers` option in app.json — see the expo-sqlite docs.)
// `server.enhanceMiddleware` is the only dev-server header hook in Metro 0.84
// (Expo SDK 57); it is flagged deprecated but remains functional.
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    return middleware(req, res, next);
  };
};

module.exports = config;
