import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ALL_DASHBOARD_TAB_IDS } from '@/navigation/tabs';
import { BackendHint, backendHintFromError } from '@/features/_shared/BackendHint';
import { fetchDashboardAccessRules, putDashboardAccessRules, type DashboardAccessRules } from './adminApi';
import styles from '../_shared/featureShell.module.css';

const EXAMPLE: DashboardAccessRules = {
  defaultTabs: ['events', 'waste', 'liveDashboard'],
  users: {
    'operator@example.com': ['events', 'maintenance', 'waste', 'liveDashboard', 'leetAlert'],
  },
};

const RULE_TAB_ID_SET = new Set(ALL_DASHBOARD_TAB_IDS);
const KNOWN_TAB_IDS = ALL_DASHBOARD_TAB_IDS.filter((id) => id !== '*');

const TAB_LABELS: Record<string, string> = {
  leetAlert: 'Alert (read)',
  leetAlertAdmin: 'Alert (admin)',
  redAlert: 'Red Alert (Monitor)',
  liveDashboard: 'Live Ops',
  admin: 'Admin (Monitor rules)',
};

function labelForTabId(id: string): string {
  return TAB_LABELS[id] ?? id;
}

function uniqStrings(xs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const s = String(x);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function normalizeRules(input: DashboardAccessRules): DashboardAccessRules {
  const users: Record<string, string[]> = {};
  for (const [rawEmail, tabs] of Object.entries(input.users ?? {})) {
    const email = rawEmail.toLowerCase().trim();
    if (!email) continue;
    users[email] = uniqStrings(Array.isArray(tabs) ? tabs.map(String) : []);
  }
  const emails = Object.keys(users).sort((a, b) => a.localeCompare(b));
  const sortedUsers: Record<string, string[]> = {};
  for (const e of emails) sortedUsers[e] = users[e] ?? [];
  return {
    defaultTabs: uniqStrings(Array.isArray(input.defaultTabs) ? input.defaultTabs.map(String) : []),
    users: sortedUsers,
  };
}

function splitTabs(tabs: string[]): { full: boolean; known: Set<string>; extra: string[] } {
  const list = uniqStrings(tabs);
  const full = list.includes('*');
  const extra: string[] = [];
  const known = new Set<string>();
  for (const id of list) {
    if (id === '*') continue;
    if (!RULE_TAB_ID_SET.has(id)) {
      extra.push(id);
      continue;
    }
    known.add(id);
  }
  return { full, known, extra };
}

function buildTabsFromPicks(full: boolean, known: Set<string>, extra: string[]): string[] {
  if (full) return ['*'];
  return uniqStrings([...Array.from(known).sort((a, b) => a.localeCompare(b)), ...extra]);
}

type UiMode = 'visual' | 'json';

export default function AdminTab() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<UiMode>('visual');
  const [rules, setRules] = useState<DashboardAccessRules>({ defaultTabs: [], users: {} });
  const [jsonText, setJsonText] = useState('');
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const rulesQ = useQuery({
    queryKey: ['dashboard-access', 'rules'],
    queryFn: async () => {
      setHint(null);
      try {
        return await fetchDashboardAccessRules();
      } catch (e) {
        setHint(backendHintFromError(e));
        throw e;
      }
    },
  });

  useEffect(() => {
    if (!rulesQ.data) return;
    const next = normalizeRules(rulesQ.data);
    setRules(next);
    setJsonText(JSON.stringify(next, null, 2));
    setParseErr(null);
  }, [rulesQ.data]);

  const saveMut = useMutation({
    mutationFn: putDashboardAccessRules,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['dashboard-access', 'rules'] });
      void qc.invalidateQueries({ queryKey: ['dashboard-access'] });
    },
  });

  const userRows = useMemo(() => Object.entries(rules.users), [rules.users]);

  const applySaveRules = (nextRules: DashboardAccessRules) => {
    setHint(null);
    const normalized = normalizeRules(nextRules);
    for (const tabs of [normalized.defaultTabs, ...Object.values(normalized.users)]) {
      for (const id of tabs) {
        if (id === '*') continue;
        if (!RULE_TAB_ID_SET.has(id)) {
          setParseErr(`Unknown tab id in rules: ${id}. Fix JSON or remove it before saving.`);
          return;
        }
      }
    }
    setParseErr(null);
    saveMut.mutate(normalized, {
      onError: (e) => {
        setHint(backendHintFromError(e));
      },
    });
  };

  const applySaveJson = () => {
    setParseErr(null);
    setHint(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      setParseErr('Invalid JSON.');
      return;
    }
    if (!parsed || typeof parsed !== 'object') {
      setParseErr('Root must be an object.');
      return;
    }
    const o = parsed as Record<string, unknown>;
    if (!Array.isArray(o.defaultTabs)) {
      setParseErr('defaultTabs must be an array of tab ids.');
      return;
    }
    if (!o.users || typeof o.users !== 'object' || Array.isArray(o.users)) {
      setParseErr('users must be an object map of email → tab id array.');
      return;
    }
    const next: DashboardAccessRules = {
      defaultTabs: o.defaultTabs.map(String),
      users: Object.fromEntries(
        Object.entries(o.users as Record<string, unknown>).map(([email, tabs]) => [
          email.toLowerCase().trim(),
          Array.isArray(tabs) ? tabs.map(String) : [],
        ]),
      ),
    };
    setRules(normalizeRules(next));
    applySaveRules(next);
  };

  const setDefaultFull = (full: boolean) => {
    setRules((prev) => ({
      ...prev,
      defaultTabs: full ? ['*'] : [],
    }));
  };

  const toggleDefaultTab = (tabId: string, on: boolean) => {
    setRules((prev) => {
      const { full, known, extra } = splitTabs(prev.defaultTabs);
      if (full) {
        return prev;
      }
      if (on) known.add(tabId);
      else known.delete(tabId);
      return { ...prev, defaultTabs: buildTabsFromPicks(false, known, extra) };
    });
  };

  const addUserRow = () => {
    setRules((prev) => {
      const base = 'new.user@example.com';
      let email = base;
      let i = 2;
      while (prev.users[email]) {
        email = `new.user${i}@example.com`;
        i += 1;
      }
      return { ...prev, users: { ...prev.users, [email]: [...prev.defaultTabs] } };
    });
  };

  const removeUser = (email: string) => {
    setRules((prev) => {
      const { [email]: _, ...rest } = prev.users;
      return { ...prev, users: rest };
    });
  };

  const renameUser = (from: string, toRaw: string) => {
    const to = toRaw.toLowerCase().trim();
    if (!to || to === from) return;
    setRules((prev) => {
      if (prev.users[to]) return prev;
      const { [from]: tabs, ...rest } = prev.users;
      return { ...prev, users: { ...rest, [to]: tabs ?? [] } };
    });
  };

  const setUserFull = (email: string, full: boolean) => {
    setRules((prev) => {
      const tabs = prev.users[email] ?? [];
      const { extra } = splitTabs(tabs);
      return {
        ...prev,
        users: { ...prev.users, [email]: buildTabsFromPicks(full, new Set(), extra) },
      };
    });
  };

  const toggleUserTab = (email: string, tabId: string, on: boolean) => {
    setRules((prev) => {
      const tabs = prev.users[email] ?? [];
      const { full, known, extra } = splitTabs(tabs);
      if (full) return prev;
      if (on) known.add(tabId);
      else known.delete(tabId);
      return { ...prev, users: { ...prev.users, [email]: buildTabsFromPicks(false, known, extra) } };
    });
  };

  const removeUserExtraTab = (email: string, tabId: string) => {
    setRules((prev) => {
      const tabs = prev.users[email] ?? [];
      const nextTabs = tabs.filter((t) => t !== tabId);
      return { ...prev, users: { ...prev.users, [email]: nextTabs } };
    });
  };

  const copyDefaultToUser = (email: string) => {
    setRules((prev) => ({
      ...prev,
      users: { ...prev.users, [email]: [...prev.defaultTabs] },
    }));
  };

  const grantAlertRead = (email: string) => {
    setRules((prev) => {
      const tabs = prev.users[email] ?? [];
      const { full, known, extra } = splitTabs(tabs);
      if (full) return prev;
      known.add('leetAlert');
      return { ...prev, users: { ...prev.users, [email]: buildTabsFromPicks(false, known, extra) } };
    });
  };

  const grantAlertAdmin = (email: string) => {
    setRules((prev) => {
      const tabs = prev.users[email] ?? [];
      const { full, known, extra } = splitTabs(tabs);
      if (full) return prev;
      known.add('leetAlert');
      known.add('leetAlertAdmin');
      return { ...prev, users: { ...prev.users, [email]: buildTabsFromPicks(false, known, extra) } };
    });
  };

  const switchMode = (next: UiMode) => {
    if (next === mode) return;
    if (next === 'json') {
      const normalized = normalizeRules(rules);
      setRules(normalized);
      setJsonText(JSON.stringify(normalized, null, 2));
      setParseErr(null);
    } else {
      setParseErr(null);
      try {
        const parsed = JSON.parse(jsonText) as unknown;
        if (!parsed || typeof parsed !== 'object') throw new Error('bad');
        const o = parsed as Record<string, unknown>;
        if (!Array.isArray(o.defaultTabs) || !o.users || typeof o.users !== 'object' || Array.isArray(o.users)) {
          throw new Error('bad');
        }
        const nextRules: DashboardAccessRules = {
          defaultTabs: o.defaultTabs.map(String),
          users: Object.fromEntries(
            Object.entries(o.users as Record<string, unknown>).map(([email, tabs]) => [
              email.toLowerCase().trim(),
              Array.isArray(tabs) ? tabs.map(String) : [],
            ]),
          ),
        };
        setRules(normalizeRules(nextRules));
      } catch {
        /* keep current visual rules if JSON is invalid */
      }
    }
    setMode(next);
  };

  const defaultSplit = splitTabs(rules.defaultTabs);

  return (
    <div className={styles.wrap}>
      <p className={styles.intro}>
        <strong>Admin</strong> edits dashboard tab rules stored in Postgres. This UI calls{' '}
        <code>GET/PUT /api/me/dashboard-access/rules</code> using your Google session. The server only allows users who
        can edit permissions (Monitor <code>admin</code> tab and/or the configured super-admin allowlist).
      </p>
      <p className={styles.intro} style={{ fontSize: '0.85rem' }}>
        Valid tab ids include Monitor tabs plus Alert grants (<code>leetAlert</code>, <code>leetAlertAdmin</code>). Use{' '}
        <code>[&quot;*&quot;]</code> in defaultTabs or per user for full access. <strong>Live Ops</strong> (
        <code>liveDashboard</code>) and legacy <strong>Red Alert</strong> (<code>redAlert</code>) are separate from the
        standalone Alert product.
      </p>

      <BackendHint message={hint} />
      {rulesQ.error && (
        <div className={styles.err}>{rulesQ.error instanceof Error ? rulesQ.error.message : 'Failed to load rules'}</div>
      )}
      {parseErr && <div className={styles.err}>{parseErr}</div>}
      {saveMut.error && (
        <div className={styles.err}>
          {saveMut.error instanceof Error ? saveMut.error.message : 'Save failed'}
        </div>
      )}

      <div className={styles.actions} style={{ alignItems: 'center' }}>
        <span className={styles.quickLabel} style={{ marginRight: '0.35rem' }}>
          Editor
        </span>
        <div className={styles.quickBtns}>
          <button type="button" className={mode === 'visual' ? styles.btnPrimary : styles.btn} onClick={() => switchMode('visual')}>
            Visual
          </button>
          <button type="button" className={mode === 'json' ? styles.btnPrimary : styles.btn} onClick={() => switchMode('json')}>
            JSON
          </button>
        </div>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className={styles.btn}
          onClick={() => {
            setJsonText(JSON.stringify(EXAMPLE, null, 2));
            setRules(normalizeRules(EXAMPLE));
            setMode('json');
            setParseErr(null);
          }}
        >
          Insert example JSON
        </button>
        <button
          type="button"
          className={styles.btnPrimary}
          disabled={saveMut.isPending || rulesQ.isLoading}
          onClick={() => (mode === 'json' ? applySaveJson() : applySaveRules(rules))}
        >
          {saveMut.isPending ? 'Saving…' : 'Save rules'}
        </button>
      </div>

      {mode === 'visual' ? (
        <>
          <section className={styles.field} style={{ gap: '0.65rem' }}>
            <label htmlFor="default-tabs-visual">Default tabs (everyone without their own row)</label>
            <div className={styles.machineRow} style={{ padding: '0.15rem 0' }}>
              <label className={styles.machineRow} style={{ gap: '0.35rem' }}>
                <input
                  type="checkbox"
                  checked={defaultSplit.full}
                  onChange={(e) => setDefaultFull(e.target.checked)}
                  aria-label="Full access default"
                />
                <span style={{ fontSize: '0.88rem' }}>Full access (*)</span>
              </label>
            </div>
            {!defaultSplit.full && (
              <div className={styles.machineGrid} id="default-tabs-visual" aria-label="Default tab picks">
                {KNOWN_TAB_IDS.map((id) => (
                  <label key={id} className={styles.machineRow}>
                    <input
                      type="checkbox"
                      checked={defaultSplit.known.has(id)}
                      onChange={(e) => toggleDefaultTab(id, e.target.checked)}
                    />
                    <span>{labelForTabId(id)}</span>
                  </label>
                ))}
              </div>
            )}
          </section>

          <div className={styles.actions}>
            <button type="button" className={styles.btnPrimary} onClick={addUserRow} disabled={saveMut.isPending || rulesQ.isLoading}>
              Add user
            </button>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Access</th>
                </tr>
              </thead>
              <tbody>
                {userRows.length === 0 ? (
                  <tr>
                    <td colSpan={2} className={styles.empty}>
                      No per-user rows yet. Defaults apply, or add a user row.
                    </td>
                  </tr>
                ) : (
                  userRows.map(([email, tabs]) => {
                    const split = splitTabs(tabs);
                    return (
                      <tr key={email}>
                        <td style={{ verticalAlign: 'top', minWidth: '14rem' }}>
                          <input
                            className={styles.jsonEditor}
                            style={{ minHeight: '2.35rem', width: '100%' }}
                            value={email}
                            onChange={(e) => renameUser(email, e.target.value)}
                            spellCheck={false}
                            aria-label={`Email for ${email}`}
                          />
                          <div className={styles.quickBtns} style={{ marginTop: '0.45rem' }}>
                            <button type="button" className={styles.btn} onClick={() => copyDefaultToUser(email)}>
                              Copy default
                            </button>
                            <button type="button" className={styles.btn} onClick={() => grantAlertRead(email)}>
                              +Alert read
                            </button>
                            <button type="button" className={styles.btn} onClick={() => grantAlertAdmin(email)}>
                              +Alert admin
                            </button>
                            <button type="button" className={styles.btn} onClick={() => removeUser(email)}>
                              Remove
                            </button>
                          </div>
                          {split.extra.length > 0 && (
                            <div style={{ marginTop: '0.55rem' }}>
                              <div className={styles.quickLabel}>Extra tab ids (preserved)</div>
                              <div className={styles.quickBtns} style={{ marginTop: '0.25rem' }}>
                                {split.extra.map((id) => (
                                  <button key={id} type="button" className={styles.btn} onClick={() => removeUserExtraTab(email, id)}>
                                    {id} ✕
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </td>
                        <td style={{ verticalAlign: 'top' }}>
                          <div className={styles.machineRow} style={{ paddingBottom: '0.35rem' }}>
                            <label className={styles.machineRow} style={{ gap: '0.35rem' }}>
                              <input
                                type="checkbox"
                                checked={split.full}
                                onChange={(e) => setUserFull(email, e.target.checked)}
                                aria-label={`Full access for ${email}`}
                              />
                              <span style={{ fontSize: '0.88rem' }}>Full access (*)</span>
                            </label>
                          </div>
                          {!split.full && (
                            <div className={styles.machineGrid} aria-label={`Tab picks for ${email}`}>
                              {KNOWN_TAB_IDS.map((id) => (
                                <label key={id} className={styles.machineRow}>
                                  <input
                                    type="checkbox"
                                    checked={split.known.has(id)}
                                    onChange={(e) => toggleUserTab(email, id, e.target.checked)}
                                  />
                                  <span>{labelForTabId(id)}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <textarea
          className={styles.jsonEditor}
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          spellCheck={false}
          aria-label="Dashboard access rules JSON"
        />
      )}
    </div>
  );
}
