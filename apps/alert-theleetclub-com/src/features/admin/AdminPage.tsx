import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiJson } from '@/lib/api';
import { useEffect, useMemo, useState } from 'react';
import { useAccess } from '@/context/AccessContext';
import { getMonitorAppUrl } from '@/config/runtimeEnv';
import { chipLabelForAccessKey, friendlyAccessSummary } from '@/lib/accessLabels';
import { MachineProfileSection } from '@/features/admin/MachineProfileSection';
import { AlertPeopleManager } from '@/features/admin/AlertPeopleManager';
import { HelpTip } from '@/components/HelpTip';

type CleaningScheduleRow = {
  id: number;
  name_pattern: string;
  cleaning_operator: string;
  timezone: string;
  windows: unknown;
  priority: number;
  updated_at?: string | null;
};

type CleaningScheduleListResponse = { rows: CleaningScheduleRow[] };

type AdminTab = 'machines' | 'people' | 'account' | 'advanced';

export function AdminPage() {
  const ac = useAccess();
  const qc = useQueryClient();
  const [tab, setTab] = useState<AdminTab>('machines');

  const [draft, setDraft] = useState({
    name_pattern: '',
    cleaning_operator: '',
    timezone: 'Asia/Kuwait',
    windowsJson: '[{"start":"14:00","end":"15:00"}]',
    priority: 0,
  });

  const schedulesQ = useQuery({
    queryKey: ['alert-admin-cleaning-schedules'],
    queryFn: () => apiGet<CleaningScheduleListResponse>('/api/alert/admin/cleaning-schedules'),
    enabled: tab === 'advanced',
  });

  const upsert = useMutation({
    mutationFn: async () => {
      const windows = JSON.parse(draft.windowsJson) as unknown;
      return apiJson('/api/alert/admin/cleaning-schedules', {
        name_pattern: draft.name_pattern,
        cleaning_operator: draft.cleaning_operator,
        timezone: draft.timezone,
        windows,
        priority: Number(draft.priority) || 0,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['alert-admin-cleaning-schedules'] });
      setDraft((d) => ({ ...d, name_pattern: '', cleaning_operator: '' }));
    },
  });

  const del = useMutation({
    mutationFn: async (id: number) => apiJson(`/api/alert/admin/cleaning-schedules/${id}`, undefined, 'DELETE'),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['alert-admin-cleaning-schedules'] });
    },
  });

  const rows = useMemo(() => schedulesQ.data?.rows || [], [schedulesQ.data]);

  const monitorBase = getMonitorAppUrl();
  const monitorAdminUrl = monitorBase ? `${monitorBase}/tab/admin` : '';
  const canEditOrgAccess = ac.canSeeTab('admin');

  useEffect(() => {
    if (tab === 'people' && !canEditOrgAccess) setTab('account');
  }, [tab, canEditOrgAccess]);

  useEffect(() => {
    const el = document.getElementById('admin-main-panel');
    if (el) el.focus({ preventScroll: true });
  }, [tab]);

  if (ac.isLoading) {
    return <div className="panel">Loading permissions…</div>;
  }
  if (!ac.canSeeTab('leetAlertAdmin')) {
    return (
      <div className="panel">
        <div style={{ fontWeight: 700, marginBottom: 8 }}>No access</div>
        <p className="muted">
          Your account does not include permission to manage Leet Alert settings. Ask an administrator if you believe this
          is a mistake.
        </p>
      </div>
    );
  }

  const navBtn = (key: AdminTab, label: string, hint: string, show = true) =>
    show ? (
      <button
        key={key}
        type="button"
        role="tab"
        aria-selected={tab === key}
        className={tab === key ? 'adminSideNavItem adminSideNavItemActive' : 'adminSideNavItem'}
        onClick={() => setTab(key)}
        title={hint}
      >
        <span className="adminSideNavLabel">{label}</span>
      </button>
    ) : null;

  return (
    <div className="pageShell pageShellWide adminAppRoot">
      <header className="adminAppHeader">
        <div className="adminAppHeaderMain">
          <p className="adminAppEyebrow">Settings</p>
          <h1 className="adminAppTitle">Admin</h1>
          <p className="adminAppTagline">Machines, team access, and your permissions — one place.</p>
        </div>
        <HelpTip text="Machines: vending setup. Who can use Alert: sign-in access. My access: your permissions. Advanced: optional substring rules." />
      </header>

      <div className="adminAppGrid">
        <nav className="adminSideNav" role="tablist" aria-label="Admin sections">
          <p className="adminSideNavHeading">Sections</p>
          {navBtn(
            'machines',
            'Machines',
            'Per-machine profiles — matches workbook Admin columns.',
          )}
          {navBtn(
            'people',
            'Who can use Alert',
            'Control who can open Red Flags, Overall, and this Admin area.',
            canEditOrgAccess,
          )}
          {navBtn('account', 'My access', 'What your signed-in account can do in Leet Alert.')}
          {navBtn(
            'advanced',
            'Advanced',
            'Legacy substring rules — prefer Machines for normal setup.',
          )}

          <details className="adminSideDocsFold">
            <summary title="Repository paths for PDF and workbook mapping">Documentation map</summary>
            <p className="adminSideDocsBody muted">
              Routes &amp; permissions: <code className="adminInlineCode">PRODUCT-PROTOTYPE.md</code> /{' '}
              <code className="adminInlineCode">PRODUCT-PROTOTYPE.pdf</code>. Column mapping:{' '}
              <code className="adminInlineCode">docs/alert-workbook-admin-tab.md</code>.
            </p>
          </details>
        </nav>

        <main className="adminAppMain" id="admin-main-panel" tabIndex={-1}>
          {tab === 'machines' ? <MachineProfileSection /> : null}

          {tab === 'account' ? (
            <div className="adminCard adminCardFlush">
              <div className="adminCardHeadRow">
                <h2 className="adminCardTitle">My access</h2>
                <HelpTip text="Summary of permissions for your signed-in email. To change org-wide access, use Who can use Alert (if you have org admin) or ask your Monitor administrator." />
              </div>
              {ac.fullAccess ? (
                <p style={{ margin: '0 0 12px', fontSize: '0.95rem' }}>
                  <span className="chip">Full access</span>
                </p>
              ) : (
                <>
                  <ul className="muted" style={{ margin: '0 0 14px', paddingLeft: '1.25rem', lineHeight: 1.6, fontSize: '0.95rem' }}>
                    {friendlyAccessSummary(ac.allowedTabs, ac.fullAccess).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  {ac.allowedTabs.length > 0 ? (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                        {ac.allowedTabs.map((id) => (
                          <span key={id} className="chip">
                            {chipLabelForAccessKey(id)}
                          </span>
                        ))}
                        <HelpTip text="Short labels for each permission key granted to you." />
                      </div>
                    </div>
                  ) : null}
                </>
              )}

              <div className="adminSaveBar adminSaveBarQuiet" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
                {canEditOrgAccess && monitorAdminUrl ? (
                  <a
                    href={monitorAdminUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="adminQuietLink"
                    title="Opens the full Monitor web app with additional dashboards"
                  >
                    Open Monitor
                  </a>
                ) : null}
                {canEditOrgAccess && !monitorAdminUrl ? (
                  <span className="muted adminQuietNote" title="Deployment can expose MONITOR_APP_URL for a shortcut">
                    Monitor link not configured
                  </span>
                ) : null}
                {!canEditOrgAccess ? (
                  <span className="muted adminQuietNote" title="Ask an org admin to grant access via Who can use Alert or Monitor">
                    Need access changes? Ask your administrator.
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {tab === 'people' && canEditOrgAccess ? <AlertPeopleManager /> : null}

          {tab === 'advanced' ? (
            <div className="adminCard adminCardFlush">
              <div className="adminCardHeadRow">
                <h2 className="adminCardTitle">Substring rules (legacy)</h2>
                <HelpTip text="Use only for partial machine name matches across many assets. Normal setup: Machines tab with exact Vendon machine names." />
              </div>

              <div className="adminGroup">
                <div className="adminGroupLabel">New rule</div>
                <div className="row">
                  <label title="Substring of machine name">
                    Name contains
                    <input
                      value={draft.name_pattern}
                      onChange={(e) => setDraft((d) => ({ ...d, name_pattern: e.target.value }))}
                      placeholder="e.g. farwaniya"
                    />
                  </label>
                  <label title="Shown on reports">
                    Operator label
                    <input
                      value={draft.cleaning_operator}
                      onChange={(e) => setDraft((d) => ({ ...d, cleaning_operator: e.target.value }))}
                      placeholder="Name"
                    />
                  </label>
                  <label>
                    Time zone
                    <input
                      value={draft.timezone}
                      onChange={(e) => setDraft((d) => ({ ...d, timezone: e.target.value }))}
                      style={{ width: 140 }}
                    />
                  </label>
                  <label>
                    Priority
                    <input
                      type="number"
                      value={draft.priority}
                      onChange={(e) => setDraft((d) => ({ ...d, priority: Number(e.target.value) }))}
                      style={{ width: 88 }}
                    />
                  </label>
                </div>
                <label style={{ width: '100%', alignItems: 'flex-start', marginTop: 10 }}>
                  Windows (JSON array)
                  <textarea
                    value={draft.windowsJson}
                    onChange={(e) => setDraft((d) => ({ ...d, windowsJson: e.target.value }))}
                    rows={3}
                    style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
                  />
                </label>
                <div className="adminSaveBar" style={{ borderTop: 'none', paddingTop: 12 }}>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => upsert.mutate()}
                    disabled={!draft.name_pattern.trim() || !draft.cleaning_operator.trim() || upsert.isPending}
                  >
                    Save rule
                  </button>
                  {upsert.isError ? (
                    <span className="muted">{(upsert.error as Error).message}</span>
                  ) : null}
                </div>
              </div>

              <div className="adminGroup">
                <div className="adminGroupLabel">Saved rules ({rows.length})</div>
                {schedulesQ.isLoading ? <div className="muted">Loading…</div> : null}
                {schedulesQ.isError ? (
                  <div className="muted">{(schedulesQ.error as Error).message}</div>
                ) : null}
                <div className="tableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Pattern</th>
                        <th>Operator</th>
                        <th>Priority</th>
                        <th>Windows</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <td>{r.name_pattern}</td>
                          <td>{r.cleaning_operator}</td>
                          <td>{r.priority}</td>
                          <td style={{ maxWidth: 320, whiteSpace: 'normal', fontSize: 12 }}>
                            <code>{JSON.stringify(r.windows)}</code>
                          </td>
                          <td>
                            <button type="button" className="danger" onClick={() => del.mutate(r.id)} disabled={del.isPending}>
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                      {rows.length === 0 && !schedulesQ.isLoading ? (
                        <tr>
                          <td colSpan={5} className="muted">
                            No substring rules.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
