import type { CapacitorConfig } from '@capacitor/cli';

// PHASE 5A.4 - "2. AJOUTER DEUX MODES BUILD": a single build-time switch,
// resolved once when the Capacitor CLI loads this file (this file is just a
// plain module - no special Capacitor API needed to make it conditional).
// NEVER resolved at runtime inside the app itself - by the time the APK
// exists, this file's own logic has already picked one fixed config, baked
// into capacitor.config.json.
//
// Absent (the default): REMOTE mode - byte-for-byte the config that shipped
// before this phase (server.url -> Vercel, webDir -> www). A plain
// `npx cap sync android` with no environment variable set must keep
// producing exactly this - see this phase's own "3. MODE REMOTE PAR DÉFAUT".
//
// Exactly "1": LOCAL mode - the Vite driver shell (mobile/driver/dist)
// embedded directly in the APK, no server.url at all, so the WebView never
// depends on Vercel being reachable.
const useLocalDriverShell = process.env.COMDIS_LOCAL_DRIVER_SHELL === '1';

const config: CapacitorConfig = {
  appId: 'ma.comdis.driver',
  appName: 'COMDIS Driver',

  webDir: useLocalDriverShell ? 'mobile/driver/dist' : 'www',

  // `server` is entirely OMITTED in LOCAL mode (not set to an empty/undefined
  // value) - so capacitor.config.json never even has the key, and the
  // WebView loads webDir's local assets the normal Capacitor way instead of
  // proxying to a remote origin.
  ...(useLocalDriverShell
    ? {}
    : {
        server: {
          url: 'https://limonad-app.vercel.app',
          cleartext: false,
        },
      }),

  android: {
    useLegacyBridge: true,
  },
};

export default config;
