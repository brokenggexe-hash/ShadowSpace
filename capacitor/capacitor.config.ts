export interface ShadowSpaceCapacitorConfig {
  appId: string;
  appName: string;
  webDir: string;
  server: {
    androidScheme: 'https' | 'http';
    cleartext: boolean;
  };
  plugins: Record<string, Record<string, unknown>>;
}

const config: ShadowSpaceCapacitorConfig = {
  appId: 'app.shadowspace.mobile',
  appName: 'ShadowSpace',
  webDir: '../dist',
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#0A0B0F',
    },
    Keyboard: {
      resize: 'body',
      style: 'DARK',
    },
  },
};

export default config;
