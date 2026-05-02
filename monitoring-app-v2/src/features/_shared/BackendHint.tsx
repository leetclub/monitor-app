import { ApiError } from '@/api/client';
import styles from './featureShell.module.css';

/** Shown when a BFF route is missing (404/501) so operators know it is a deployment gap, not a UI bug. */
export function backendHintFromError(err: unknown): string | null {
  if (err instanceof ApiError) {
    if (err.status === 404 || err.status === 501) {
      return 'This action needs a matching HTTP route on the monitoring API (people-api/BFF). The React screen is ready; deploy or extend the backend proxy for this path.';
    }
    if (err.status === 408 || err.status === 504 || err.status === 502) {
      return 'The monitoring API or Vendon upstream was slow or unreachable. Retry in a moment; if this persists, ops may need higher ingress/API read timeouts or to check Vendon availability.';
    }
  }
  return null;
}

/** Extra context when the Red Alert snapshot route is missing (404/501). */
export function backendHintForRedAlertSnapshot(err: unknown): string | null {
  const base = backendHintFromError(err);
  if (!base) {
    return null;
  }
  return `${base} Add GET /api/red-alert/snapshot on people-api (contract: docs/RED_ALERT_API.md). For a UI-only demo, set VITE_USE_MOCK_RED_ALERT=true or USE_MOCK_RED_ALERT=true in config.js.`;
}

export function BackendHint({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className={styles.hint}>{message}</p>;
}
