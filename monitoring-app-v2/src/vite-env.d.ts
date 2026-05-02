/// <reference types="vite/client" />

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

interface ImportMetaEnv {
  readonly VITE_MONITORING_API_URL: string;
  readonly VITE_USE_MOCK_ACCESS: string;
  readonly VITE_MOCK_ALLOWED_TABS: string;
  readonly VITE_DEV_USER_EMAIL: string;
  readonly VITE_DEV_API_PROXY: string;
  readonly VITE_ACCESS_ALLOWED_DOMAIN: string;
  readonly VITE_ACCESS_TEST_MODE: string;
  readonly VITE_GOOGLE_CLIENT_ID: string;
  readonly VITE_USE_MOCK_RED_ALERT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
