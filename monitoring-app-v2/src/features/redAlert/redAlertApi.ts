import { apiFetch } from '@/api/client';
import { isMockRedAlertSnapshotEnabled } from '@/config/runtimeEnv';
import { RED_ALERT_DEV_MOCK_SNAPSHOT } from './redAlertMock';
import type { RedAlertSnapshotResponse } from './redAlertTypes';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Red Alert snapshot — v2 depends only on the canonical people-api route (see `docs/RED_ALERT_API.md`).
 *
 * - `USE_MOCK_RED_ALERT=true` (Vite `VITE_USE_MOCK_RED_ALERT` or runtime `config.js`) → bundled mock, no HTTP.
 * - Otherwise `GET /api/red-alert/snapshot` (session / same-origin).
 */
export async function fetchRedAlertSnapshot(): Promise<RedAlertSnapshotResponse> {
  if (isMockRedAlertSnapshotEnabled()) {
    await delay(180);
    return {
      ...RED_ALERT_DEV_MOCK_SNAPSHOT,
      generatedAt: new Date().toISOString(),
    };
  }

  return apiFetch<RedAlertSnapshotResponse>('/api/red-alert/snapshot', { method: 'GET' });
}
