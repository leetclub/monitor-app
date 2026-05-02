import { useMemo, useState } from 'react';
import styles from './BrandLogo.module.css';

type Props = {
  /** Pixel width/height (square). */
  size?: number;
  className?: string;
  /**
   * `favicon` — `/favicon.png` (from project-root `favicon.png` at build) then `leet` assets.
   * `leet` — `/leet.png` then `/leet.svg` (login hero / legacy mark).
   */
  mark?: 'favicon' | 'leet';
};

/**
 * Uses stable `/public` URLs (not hashed `/assets/`) so replacing source files + rebuild updates the UI.
 */
export function BrandLogo({ size = 40, className, mark = 'leet' }: Props) {
  const chain = useMemo(
    () => (mark === 'favicon' ? ['/favicon.png', '/leet.png', '/leet.svg'] : ['/leet.png', '/leet.svg']),
    [mark],
  );
  const [i, setI] = useState(0);
  const src = chain[Math.min(i, chain.length - 1)];
  const dim = { width: size, height: size };

  return (
    <img
      className={`${styles.img} ${className ?? ''}`}
      src={src}
      alt="Leet Monitor"
      {...dim}
      onError={() => setI((prev) => (prev < chain.length - 1 ? prev + 1 : prev))}
    />
  );
}
