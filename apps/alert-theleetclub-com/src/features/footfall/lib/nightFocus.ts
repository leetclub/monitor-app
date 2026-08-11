import type { FlySection } from '@/features/footfall/components/SectionFlyBar';

/** Fallback when programmatically focusing the first available section. */
export const NIGHT_FOCUS_DEFAULT_SECTION = 'detail-top';

export function defaultNightFocusSection(sections: FlySection[]): string | null {
  if (!sections.length) return null;
  return sections.find((s) => s.id === NIGHT_FOCUS_DEFAULT_SECTION)?.id ?? sections[0].id;
}
