import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { fetchQaManualSummaryAdmin, saveQaManualSummary } from '@/lib/leetWorkflowApi';
import { countBulletLines, validateBulletSummary } from '@/lib/qaManualSummary';
import { formatKuwaitDateTime } from '@/lib/formatKuwait';
import { HelpTip } from '@/components/HelpTip';
import { MachineIdSearchSelect } from '@/components/MachineSearchSelect';

type MachineRow = { id: string; name: string };

const BULLET_PLACEHOLDER = `- Key finding one
- Key finding two
- Key finding three`;

export function QaVisitAdminSection() {
  const qc = useQueryClient();
  const [machineId, setMachineId] = useState('');
  const [summary, setSummary] = useState('');
  const [formErr, setFormErr] = useState<string | null>(null);

  const machinesQ = useQuery({
    queryKey: ['alert-machines'],
    queryFn: () => apiGet<{ machines: MachineRow[] }>('/api/alert/machines'),
  });

  const machines = machinesQ.data?.machines ?? [];
  const machineName = useMemo(
    () => machines.find((m) => m.id === machineId)?.name ?? '',
    [machines, machineId],
  );

  const adminQ = useQuery({
    queryKey: ['alert-admin-qa-manual-summaries', machineName],
    queryFn: () => fetchQaManualSummaryAdmin(machineName),
    enabled: Boolean(machineName),
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const err = validateBulletSummary(summary);
      if (err) throw new Error(err);
      if (!machineName) throw new Error('Choose a machine');
      return saveQaManualSummary({ machineName, summary: summary.trim() });
    },
    onSuccess: async () => {
      setFormErr(null);
      setSummary('');
      await qc.invalidateQueries({ queryKey: ['alert-admin-qa-manual-summaries', machineName] });
      await qc.invalidateQueries({ queryKey: ['alert-qa-manual-summary', machineName] });
      await qc.invalidateQueries({ queryKey: ['alert-qa-summary'] });
    },
    onError: (ex: Error) => setFormErr(ex.message),
  });

  const monthCount = adminQ.data?.monthCount ?? 0;
  const yearMonth = adminQ.data?.yearMonth ?? '';
  const monthRows = adminQ.data?.rows ?? [];
  const bulletCount = countBulletLines(summary);
  const bulletValidationErr = summary.trim() ? validateBulletSummary(summary) : null;
  const canSave = Boolean(summary.trim()) && !bulletValidationErr && !saveMut.isPending;

  return (
    <div className="adminCard adminCardFlush">
      <div className="adminCardHeadRow">
        <h2 className="adminCardTitle">QA visit summary</h2>
        <HelpTip text="Enter 3–5 bullet-point summaries after QA visits (each line must start with -, •, *, or 1.). The latest summary appears in the QA popup on Red Flags and Overall. Count resets each calendar month (Asia/Kuwait)." />
      </div>

      {formErr || saveMut.isError ? (
        <div className="pillDanger" style={{ marginBottom: 12 }}>
          {formErr || (saveMut.error as Error)?.message}
        </div>
      ) : null}

      <div className="adminGroup">
        <div className="adminGroupLabel">Machine</div>
        <div className="adminFieldCell" style={{ maxWidth: 420 }}>
          <MachineIdSearchSelect
            aria-label="Machine"
            machines={machines}
            value={machineId}
            placeholder="Type to search, then pick…"
            disabled={machinesQ.isLoading}
            onChange={(id) => {
              setMachineId(id);
              setFormErr(null);
            }}
          />
        </div>
        {machinesQ.isError ? (
          <p className="muted">Could not load machines: {(machinesQ.error as Error).message}</p>
        ) : null}
      </div>

      {machineName ? (
        <>
          <div className="adminGroup">
            <div className="adminGroupLabel adminGroupLabelRow">
              Summary (bullets required)
              <HelpTip text="Enter 3–5 bullets. Every non-empty line must start with -, •, *, or a numbered list (1. or 1)). Saving adds one to this machine's count for the current month." />
            </div>
            <textarea
              value={summary}
              onChange={(e) => {
                setSummary(e.target.value);
                setFormErr(null);
              }}
              rows={8}
              placeholder={BULLET_PLACEHOLDER}
              style={{ width: '100%', fontFamily: 'inherit', fontSize: '0.95rem' }}
              aria-describedby="qa-bullet-hint"
            />
            <p
              id="qa-bullet-hint"
              className={bulletValidationErr ? 'pillDanger' : 'muted'}
              style={{ margin: '8px 0 0', fontSize: '0.88rem' }}
            >
              {bulletValidationErr
                ? bulletValidationErr
                : bulletCount
                  ? `${bulletCount} bullet${bulletCount === 1 ? '' : 's'} · need 3–5 to save`
                  : 'Enter 3–5 bullet lines (each starts with -, •, *, or 1.)'}
            </p>
            <div className="adminSaveBar" style={{ borderTop: 'none', paddingTop: 12 }}>
              <button
                type="button"
                className="primary"
                disabled={!canSave}
                onClick={() => {
                  const err = validateBulletSummary(summary);
                  if (err) {
                    setFormErr(err);
                    return;
                  }
                  saveMut.mutate();
                }}
              >
                {saveMut.isPending ? 'Saving…' : 'Save summary'}
              </button>
              {saveMut.isSuccess ? <span className="muted">Saved.</span> : null}
            </div>
          </div>

          <div className="adminGroup">
            <div className="adminGroupLabel">
              This month{yearMonth ? ` (${yearMonth})` : ''}
            </div>
            {adminQ.isLoading ? <p className="muted">Loading…</p> : null}
            {adminQ.isError ? (
              <p className="muted">{(adminQ.error as Error).message}</p>
            ) : (
              <p style={{ margin: '0 0 12px' }}>
                <span className="chip">{monthCount} saved this month</span>
              </p>
            )}
            {monthRows.length ? (
              <div className="tableWrap tableWrapBounded">
                <table>
                  <thead>
                    <tr>
                      <th>Saved</th>
                      <th>By</th>
                      <th>Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthRows.map((r) => (
                      <tr key={r.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {r.savedAt ? formatKuwaitDateTime(r.savedAt) : '—'}
                        </td>
                        <td>{r.savedBy || '—'}</td>
                        <td style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>{r.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : machineName && !adminQ.isLoading ? (
              <p className="muted">No summaries saved this month for this machine.</p>
            ) : null}
          </div>
        </>
      ) : (
        <p className="muted">Select a machine to enter a QA visit summary.</p>
      )}
    </div>
  );
}
