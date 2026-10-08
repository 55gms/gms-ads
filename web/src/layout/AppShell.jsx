import { BookOpen, Check, ChevronsUpDown, Clock, LogOut, Monitor, Moon, Search, Sun, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, isRouteErrorResponse, useNavigation, useRouteError } from 'react-router';
import { errorMessage, http } from '../lib/api.js';
import { cx } from '../lib/cx.js';
import { useSession } from '../lib/session.js';
import { setCommandOpen, setTheme, useTheme } from '../lib/stores.js';
import { analyticsLoader } from '../pages/Analytics.jsx';
import { campaignsLoader } from '../pages/Campaigns.jsx';
import { creativesLoader } from '../pages/Creatives.jsx';
import { domainsLoader } from '../pages/Domains.jsx';
import { overviewLoader } from '../pages/Overview.jsx';
import { membersLoader } from '../pages/Settings.jsx';
import { Button } from '../ui/Button.jsx';
import { CommandMenu } from '../ui/CommandMenu.jsx';
import { Floating, Menu } from '../ui/Floating.jsx';
import { Avatar, EmptyState, Skeleton } from '../ui/Misc.jsx';
import { NavTabs, Segmented } from '../ui/Tabs.jsx';
import { Toaster } from '../ui/Toast.jsx';

const TABS = [
  { to: '/', label: 'Overview', loader: overviewLoader },
  { to: '/campaigns', label: 'Campaigns', loader: campaignsLoader },
  { to: '/creatives', label: 'Creatives', loader: creativesLoader },
  { to: '/analytics', label: 'Analytics', loader: analyticsLoader },
  { to: '/domains', label: 'Domains', loader: domainsLoader },
  { to: '/snippet', label: 'Snippet' },
  { to: '/settings', label: 'Settings', loader: membersLoader },
];

// Warms the page's data on hover or focus; the loader then reads it from cache.
const prefetch = (tab) => tab.loader?.({ request: new Request(new URL(tab.to, window.location.origin)) })?.catch?.(() => {});

async function signOut() {
  try {
    const { data } = await http.post('/auth/logout');
    window.location.assign(data.redirect || '/login');
  } catch {
    window.location.assign('/login');
  }
}

function Logo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--ds-gray-1000)" />
      <path d="M9 21V11h8.5v2.4h-5.7v1.7h4.6a3.4 3.4 0 0 1 0 6.8H9v-2.4h7.2a1 1 0 0 0 0-2H9Z" fill="var(--ds-background-100)" />
      <rect x="20.5" y="11" width="2.6" height="10" rx="1.3" fill="var(--ds-blue)" />
    </svg>
  );
}

function AccountMenu({ user }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label="Account menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-9 w-9 place-items-center rounded-full ease-hover hover:bg-gray-alpha-200 max-md:h-11 max-md:w-11"
      >
        <Avatar name={user.name || user.email} src={user.avatar} />
      </button>
      <Floating anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} placement="bottom-end" role="dialog" aria-label="Account" className="w-64">
        <div className="border-b border-gray-400 p-3">
          <p className="truncate copy-14 font-medium">{user.name || 'Signed in'}</p>
          <p className="truncate copy-13 text-gray-900">{user.email}</p>
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-gray-400 p-3">
          <span className="copy-14 text-gray-900">Theme</span>
          <Segmented
            size="sm"
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'system', label: <span className="sr-only">System</span>, icon: Monitor },
              { value: 'light', label: <span className="sr-only">Light</span>, icon: Sun },
              { value: 'dark', label: <span className="sr-only">Dark</span>, icon: Moon },
            ]}
          />
        </div>
        <div className="p-1">
          <button type="button" onClick={signOut} className="flex h-9 w-full items-center gap-2 rounded-sm px-2 copy-14 ease-hover hover:bg-gray-alpha-200 max-md:h-11">
            <LogOut size={16} strokeWidth={1.5} aria-hidden="true" className="text-gray-900" />
            Sign out
          </button>
        </div>
      </Floating>
    </>
  );
}

function TopBar({ user }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <header className={cx('sticky top-0 z-30 border-b bg-background-100 transition-[border-color] duration-[120ms]', scrolled ? 'border-gray-400' : 'border-transparent')}>
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-3 px-4 md:px-6">
        <Link to="/" aria-label="55GMS Ads home" className="rounded-sm">
          <Logo />
        </Link>
        <span aria-hidden="true" className="text-[22px] leading-none font-light text-gray-500 select-none">
          /
        </span>
        <Menu
          label="Project"
          placement="bottom-start"
          trigger={(props) => (
            <button {...props} type="button" className="flex h-8 items-center gap-1.5 rounded-sm pr-1 pl-2 copy-14 font-medium ease-hover hover:bg-gray-alpha-200 max-md:h-11">
              55GMS Ads
              <ChevronsUpDown size={14} strokeWidth={1.5} aria-hidden="true" className="text-gray-700" />
            </button>
          )}
          items={[{ label: '55GMS Ads', icon: Check, onSelect: () => {} }]}
        />
        <div className="ml-auto flex items-center gap-2">
          <Button as={Link} to="/snippet" viewTransition variant="tertiary" size="sm" icon={BookOpen} className="text-gray-900 max-sm:hidden">
            Setup guide
          </Button>
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            aria-label="Open command menu"
            className="flex h-8 items-center gap-2 rounded-sm border border-gray-400 bg-background-100 pr-1.5 pl-2.5 copy-13 text-gray-900 ease-hover hover:border-gray-500 hover:text-gray-1000 max-md:h-11"
          >
            <Search size={14} strokeWidth={1.5} aria-hidden="true" />
            <span className="max-sm:hidden">Search</span>
            <kbd className="rounded-[4px] border border-gray-400 bg-background-200 px-1.5 font-mono copy-12 max-sm:hidden">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
          <AccountMenu user={user} />
        </div>
      </div>
    </header>
  );
}

function Pending({ user }) {
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-400 p-8 text-center">
        <span className="mx-auto mb-4 grid h-10 w-10 place-items-center rounded-md border border-gray-400 text-amber-text">
          <Clock size={20} strokeWidth={1.5} aria-hidden="true" />
        </span>
        <h1 className="heading-20">Waiting for approval</h1>
        <p className="mt-2 copy-14 text-gray-900">
          You are signed in as <span className="text-gray-1000">{user.email || user.name}</span>. An owner or admin needs to approve your account before you can open the dashboard.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={() => window.location.reload()}>Check again</Button>
          <Button variant="tertiary" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}

export function AppShell() {
  const { user } = useSession();
  const navigation = useNavigation();
  const canWrite = ['owner', 'admin'].includes(user.role);

  if (user.status !== 'active') return <Pending user={user} />;

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[90] focus:rounded-sm focus:bg-background-100 focus:px-3 focus:py-2">
        Skip to content
      </a>
      <TopBar user={user} />
      <div className="border-b border-gray-400">
        <div className="mx-auto max-w-[1200px] px-4 md:px-6">
          <NavTabs tabs={TABS} onPrefetch={prefetch} />
        </div>
      </div>
      <main id="main" aria-busy={navigation.state === 'loading'} className="mx-auto max-w-[1200px] px-4 pb-24 md:px-6">
        <Outlet />
      </main>
      <CommandMenu pages={TABS} onSignOut={signOut} canWrite={canWrite} />
      <Toaster />
    </>
  );
}

// First paint while the session loads: the shell's shape, no content.
export function ShellFallback() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-3 px-4 md:px-6">
        <Skeleton className="h-6 w-6" />
        <Skeleton className="h-5 w-28" />
        <Skeleton className="ml-auto h-7 w-7 rounded-full" />
      </div>
      <div className="border-b border-gray-400">
        <div className="mx-auto flex h-12 max-w-[1200px] items-center gap-6 px-4 md:px-6">
          {[72, 84, 76, 72, 68].map((w, i) => (
            <Skeleton key={i} className="h-4" style={{ width: w }} />
          ))}
        </div>
      </div>
      <div className="mx-auto max-w-[1200px] px-4 pt-10 md:px-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="mt-3 h-5 w-80 max-w-full" />
        <div className="mt-8 grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[134px] rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function RouteError({ inline, notFound }) {
  const error = useRouteError();
  const missing = notFound || (isRouteErrorResponse(error) && error.status === 404);
  const body = (
    <EmptyState
      icon={TriangleAlert}
      title={missing ? 'Page not found' : 'This page could not load'}
      description={missing ? 'The link may be out of date.' : errorMessage(error, 'Check your connection and try again.')}
      action={missing ? undefined : { label: 'Try again', onClick: () => window.location.reload() }}
    />
  );
  return inline ? <div className="py-24">{body}</div> : <main className="grid min-h-dvh place-items-center p-4">{body}</main>;
}
