/** Inline SVG icons — CSP-safe. Names match Alert tabs (Red Flags, Overall, Admin). */
const ICONS: Record<string, JSX.Element> = {
  /** Red Flags — warning pennant */
  red_flags: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M5 3v18H3V3h2zm3 1 12-2v11l-12 3V4z" />
      <path d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm0 1.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" opacity="0.85" />
    </svg>
  ),
  flag: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M5 3v18H3V3h2zm3 1 12-2v11l-12 3V4z" />
    </svg>
  ),
  /** Overall — fleet workbook / table */
  overall: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4 5h16v3H4V5zm0 5h10v3H4v-3zm0 5h16v3H4v-3zm12-5h4v3h-4v-3z" />
    </svg>
  ),
  fleet: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4 5h16v3H4V5zm0 5h10v3H4v-3zm0 5h16v3H4v-3zm12-5h4v3h-4v-3z" />
    </svg>
  ),
  /** QA Visit — clipboard check */
  qa_visit: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-2 6h10v2H7V9zm0 4h10v2H7v-2zm0 4h7v2H7v-2zM5 7h14v12H5V7z" />
    </svg>
  ),
  /** Admin — shield with check */
  admin: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2 4 5v6c0 5.1 3.2 9.8 8 11 4.8-1.2 8-5.9 8-11V5l-8-3zm-1 11.2L9.4 12 8 13.4l3 3 7-7-1.4-1.4-4.6 4.6z" />
    </svg>
  ),
  menu: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
    </svg>
  ),
  panel_open: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M3 5h8v14H3V5zm10 0h8v14h-8V5zM5 7v10h4V7H5z" />
    </svg>
  ),
  panel_close: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M3 5h6v14H3V5zm8 0h10v14H11V5zM5 7v10h2V7H5z" />
    </svg>
  ),
  account_circle: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2a7.2 7.2 0 0 1-6-3.22c.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08a7.2 7.2 0 0 1-6 3.22z" />
    </svg>
  ),
};

const FALLBACK = (
  <svg viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

export function NavIcon({ name }: { name: string }) {
  return <span className="navGlyph">{ICONS[name] ?? FALLBACK}</span>;
}
