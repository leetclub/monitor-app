import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchDashboardAccessRules,
  putDashboardAccessRules,
  type DashboardAccessRules,
} from '@/lib/dashboardRulesApi';
import { labelForAccessKey } from '@/lib/accessLabels';

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

function splitTabs(tabs: string[], ruleSet: Set<string>): { full: boolean; known: Set<string>; extra: string[] } {
  const list = uniqStrings(tabs);
  const full = list.includes('*');
  const extra: string[] = [];
  const known = new Set<string>();
  for (const id of list) {
    if (id === '*') continue;
    if (!ruleSet.has(id)) {
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

type TeamAccessEditorProps = {
  /** Nested under Alert People — shorter chrome (still full grid). */
  embedded?: boolean;
};

export function TeamAccessEditor(props: TeamAccessEditorProps = {}) {
  const embedded = props.embedded ?? false;
  const qc = useQueryClient();
  const [mode, setMode] = useState<'visual' | 'json'>('visual');
  const [rules, setRules] = useState<DashboardAccessRules>({ defaultTabs: [], users: {} });
  const [knownIds, setKnownIds] = useState<string[]>([]);
  const [jsonText, setJsonText] = useState('');
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const rulesQ = useQuery({
    queryKey: ['dashboard-access', 'rules'],
    queryFn: fetchDashboardAccessRules,
  });

  useEffect(() => {
    if (!rulesQ.data) return;
    const next = normalizeRules(rulesQ.data);
    setRules(next);
    setJsonText(JSON.stringify(next, null, 2));
    const ids = (rulesQ.data.allTabIds ?? []).filter((id) => id !== '*');
    setKnownIds(ids.length ? ids : Object.keys(next.users).length ? [] : []);
    setParseErr(null);
    setSaveErr(null);
  }, [rulesQ.data]);

  const ruleSet = useMemo(() => new Set(knownIds), [knownIds]);

  const saveMut = useMutation({
    mutationFn: putDashboardAccessRules,
    onSuccess: async () => {
      setSaveErr(null);
      await qc.invalidateQueries({ queryKey: ['dashboard-access'] });
      await qc.invalidateQueries({ queryKey: ['dashboard-access', 'rules'] });
    },
    onError: (e: Error) => setSaveErr(e.message),
  });

  const userRows = useMemo(() => Object.entries(rules.users), [rules.users]);

  const applySaveRules = (nextRules: DashboardAccessRules) => {
    const normalized = normalizeRules(nextRules);
    for (const tabs of [normalized.defaultTabs, ...Object.values(normalized.users)]) {
      for (const id of tabs) {
        if (id === '*') continue;
        if (!ruleSet.has(id)) {
          setParseErr('One or more permissions are not recognized. Remove unknown entries or refresh the page.');
          return;
        }
      }
    }
    setParseErr(null);
    saveMut.mutate(normalized);
  };

  const applySaveJson = () => {
    setParseErr(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      setParseErr('That is not valid JSON. Check brackets and commas.');
      return;
    }
    if (!parsed || typeof parsed !== 'object') {
      setParseErr('The file must start with { and contain defaultTabs and users.');
      return;
    }
    const o = parsed as Record<string, unknown>;
    if (!Array.isArray(o.defaultTabs) || !o.users || typeof o.users !== 'object' || Array.isArray(o.users)) {
      setParseErr('Use defaultTabs (list) and users (email → list).');
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

  const defaultSplit = splitTabs(rules.defaultTabs, ruleSet);

  const setDefaultFull = (full: boolean) => {
    setRules((prev) => ({ ...prev, defaultTabs: full ? ['*'] : [] }));
  };

  const toggleDefaultTab = (tabId: string, on: boolean) => {
    setRules((prev) => {
      const { full, known, extra } = splitTabs(prev.defaultTabs, ruleSet);
      if (full) return prev;
      if (on) known.add(tabId);
      else known.delete(tabId);
      return { ...prev, defaultTabs: buildTabsFromPicks(false, known, extra) };
    });
  };

  const addUserRow = () => {
    setRules((prev) => {
      const base = 'new.person@company.com';
      let email = base;
      let i = 2;
      while (prev.users[email]) {
        email = `new.person${i}@company.com`;
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
      const { extra } = splitTabs(tabs, ruleSet);
      return {
        ...prev,
        users: { ...prev.users, [email]: buildTabsFromPicks(full, new Set(), extra) },
      };
    });
  };

  const toggleUserTab = (email: string, tabId: string, on: boolean) => {
    setRules((prev) => {
      const tabs = prev.users[email] ?? [];
      const { full, known, extra } = splitTabs(tabs, ruleSet);
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

  const grantLeetAlertView = (email: string) => {
    setRules((prev) => {
      const tabs = prev.users[email] ?? [];
      const { full, known, extra } = splitTabs(tabs, ruleSet);
      if (full) return prev;
      known.add('leetAlert');
      return { ...prev, users: { ...prev.users, [email]: buildTabsFromPicks(false, known, extra) } };
    });
  };

  const grantLeetAlertManage = (email: string) => {
    setRules((prev) => {
      const tabs = prev.users[email] ?? [];
      const { full, known, extra } = splitTabs(tabs, ruleSet);
      if (full) return prev;
      known.add('leetAlert');
      known.add('leetAlertAdmin');
      return { ...prev, users: { ...prev.users, [email]: buildTabsFromPicks(false, known, extra) } };
    });
  };

  return (
    <div className={embedded ? 'adminCardNested' : 'adminCard'}>
      <h2 className={embedded ? 'adminSectionTitle' : 'adminCardTitle'}>
        {embedded ? 'Full Monitor grid + JSON' : 'Who can use Monitor & Leet Alert'}
      </h2>
      <p className="adminCardHint">
        {embedded
          ? 'Grant *, extra dashboards, or paste JSON. Prefer steps 1–2 above for Alert-only access.'
          : 'Add people by email and tick what they’re allowed to open. New colleagues usually need at least “View Leet Alert” if they should see Red Flags here. Changes apply after you save.'}
      </p>

      {rulesQ.isLoading ? <p className="muted">Loading…</p> : null}
      {rulesQ.error ? (
        <p className="pillDanger">{(rulesQ.error as Error).message}</p>
      ) : null}
      {parseErr ? <p className="pillDanger">{parseErr}</p> : null}
      {saveErr ? <p className="pillDanger">{saveErr}</p> : null}

      <div className="adminTabs" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={mode === 'visual' ? 'adminTab adminTabActive' : 'adminTab'}
          onClick={() => {
            setMode('visual');
            setParseErr(null);
          }}
        >
          Simple editor
        </button>
        <button
          type="button"
          className={mode === 'json' ? 'adminTab adminTabActive' : 'adminTab'}
          onClick={() => {
            setMode('json');
            setJsonText(JSON.stringify(normalizeRules(rules), null, 2));
            setParseErr(null);
          }}
        >
          Import / export (JSON)
        </button>
      </div>

      {mode === 'visual' && knownIds.length === 0 && !rulesQ.isLoading ? (
        <p className="muted">Could not load the permission list. Refresh the page or contact support.</p>
      ) : null}

      {mode === 'visual' && knownIds.length > 0 ? (
        <>
          <div className="adminGroup">
            <div className="adminGroupLabel">Defaults for new people</div>
            <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
              Used when someone signs in and their email is not in the table below.
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <input type="checkbox" checked={defaultSplit.full} onChange={(e) => setDefaultFull(e.target.checked)} />
              Full access to everything
            </label>
            {!defaultSplit.full ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  gap: '6px 12px',
                }}
              >
                {knownIds.map((id) => (
                  <label key={id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.88rem' }}>
                    <input
                      type="checkbox"
                      checked={defaultSplit.known.has(id)}
                      onChange={(e) => toggleDefaultTab(id, e.target.checked)}
                    />
                    <span>{labelForAccessKey(id)}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>

          <div className="adminGroup">
            <button type="button" className="primary" onClick={addUserRow} disabled={saveMut.isPending}>
              Add someone by email
            </button>
          </div>

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Permissions</th>
                </tr>
              </thead>
              <tbody>
                {userRows.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="muted">
                      No one listed yet — only the defaults above apply.
                    </td>
                  </tr>
                ) : (
                  userRows.map(([email, tabs]) => {
                    const split = splitTabs(tabs, ruleSet);
                    return (
                      <tr key={email}>
                        <td style={{ verticalAlign: 'top', minWidth: 200 }}>
                          <input
                            value={email}
                            onChange={(e) => renameUser(email, e.target.value)}
                            style={{ width: '100%', maxWidth: 280 }}
                          />
                          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            <button type="button" className="primary" onClick={() => copyDefaultToUser(email)}>
                              Same as defaults
                            </button>
                            <button type="button" onClick={() => grantLeetAlertView(email)}>
                              + View Leet Alert
                            </button>
                            <button type="button" onClick={() => grantLeetAlertManage(email)}>
                              + Manage Leet Alert
                            </button>
                            <button type="button" className="danger" onClick={() => removeUser(email)}>
                              Remove
                            </button>
                          </div>
                          {split.extra.length > 0 ? (
                            <div style={{ marginTop: 8 }}>
                              <span className="muted" style={{ fontSize: '0.8rem' }}>
                                Extra entries (from older setup):
                              </span>
                              <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {split.extra.map((id) => (
                                  <button key={id} type="button" onClick={() => removeUserExtraTab(email, id)}>
                                    {id} ✕
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </td>
                        <td style={{ verticalAlign: 'top' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <input
                              type="checkbox"
                              checked={split.full}
                              onChange={(e) => setUserFull(email, e.target.checked)}
                            />
                            Full access to everything
                          </label>
                          {!split.full ? (
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                                gap: '6px 12px',
                              }}
                            >
                              {knownIds.map((id) => (
                                <label key={id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.88rem' }}>
                                  <input
                                    type="checkbox"
                                    checked={split.known.has(id)}
                                    onChange={(e) => toggleUserTab(email, id, e.target.checked)}
                                  />
                                  <span>{labelForAccessKey(id)}</span>
                                </label>
                              ))}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {mode === 'json' ? (
        <label style={{ width: '100%', alignItems: 'flex-start' }}>
          <span className="muted" style={{ fontSize: '0.85rem', display: 'block', marginBottom: 6 }}>
            For copying settings between environments or large lists. Invalid JSON will not save.
          </span>
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            rows={18}
            style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
            spellCheck={false}
          />
        </label>
      ) : null}

      <div className="adminSaveBar">
        <button
          type="button"
          className="primary"
          disabled={saveMut.isPending || rulesQ.isLoading || (mode === 'visual' && knownIds.length === 0)}
          onClick={() => (mode === 'json' ? applySaveJson() : applySaveRules(rules))}
        >
          {saveMut.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
