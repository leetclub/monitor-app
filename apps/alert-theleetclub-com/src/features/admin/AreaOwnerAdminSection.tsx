import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiJson } from '@/lib/api';
import { HelpTip } from '@/components/HelpTip';

type VendonUser = { id: string; name: string; email?: string | null; type?: string | null };

type AreaOwnerRow = {
  vendonUserId: string;
  vendonUserName: string;
  machineIds: string[];
  machines: { id: string; name: string }[];
  loginUsername?: string | null;
  hasLogin?: boolean;
  updatedAt?: string | null;
};

type MachineRow = { id: string; name: string };

export function AreaOwnerAdminSection() {
  const qc = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [machineFilter, setMachineFilter] = useState('');
  const [selectedMachines, setSelectedMachines] = useState<Set<string>>(new Set());
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const usersQ = useQuery({
    queryKey: ['alert-admin-vendon-users'],
    queryFn: () => apiGet<{ users: VendonUser[] }>('/api/alert/admin/vendon-users'),
  });
  const machinesQ = useQuery({
    queryKey: ['alert-machines'],
    queryFn: () => apiGet<{ machines: MachineRow[] }>('/api/alert/machines'),
  });
  const areasQ = useQuery({
    queryKey: ['alert-admin-area-owners'],
    queryFn: () => apiGet<{ rows: AreaOwnerRow[] }>('/api/alert/admin/area-owners'),
  });

  const users = usersQ.data?.users ?? [];
  const machines = machinesQ.data?.machines ?? [];
  const areas = areasQ.data?.rows ?? [];

  const selectedUser = users.find((u) => u.id === selectedUserId);
  const selectedArea = areas.find((a) => a.vendonUserId === selectedUserId);

  const filteredMachines = useMemo(() => {
    const q = machineFilter.trim().toLowerCase();
    if (!q) return machines;
    return machines.filter((m) => m.name.toLowerCase().includes(q) || m.id.includes(q));
  }, [machines, machineFilter]);

  const loadArea = (userId: string) => {
    setSelectedUserId(userId);
    const area = areas.find((a) => a.vendonUserId === userId);
    setSelectedMachines(new Set(area?.machineIds ?? []));
    setPassword('');
    setMessage(null);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!selectedUserId || !selectedUser) throw new Error('Choose an area owner');
      const loginUsername = (selectedUser.email || '').trim().toLowerCase();
      if (!selectedArea?.hasLogin && !password.trim() && selectedMachines.size > 0 && loginUsername) {
        throw new Error('Set a password for the Areas login (first time only)');
      }
      return apiJson(`/api/alert/admin/area-owners/${encodeURIComponent(selectedUserId)}`, {
        vendonUserName: selectedUser.name,
        machineIds: [...selectedMachines],
        loginUsername: loginUsername || undefined,
        password: password.trim() || undefined,
      }, 'PUT');
    },
    onSuccess: async () => {
      setMessage('Saved.');
      setPassword('');
      await qc.invalidateQueries({ queryKey: ['alert-admin-area-owners'] });
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (userId: string) =>
      apiJson(`/api/alert/admin/area-owners/${encodeURIComponent(userId)}`, undefined, 'DELETE'),
    onSuccess: async () => {
      setMessage('Removed.');
      setSelectedUserId('');
      setSelectedMachines(new Set());
      setPassword('');
      await qc.invalidateQueries({ queryKey: ['alert-admin-area-owners'] });
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const toggleMachine = (id: string) => {
    setSelectedMachines((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const loading = usersQ.isLoading || machinesQ.isLoading || areasQ.isLoading;

  return (
    <div className="adminCard adminCardFlush">
      <div className="adminCardHeadRow">
        <h2 className="adminCardTitle">Area owners</h2>
        <HelpTip text="Assign Vendon users to machines they own. Used for Targets Areas login and target owner contact on Red Flags." />
      </div>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: '0.88rem', lineHeight: 1.45 }}>
        Pick a Vendon user, select their machines, and optionally set an Areas login password. Same data as the Targets
        Owners tab.
      </p>

      {loading ? <p className="muted">Loading…</p> : null}
      {message ? <p className="adminFormMsg">{message}</p> : null}

      <div className="adminMachineCoreRow" style={{ marginBottom: 14 }}>
        <div className="adminFieldCell">
          <span className="adminFieldCaption">Vendon user</span>
          <select value={selectedUserId} onChange={(e) => loadArea(e.target.value)}>
            <option value="">Select user…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.email ? ` · ${u.email}` : ''}
              </option>
            ))}
          </select>
        </div>
        {selectedUser?.email ? (
          <div className="adminFieldCell">
            <span className="adminFieldCaption">Areas login email</span>
            <input type="email" readOnly value={selectedUser.email} />
          </div>
        ) : null}
        {selectedUserId ? (
          <div className="adminFieldCell">
            <span className="adminFieldCaption">
              {selectedArea?.hasLogin ? 'New password (optional)' : 'Areas password'}
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={selectedArea?.hasLogin ? 'Leave blank to keep' : 'Min 6 characters'}
              autoComplete="new-password"
            />
          </div>
        ) : null}
      </div>

      {selectedUserId ? (
        <>
          <div className="adminFieldCell" style={{ marginBottom: 10 }}>
            <span className="adminFieldCaption">Filter machines</span>
            <input
              value={machineFilter}
              onChange={(e) => setMachineFilter(e.target.value)}
              placeholder="Search name or id"
            />
          </div>
          <div className="adminAreaOwnerMachineGrid">
            {filteredMachines.map((m) => (
              <label key={m.id} className="adminAreaOwnerMachineChip">
                <input
                  type="checkbox"
                  checked={selectedMachines.has(m.id)}
                  onChange={() => toggleMachine(m.id)}
                />
                <span>{m.name}</span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            <button type="button" className="primary" disabled={saveMut.isPending} onClick={() => void saveMut.mutate()}>
              {saveMut.isPending ? 'Saving…' : 'Save area owner'}
            </button>
            {selectedArea ? (
              <button
                type="button"
                className="dangerBtn"
                disabled={deleteMut.isPending}
                onClick={() => {
                  if (window.confirm(`Remove area owner ${selectedUser?.name}?`)) {
                    void deleteMut.mutate(selectedUserId);
                  }
                }}
              >
                Remove
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {areas.length > 0 ? (
        <div style={{ marginTop: 24 }}>
          <h3 className="adminCardTitle" style={{ fontSize: '0.95rem', marginBottom: 8 }}>
            Saved assignments
          </h3>
          <table className="adminSavedTable">
            <thead>
              <tr>
                <th>Owner</th>
                <th>Machines</th>
                <th>Login</th>
              </tr>
            </thead>
            <tbody>
              {areas.map((a) => (
                <tr key={a.vendonUserId}>
                  <td>
                    <button type="button" className="linkGo" onClick={() => loadArea(a.vendonUserId)}>
                      {a.vendonUserName}
                    </button>
                  </td>
                  <td>{a.machineIds.length}</td>
                  <td>{a.hasLogin ? a.loginUsername || 'Yes' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
