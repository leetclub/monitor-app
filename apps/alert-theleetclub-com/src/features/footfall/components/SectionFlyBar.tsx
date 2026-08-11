import { useEffect, useMemo, useState } from 'react';

export type FlySection = {
  id: string;
  label: string;
};

type Props = {
  sections: FlySection[];
  focusMode: boolean;
  focusedSectionId?: string | null;
  onFocusModeChange: (on: boolean) => void;
  onFocusSection: (id: string) => void;
};

export function SectionFlyBar({
  sections,
  focusMode,
  focusedSectionId,
  onFocusModeChange,
  onFocusSection,
}: Props) {
  const ids = useMemo(() => sections.map((s) => s.id).join(','), [sections]);
  const [active, setActive] = useState(sections[0]?.id ?? '');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!sections.length) return;
    const observed: Element[] = [];
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0]?.target.id;
        if (top) setActive(top);
      },
      { root: null, rootMargin: '-12% 0px -50% 0px', threshold: [0, 0.08, 0.2, 0.45] },
    );

    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) {
        observer.observe(el);
        observed.push(el);
      }
    }

    return () => observer.disconnect();
  }, [ids, sections]);

  useEffect(() => {
    if (sections.length && !sections.some((s) => s.id === active)) {
      setActive(sections[0].id);
    }
  }, [sections, active]);

  if (!sections.length) return null;

  const goToSection = (id: string) => {
    if (focusMode) {
      onFocusSection(id);
      return;
    }
    const el = document.getElementById(id);
    if (!el) return;
    setActive(id);
    const top = el.getBoundingClientRect().top + window.scrollY - 20;
    window.scrollTo({ top, behavior: 'smooth' });
  };

  return (
    <nav
      className={`sectionFlyBar ${collapsed ? 'sectionFlyBarCollapsed' : ''}`}
      aria-label="Jump to section"
      title="Jump to report section"
    >
      <button
        type="button"
        className={`sectionFlyBarFocusBtn ${focusMode ? 'sectionFlyBarFocusBtnOn' : ''}`}
        onClick={() => onFocusModeChange(!focusMode)}
        title={
          focusMode
            ? 'Exit night focus — show full page'
            : 'Night focus — dim the page and highlight one section (charts, KPIs, …)'
        }
      >
        {focusMode ? 'Exit night' : 'Night focus'}
      </button>
      <button
        type="button"
        className="sectionFlyBarToggle"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? 'Expand section menu' : 'Collapse section menu'}
        aria-expanded={!collapsed}
      >
        {collapsed ? '§' : 'Sections'}
      </button>
      {!collapsed ? (
        <ul className="sectionFlyBarList">
          {sections.map((s) => {
            const linkActive =
              focusMode && focusedSectionId
                ? s.id === focusedSectionId
                : active === s.id;
            return (
            <li key={s.id}>
              <button
                type="button"
                className={linkActive ? 'sectionFlyLink active' : 'sectionFlyLink'}
                onClick={() => goToSection(s.id)}
                title={s.label}
              >
                {s.label}
              </button>
            </li>
            );
          })}
        </ul>
      ) : null}
    </nav>
  );
}
