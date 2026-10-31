import type { CapacitorConfig } from '@capacitor/cli';

// Configures the experimental iOS shell around Folia's existing web build.
const config: CapacitorConfig = {
    appId: 'top.izuna.foliamajor.ios',
    appName: 'Folia',
    webDir: 'dist',
};

export default config;
