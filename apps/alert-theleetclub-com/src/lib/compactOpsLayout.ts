import { useEffect, useState } from 'react';
import { navDrawerMediaQuery, shouldUseNavDrawer } from '@/lib/navDrawer';

/** Phone, iPad, and touch-first devices — card/compact ops layouts. */
export function shouldUseCompactOpsLayout(): boolean {
  return shouldUseNavDrawer();
}

export function useCompactOpsLayout(): boolean {
  const [compact, setCompact] = useState(() => shouldUseCompactOpsLayout());
  useEffect(() => {
    const mq = window.matchMedia(navDrawerMediaQuery());
    const sync = () => setCompact(shouldUseCompactOpsLayout());
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return compact;
}
