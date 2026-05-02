/// <reference types="vite/client" />

declare global {
  interface Window {
    __ALERT_ENV__?: {
      ALERT_API_URL?: string | null;
      GOOGLE_CLIENT_ID?: string | null;
      MONITOR_APP_URL?: string | null;
      VITE_DEV_USER_EMAIL?: string | null;
    };
  }
}

export {};

