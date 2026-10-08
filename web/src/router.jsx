import { createBrowserRouter, redirect } from 'react-router';
import { AppShell, RouteError, ShellFallback } from './layout/AppShell.jsx';
import { api, get } from './lib/api.js';
import { Analytics, analyticsLoader } from './pages/Analytics.jsx';
import { Campaigns, campaignsLoader } from './pages/Campaigns.jsx';
import { Creatives, creativesLoader } from './pages/Creatives.jsx';
import { Domains, domainsLoader } from './pages/Domains.jsx';
import { Overview, overviewLoader } from './pages/Overview.jsx';
import { ApiKeys, AuditLog, Ingestion, Members, Settings, Sizes, auditLoader, ingestLoader, keysLoader, membersLoader, sizesLoader } from './pages/Settings.jsx';
import { SignIn } from './pages/SignIn.jsx';
import { Snippet } from './pages/Snippet.jsx';

// Signed-out visitors go to the sign-in page and come back afterwards.
async function rootLoader({ request }) {
  try {
    return await get(api('/me'));
  } catch (error) {
    if (error.response?.status === 401) {
      const url = new URL(request.url);
      const returnTo = url.pathname + url.search;
      throw redirect(returnTo === '/' ? '/login' : `/login?returnTo=${encodeURIComponent(returnTo)}`);
    }
    throw error;
  }
}

export const router = createBrowserRouter([
  { path: '/login', element: <SignIn /> },
  {
    id: 'root',
    path: '/',
    loader: rootLoader,
    element: <AppShell />,
    errorElement: <RouteError />,
    HydrateFallback: ShellFallback,
    // The signed-in user rarely changes; skip refetching it on every navigation.
    shouldRevalidate: ({ formMethod }) => Boolean(formMethod),
    children: [
      {
        errorElement: <RouteError inline />,
        children: [
          { index: true, loader: overviewLoader, element: <Overview /> },
          { path: 'campaigns', loader: campaignsLoader, element: <Campaigns /> },
          { path: 'creatives', loader: creativesLoader, element: <Creatives /> },
          { path: 'analytics', loader: analyticsLoader, element: <Analytics /> },
          { path: 'domains', loader: domainsLoader, element: <Domains /> },
          { path: 'snippet', element: <Snippet /> },
          {
            path: 'settings',
            element: <Settings />,
            children: [
              { index: true, loader: () => redirect('/settings/members') },
              { path: 'members', loader: membersLoader, element: <Members /> },
              { path: 'sizes', loader: sizesLoader, element: <Sizes /> },
              { path: 'keys', loader: keysLoader, element: <ApiKeys /> },
              { path: 'ingestion', loader: ingestLoader, element: <Ingestion /> },
              { path: 'audit', loader: auditLoader, element: <AuditLog /> },
            ],
          },
          { path: '*', element: <RouteError inline notFound /> },
        ],
      },
    ],
  },
]);
