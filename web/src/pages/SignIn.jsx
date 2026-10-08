import { useEffect } from 'react';
import { useSearchParams } from 'react-router';

const MESSAGES = {
  disabled: 'This account has been disabled. Ask an owner for access.',
};

export function SignIn() {
  const [params] = useSearchParams();
  const error = params.get('error');
  const returnTo = params.get('returnTo');
  const href = returnTo ? `/auth/login?returnTo=${encodeURIComponent(returnTo)}` : '/auth/login';

  // Sign-in started from Authometry's app portal arrives here with ?iss=.
  const initiated = params.has('iss');
  useEffect(() => {
    if (initiated) window.location.replace('/auth/login');
  }, [initiated]);

  return (
    <main className="grid min-h-dvh place-items-center bg-background-200 p-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-400 bg-background-100 p-8">
        <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="7" fill="var(--ds-gray-1000)" />
          <path d="M9 21V11h8.5v2.4h-5.7v1.7h4.6a3.4 3.4 0 0 1 0 6.8H9v-2.4h7.2a1 1 0 0 0 0-2H9Z" fill="var(--ds-background-100)" />
          <rect x="20.5" y="11" width="2.6" height="10" rx="1.3" fill="var(--ds-blue)" />
        </svg>
        <h1 className="mt-6 heading-24">Sign in to 55GMS Ads</h1>
        <p className="mt-2 copy-14 text-gray-900">Manage campaigns, creatives, and reporting across every 55GMS domain.</p>
        {error && (
          <p role="alert" className="mt-4 rounded-sm border border-red-border bg-red-soft px-3 py-2 copy-13 text-red-text">
            {MESSAGES[error] || error}
          </p>
        )}
        {/* A plain link: navigation starts the server-side login handler. */}
        <a className="authometry-button mt-6" href={href}>
          <img src="https://authometry.ch3n.cc/brand/authometry-mark.svg" alt="" width="24" height="24" />
          Continue with Authometry
        </a>
        <p className="mt-4 copy-13 text-gray-700">New accounts need approval from an owner before they can open the dashboard.</p>
      </div>
    </main>
  );
}
