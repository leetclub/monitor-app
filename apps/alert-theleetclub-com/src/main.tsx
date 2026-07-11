import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import './styles.css';
import './styles/stitch-shell.css';
import './styles/ops-surfaces.css';
import './styles/alert-tables.css';
import './styles/info-tip.css';
import './styles/ops-view-toggle.css';
import './styles/ops-fleet-table.css';
import './styles/cleaning-status-cell.css';
import './styles/sales-stack.css';
import './styles/alert-modal-cinematic.css';
import './styles/target-qa-operator.css';
import './styles/qa-visit-page.css';
import './styles/ops-cell-boxes.css';
import './styles/ops-revenue-totals.css';
import './styles/data-freshness.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);

