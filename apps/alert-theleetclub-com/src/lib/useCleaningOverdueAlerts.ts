import { useEffect, useRef } from 'react';
import type { RedAlertRow } from '@/features/redflags/redAlertTypes';

const STORAGE_KEY = 'alert_cleaning_notify_last';

/** Browser notification when machines cross the 15h cleaning threshold (requires user permission). */
export function useCleaningOverdueAlerts(rows: RedAlertRow[], enabled: boolean) {
  const prevCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const overdue = rows.filter((r) => r.cleaningOverdue15h);
    const count = overdue.length;
    const prev = prevCountRef.current;
    prevCountRef.current = count;

    if (count === 0) return;
    if (prev != null && count <= prev) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const sig = `${count}:${overdue.map((r) => String(r.machineId ?? r.machine_id ?? '')).sort().join(',')}`;
    try {
      const last = sessionStorage.getItem(STORAGE_KEY);
      if (last === sig) return;
      sessionStorage.setItem(STORAGE_KEY, sig);
    } catch {
      /* ignore */
    }

    const names = overdue
      .slice(0, 3)
      .map((r) => String(r.machineName || r.machineId || '').trim())
      .filter(Boolean);
    const body =
      names.length > 0
        ? `${names.join(', ')}${count > names.length ? ` +${count - names.length} more` : ''}`
        : `${count} machine(s) not cleaned within 15 hours`;

    try {
      new Notification('Cleaning overdue — Leet Alert', { body, tag: 'leet-alert-cleaning-15h' });
    } catch {
      /* ignore */
    }
  }, [rows, enabled]);
}

export async function requestCleaningNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}
