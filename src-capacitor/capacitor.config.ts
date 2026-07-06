import { defineCapacitorConfig } from '@quasar/app-vite/capacitor';

export default defineCapacitorConfig({
  appId: 'com.cashonize.wallet',
  appName: 'Cashonize',
  webDir: 'www',
  server: {
    androidScheme: 'https',
  },
});
