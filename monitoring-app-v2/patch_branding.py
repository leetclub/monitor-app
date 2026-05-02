"""Apply branding + login route to monitoring-app-v2 (run from repo root)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent

LOGIN_PAGE = '''import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [pngOk, setPngOk] = useState(true);

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        {pngOk ? (
          <img
            className={styles.hero}
            src="/leet.png"
            alt=""
            width={200}
            height={200}
            onError={() => setPngOk(false)}
          />
        ) : (
          <img
            className={styles.hero}
            src="/leet.svg"
            alt=""
            width={180}
            height={180}
          />
        )}
        <h1 className={styles.title}>Leet Monitor</h1>
        <p className={styles.sub}>Sign in to continue</p>
        <button
          type="button"
          className={styles.primary}
          onClick={() => {
            signIn();
            navigate('/', { replace: true });
          }}
        >
          Sign in
        </button>
      </div>
    </div>
  );
}
'''

LOGIN_CSS = '''.wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: radial-gradient(ellipse at top, rgba(14, 165, 233, 0.12), transparent 50%),
    var(--bg);
}

.card {
  width: 100%;
  max-width: 22rem;
  padding: 2rem 1.75rem;
  border-radius: 1rem;
  border: 1px solid var(--border);
  background: var(--panel);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.75rem;
}

.hero {
  width: 200px;
  height: 200px;
  object-fit: contain;
  border-radius: 0.75rem;
}

.title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.sub {
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
}

.primary {
  margin-top: 0.5rem;
  font: inherit;
  cursor: pointer;
  border: none;
  border-radius: 0.5rem;
  background: var(--accent);
  color: white;
  padding: 0.55rem 1.25rem;
  font-weight: 600;
  font-size: 0.95rem;
}

.primary:hover {
  filter: brightness(1.08);
}
'''

APP = '''import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
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
'''

LEET_SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="14" fill="#0f172a"/>
  <path fill="url(#g)" d="M18 16h8v32h-8V16zm12 0h8v20h-8V16zm12 0h8v32h-8V16z"/>
  <defs>
    <linearGradient id="g" x1="18" y1="16" x2="46" y2="48" gradientUnits="userSpaceOnUse">
      <stop stop-color="#22d3ee"/>
      <stop offset="1" stop-color="#6366f1"/>
    </linearGradient>
  </defs>
</svg>
'''

INDEX_HTML = '''<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#0f172a" />
    <title>Leet Monitor</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="/config.js"></script>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
'''

LAYOUT_CSS_EXTRA = '''

.logoImg {
  width: 2.5rem;
  height: 2.5rem;
  object-fit: contain;
  border-radius: 0.5rem;
  flex-shrink: 0;
}
'''


def main() -> None:
    (ROOT / 'src/pages/LoginPage.tsx').write_text(LOGIN_PAGE, encoding='utf-8')
    (ROOT / 'src/pages/LoginPage.module.css').write_text(LOGIN_CSS, encoding='utf-8')
    (ROOT / 'src/App.tsx').write_text(APP, encoding='utf-8')
    (ROOT / 'public/leet.svg').write_text(LEET_SVG, encoding='utf-8')
    (ROOT / 'index.html').write_text(INDEX_HTML, encoding='utf-8')

    lc = ROOT / 'src/components/Layout.module.css'
    t = lc.read_text(encoding='utf-8')
    if '.logoImg' not in t:
        lc.write_text(t.rstrip() + '\n' + LAYOUT_CSS_EXTRA, encoding='utf-8')

    print('branding ok')


if __name__ == '__main__':
    main()
