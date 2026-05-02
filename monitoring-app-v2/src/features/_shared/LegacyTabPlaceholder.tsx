import { Link } from 'react-router-dom';
import { TAB_BY_ID, tabsForMain } from '@/navigation/tabs';
import { useAccess } from '@/context/AccessContext';
import { LEGACY_TAB_REFERENCE } from './legacyTabMeta';
import styles from './LegacyTabPlaceholder.module.css';

type Props = { tabId: string };

/**
 * Stand-in for tabs not yet ported from the classic dashboard.
 * Replaced feature-by-feature with real modules under src/features/&lt;tabId&gt;/.
 */
export function LegacyTabPlaceholder({ tabId }: Props) {
  const { canSeeTab } = useAccess();
  const meta = TAB_BY_ID[tabId];
  const legacy = LEGACY_TAB_REFERENCE[tabId] ?? 'index.html + related *.js in monitoring-app';
  const siblings = meta ? tabsForMain(meta.main).filter((t) => canSeeTab(t.id)) : [];

  if (!meta) {
    return (
      <div className="panel">
        <h1>Unknown tab</h1>
        <p>
          <code>{tabId}</code>
        </p>
      </div>
    );
  }

  return (
    <article className={`panel ${styles.wrap}`}>
      <header className={styles.header}>
        <h1 className={styles.title}>{meta.label}</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          {meta.description}
        </p>
      </header>

      <section className={styles.card}>
        <p>
          <strong>Migration in progress.</strong> This screen will be replaced with a standalone React
          implementation (same behavior and data as the classic app). The legacy{' '}
          <code>monitoring-app</code> project is reference-only; new work extends the HTTP API (BFF /
          people-api) as needed.
        </p>
        <p className={styles.ref}>
          <span className={styles.refLabel}>Classic reference:</span> {legacy}
        </p>
        <p className={styles.scope}>
          See <code>REFACTOR-SCOPE.txt</code> in this repo for the full tab checklist and parity notes.
        </p>
      </section>

      {siblings.length > 0 && (
        <section className={styles.related}>
          <h2 className={styles.relatedTitle}>Related routes</h2>
          <ul className={styles.linkList}>
            {siblings.map((t) => (
              <li key={t.id}>
                <Link to={`/tab/${t.id}`} className={t.id === tabId ? styles.activeLink : undefined}>
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
