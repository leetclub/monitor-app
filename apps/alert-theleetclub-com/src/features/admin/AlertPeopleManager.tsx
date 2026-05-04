import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchDashboardAccessRules,
  putDashboardAccessRules,
  type DashboardAccessRules,
} from '@/lib/dashboardRulesApi';
import { TeamAccessEditor } from '@/features/admin/TeamAccessEditor';
import { HelpTip } from '@/components/HelpTip';
import { useAccess } from '@/context/AccessContext';

function domainFromEmail(addr: string): string | null {
  const s = addr.trim().toLowerCase();
  const i = s.lastIndexOf('@');
  if (i <= 0 || i === s.length - 1) return null;
  return s.slice(i + 1);
}

function emailMatchesOrgDomains(addr: string, domains: string[]): boolean {
  const d = domainFromEmail(addr);
  if (!d) return false;
  if (!domains.length) return true;
  return domains.includes(d);
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

function hasFullAccess(tabs: string[]): boolean {
  return tabs.includes('*');
}

/** Keep non-Alert grants; strip Alert keys so we can re-apply view/manage. */
function stripAlertKeys(tabs: string[]): string[] {
  return tabs.filter((t) => t !== 'leetAlert' && t !== 'leetAlertAdmin');
}

function mergeAlertKeys(baseTabs: string[], view: boolean, manage: boolean): string[] {
  if (hasFullAccess(baseTabs)) return ['*'];
  const base = stripAlertKeys(baseTabs);
  if (manage) return uniqStrings([...base, 'leetAlert', 'leetAlertAdmin']);
  if (view) return uniqStrings([...base, 'leetAlert']);
  return base;
}

/** Leet Alert keys only (no *), for this app’s main flow. */
function alertOnlyTabs(view: boolean, manage: boolean): string[] {
  return mergeAlertKeys([], view, manage);
}

function alertViewFromTabs(tabs: string[]): boolean {
  return hasFullAccess(tabs) || tabs.includes('leetAlert');
}

function alertManageFromTabs(tabs: string[]): boolean {
  return hasFullAccess(tabs) || tabs.includes('leetAlertAdmin');
}

export function AlertPeopleManager() {
  const qc = useQueryClient();
  const { allowedEmailDomains: accessDomains } = useAccess();
  const [rules, setRules] = useState<DashboardAccessRules>({ defaultTabs: [], users: {} });
  const [newEmail, setNewEmail] = useState('');
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const rulesQ = useQuery({
    queryKey: ['dashboard-access', 'rules'],
    queryFn: fetchDashboardAccessRules,
  });

  const allowedEmailDomains = useMemo(() => {
    const fromRules = rulesQ.data?.allowedEmailDomains;
    if (Array.isArray(fromRules) && fromRules.length > 0) return fromRules;
    return accessDomains;
  }, [rulesQ.data?.allowedEmailDomains, accessDomains]);

  useEffect(() => {
    if (!rulesQ.data) return;
    setRules(normalizeRules(rulesQ.data));
    setSaveErr(null);
  }, [rulesQ.data]);

  const saveMut = useMutation({
    mutationFn: putDashboardAccessRules,
    onSuccess: async () => {
      setSaveErr(null);
      await qc.invalidateQueries({ queryKey: ['dashboard-access'] });
      await qc.invalidateQueries({ queryKey: ['dashboard-access', 'rules'] });
    },
    onError: (e: Error) => setSaveErr(e.message),
  });

  const defaultView = alertViewFromTabs(rules.defaultTabs);
  const defaultManage = alertManageFromTabs(rules.defaultTabs);
  const defaultFull = hasFullAccess(rules.defaultTabs);

  const userRows = useMemo(() => Object.entries(rules.users), [rules.users]);

  const setDefaultsAlert = (view: boolean, manage: boolean) => {
    const next = mergeAlertKeys(rules.defaultTabs, view, manage);
    setRules((r) => ({ ...r, defaultTabs: next }));
  };

  const setUserAlert = (email: string, view: boolean, manage: boolean) => {
    const prev = rules.users[email] ?? [];
    const nextTabs = mergeAlertKeys(prev, view, manage);
    setRules((r) => ({
      ...r,
      users: { ...r.users, [email]: nextTabs },
    }));
  };

  const downgradeUserToAlertOnly = (email: string) => {
    if (
      !confirm(
        'Remove full Monitor access (*) for this person? You can set only Leet Alert (Open / Manage) in this list. You do not need the “Full Monitor access” section below unless you use other Monitor tabs.',
      )
    ) {
      return;
    }
    setRules((r) => ({
      ...r,
      users: { ...r.users, [email]: alertOnlyTabs(true, true) },
    }));
  };

  const downgradeDefaultsToAlertOnly = () => {
    if (
      !confirm(
        'Replace org-wide “full Monitor” defaults with Leet Alert only? New sign-ins will get Open + Manage for this app; you can change the two toggles after.',
      )
    ) {
      return;
    }
    setRules((r) => ({ ...r, defaultTabs: alertOnlyTabs(true, true) }));
  };

  const addPerson = () => {
    const email = newEmail.toLowerCase().trim();
    if (!email || !email.includes('@')) {
      setSaveErr('Enter a valid email.');
      return;
    }
    if (allowedEmailDomains.length > 0 && !emailMatchesOrgDomains(email, allowedEmailDomains)) {
      setSaveErr(
        `Use an address on your Google Workspace domain: @${allowedEmailDomains.join(', @')}.`,
      );
      return;
    }
    if (rules.users[email]) {
      setSaveErr('That email is already in the list.');
      return;
    }
    setSaveErr(null);
    setRules((r) => ({
      ...r,
      users: { ...r.users, [email]: [...r.defaultTabs] },
    }));
    setNewEmail('');
  };

  const removeUser = (email: string) => {
    setRules((r) => {
      const { [email]: _, ...rest } = r.users;
      return { ...r, users: rest };
    });
  };

  const applySave = () => {
    const normalized = normalizeRules(rules);
    if (allowedEmailDomains.length > 0) {
      for (const u of Object.keys(normalized.users)) {
        if (!emailMatchesOrgDomains(u, allowedEmailDomains)) {
          setSaveErr(
            `Save blocked: "${u}" is not on an allowed domain (@${allowedEmailDomains.join(', @')}).`,
          );
          return;
        }
      }
    }
    saveMut.mutate(normalized);
  };

  return (
    <div className="adminManageUsersShell adminManageUsersShellQuiet">
      <header className="adminManageUsersHeader adminManageUsersHeaderCompact">
        <div className="adminManageUsersTitleRow">
          <h2 className="adminManageUsersTitle">Leet Alert access</h2>
          <HelpTip text="Steps 1–2 control only Leet Alert (Red Flags, Overall, Admin here). Full Monitor (*) is separate — switch users below or use the optional grid at the bottom." />
        </div>
      </header>

      <p className="adminAlertScopeIntro muted">
        <strong>Main workflow:</strong> defaults → people list → Save. Use{' '}
        <strong>Open Alert</strong> / <strong>Manage Alert</strong> only. If someone shows “Full Monitor”, click{' '}
        <em>Use Leet Alert only</em> to edit them here without opening the full Monitor grid.
      </p>

      <section className="adminCard adminStepCard">
        <div className="adminStepHead">
          <span className="adminStepNum" aria-hidden>
            1
          </span>
          <div className="adminStepTitleRow">
            <h3 className="adminSectionTitle">Defaults for new sign-ins</h3>
            <HelpTip text="Used the first time an email signs in and is not in the people list yet." />
          </div>
        </div>
        {defaultFull ? (
          <div>
            <p className="muted adminQuietLine" style={{ marginTop: 0 }}>
              Defaults are <strong>full Monitor</strong> (<code className="adminInlineCode">*</code>) — every dashboard tab, not just Alert.
            </p>
            <button type="button" className="btnLink" onClick={downgradeDefaultsToAlertOnly}>
              Switch to Leet Alert–only defaults (open + manage)
            </button>
            <p className="muted adminQuietLine" style={{ marginBottom: 0, fontSize: '0.8rem' }}>
              Optional: open <strong>Full Monitor access</strong> below if you need Events, People analytics, etc.
            </p>
          </div>
        ) : (
          <div className="adminToggleRow">
            <label className="adminToggle" title="Red Flags and Overall">
              <input
                type="checkbox"
                checked={defaultView}
                onChange={(e) => {
                  const v = e.target.checked;
                  if (!v) setDefaultsAlert(false, false);
                  else setDefaultsAlert(true, defaultManage);
                }}
              />
              <span>
                <strong>Open Alert</strong>
              </span>
            </label>
            <label className="adminToggle" title="Includes this Admin area (machines + access)">
              <input
                type="checkbox"
                checked={defaultManage}
                disabled={!defaultView}
                onChange={(e) => {
                  const m = e.target.checked;
                  if (m) setDefaultsAlert(true, true);
                  else setDefaultsAlert(defaultView, false);
                }}
              />
              <span>
                <strong>Manage Alert</strong>
              </span>
            </label>
          </div>
        )}
      </section>

      <section className="adminCard adminStepCard">
        <div className="adminStepHead">
          <span className="adminStepNum" aria-hidden>
            2
          </span>
          <div className="adminStepTitleRow">
            <h3 className="adminSectionTitle">People</h3>
            <HelpTip text="Per-email Leet Alert flags. “Full Monitor” means * — use the link under that email to switch to Alert-only and edit the checkboxes." />
          </div>
        </div>

        {allowedEmailDomains.length > 0 ? (
          <p className="muted adminQuietLine" style={{ marginBottom: 10, fontSize: '0.85rem' }}>
            Only addresses at{' '}
            <strong>@{allowedEmailDomains.join(', @')}</strong> can be added (same organization as Google sign-in).
          </p>
        ) : null}

        <div className="adminAddRow">
          <label className="adminAddEmail">
            Add by email
            <input
              type="email"
              placeholder="name@company.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addPerson();
                }
              }}
            />
          </label>
          <button type="button" className="primary" onClick={addPerson}>
            Add
          </button>
        </div>

        {saveErr ? <p className="pillDanger">{saveErr}</p> : null}
        {rulesQ.isLoading ? <p className="muted">Loading…</p> : null}
        {rulesQ.error ? <p className="pillDanger">{(rulesQ.error as Error).message}</p> : null}

        <div className="tableWrap" style={{ marginTop: 14 }}>
          <table className="adminPeopleTable">
            <thead>
              <tr>
                <th>Email</th>
                <th title="Red Flags + Overall">Can open Alert</th>
                <th title="Includes Admin (machines + this section)">Can manage Alert</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {userRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No one listed yet — only the defaults above apply.
                  </td>
                </tr>
              ) : (
                userRows.map(([email, tabs]) => {
                  const full = hasFullAccess(tabs);
                  const view = alertViewFromTabs(tabs);
                  const manage = alertManageFromTabs(tabs);
                  return (
                    <tr key={email}>
                      <td>
                        <code style={{ fontSize: '0.85rem' }}>{email}</code>
                        {full ? (
                          <div className="adminFullRowMeta">
                            <span className="chipWarn">Full Monitor</span>
                            <button type="button" className="btnLink" onClick={() => downgradeUserToAlertOnly(email)}>
                              Use Leet Alert only
                            </button>
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {full ? (
                          <span className="adminDashCell" title="Remove Full Monitor first — link under email">
                            —
                          </span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={view}
                            onChange={(e) => {
                              const v = e.target.checked;
                              setUserAlert(email, v, v ? manage : false);
                            }}
                          />
                        )}
                      </td>
                      <td>
                        {full ? (
                          <span className="adminDashCell" title="Remove Full Monitor first — link under email">
                            —
                          </span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={manage}
                            disabled={!view}
                            onChange={(e) => setUserAlert(email, view, e.target.checked)}
                          />
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => {
                            if (full && !confirm('This person has full access everywhere. Remove them from the list entirely?')) return;
                            removeUser(email);
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="adminSaveBar">
          <button
            type="button"
            className="primary"
            disabled={saveMut.isPending || rulesQ.isLoading}
            onClick={applySave}
            title="Writes Leet Alert flags only; other Monitor tabs unchanged unless you use step 3"
          >
            {saveMut.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>

      <details className="adminDetails adminDetailsWide adminDetailsAdvanced">
        <summary title="Only when you need tabs outside Leet Alert (Events, People analytics, JSON, …)">
          <span className="adminStepNum adminStepNumInline" aria-hidden>
            3
          </span>{' '}
          Other Monitor dashboards (optional)
        </summary>
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: 10, marginBottom: 14, lineHeight: 1.45 }}>
          Not required for Leet Alert. Use this grid for <strong>full Monitor</strong> (<code className="adminInlineCode">*</code>), extra tabs, or bulk JSON. Most Alert admins only need steps 1–2 above.
        </p>
        <TeamAccessEditor embedded />
      </details>
    </div>
  );
}
