import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ma.comdis.driver',
  appName: 'COMDIS Driver',

  webDir: 'www',

  server: {
    url: 'https://limonad-app.vercel.app',
    cleartext: false,
  },

  android: {
    useLegacyBridge: true,
  },
};

export default config;
