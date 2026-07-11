import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

export type SlackUserMapResponse = {
  map?: Record<string, string>;
  teamId?: string;
  error?: string;
};

export function useSlackUserMap() {
  return useQuery({
    queryKey: ['alert-slack-user-map'],
    queryFn: () => apiGet<SlackUserMapResponse>('/api/alert/slack-user-map'),
    staleTime: 30 * 60_000,
    refetchInterval: 30 * 60_000,
  });
}
