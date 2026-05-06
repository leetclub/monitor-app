/// <reference types="vite/client" />

declare global {
  interface Window {
    __ALERT_ENV__?: {
      ALERT_API_URL?: string | null;
      GOOGLE_CLIENT_ID?: string | null;
      MONITOR_APP_URL?: string | null;
      SLACK_TEAM_ID?: string | null;
      SLACK_AM_AHMED_USER_ID?: string | null;
      SLACK_AM_SUHAIB_USER_ID?: string | null;
      SLACK_OP_EMAIL_MAP_JSON?: string | null;
      VITE_DEV_USER_EMAIL?: string | null;
    };
  }
}

export {};

