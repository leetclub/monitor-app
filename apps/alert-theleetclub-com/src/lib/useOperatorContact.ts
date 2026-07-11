import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

export type OperatorContactApi = {
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  whatsappUrl?: string | null;
  slackUserId?: string | null;
  slackTeamId?: string | null;
  slackDmUrl?: string | null;
  slackAppUrl?: string | null;
  slackSource?: string | null;
  error?: string | null;
};

export function useOperatorContact(opts: {
  email?: string | null;
  name?: string | null;
  machineId?: string | null;
  enabled?: boolean;
}) {
  const email = String(opts.email || '').trim();
  const name = String(opts.name || '').trim();
  const machineId = String(opts.machineId || '').trim();
  const enabled = opts.enabled !== false && Boolean(email || name || machineId);

  return useQuery({
    queryKey: ['alert-operator-contact', email, name, machineId],
    queryFn: () => {
      const q = new URLSearchParams();
      if (email) q.set('email', email);
      if (name) q.set('name', name);
      if (machineId) q.set('machineId', machineId);
      return apiGet<OperatorContactApi>(`/api/alert/operator-contact?${q.toString()}`);
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}
