import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { AccessProvider } from '@/context/AccessContext';
import { Layout } from '@/components/Layout';
import { DefaultTabRedirect } from '@/pages/DefaultTabRedirect';
import { TabPage } from '@/pages/TabPage';
import { LoginPage } from '@/pages/LoginPage';
import { isMockAccessEnabled } from '@/config/runtimeEnv';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function AppRoutes() {
  const { user } = useAuth();
  const mock = isMockAccessEnabled();

  if (!mock && !user) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <AccessProvider userEmail={user?.email ?? null}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<DefaultTabRedirect />} />
            <Route path="tab/:tabId" element={<TabPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AccessProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </QueryClientProvider>
  );
}
