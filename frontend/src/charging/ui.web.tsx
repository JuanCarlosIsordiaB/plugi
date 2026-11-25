import { type Href, Link } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, authenticated, request, useSessionVersion, useSignedIn } from './api';

type AnchorProps = React.ComponentProps<'a'>;
function WebAnchor({ children, href, onClick, className, 'aria-label': label, 'aria-current': current, ref }: AnchorProps) {
  // Expo Router supplies both native and browser event handlers to an asChild link.
  return <a href={href} onClick={onClick} className={className} aria-label={label} aria-current={current} ref={ref}>{children}</a>;
}
export function AppLink({ href, ...props }: Omit<AnchorProps, 'href'> & { href: Href }) {
  return <Link asChild href={href}><WebAnchor {...props} /></Link>;
}

export function useResource<T>(path: string | null, requiresSession = false, { retainData = false } = {}) {
  const sessionVersion = useSessionVersion();
  const version = requiresSession ? sessionVersion : 0;
  const activePath = requiresSession && !version ? null : path;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    path: string; attempt: number; version: number; data?: T; error?: string;
    receivedAt?: { monotonic: number; wall: number };
  }>();
  useEffect(() => {
    if (!activePath) return;
    const controller = new AbortController();
    const read = requiresSession ? authenticated<T> : request<T>;
    read(activePath, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setResult({
        path: activePath, attempt, version, data,
        receivedAt: retainData ? { monotonic: performance.now(), wall: Date.now() } : undefined,
      });
    }).catch(error => {
      if (!controller.signal.aborted) setResult(previous => {
        const retained = retainData && previous?.path === activePath && previous.version === version ? previous : undefined;
        return { path: activePath, attempt, version, error: errorMessage(error), data: retained?.data, receivedAt: retained?.receivedAt };
      });
    });
    return () => controller.abort();
  }, [activePath, attempt, requiresSession, retainData, version]);
  const matching = result?.path === activePath && result.version === version ? result : undefined;
  const current = matching?.attempt === attempt ? matching : undefined;
  const retry = useCallback(() => setAttempt(n => n + 1), []);
  const visible = retainData ? matching : current;
  return { data: visible?.data, receivedAt: visible?.receivedAt, error: current?.error, retry, pending: Boolean(activePath && !current) };
}
export function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 429) return error.message + ' Please wait before retrying.';
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
export function Age({ at }: { at: string | null }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  if (!at) return <>No reports yet</>;
  const reported = new Date(at);
  if (!Number.isFinite(reported.getTime())) return <>Time unavailable</>;
  const minutes = Math.max(0, Math.floor((now - reported.getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const age = days >= 7 ? reported.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) :
    days ? days + (days === 1 ? ' day ago' : ' days ago') :
    hours ? hours + (hours === 1 ? ' hour ago' : ' hours ago') : minutes ? minutes + ' min ago' : 'just now';
  return <time dateTime={at} title={reported.toLocaleString()}>{age}</time>;
}
export function Icon({ name }: { name: 'back' | 'brand' | 'map' | 'search' | 'user' | 'close' }) {
  return <img className="bp-icon" src={'/icons/' + name + '.svg'} alt="" />;
}
export function Brand() {
  return <AppLink href="/" className="bp-brand"><Icon name="brand" />buscaPila</AppLink>;
}
export function Nav({ account = false, messages = false, showAccountSettings = true }: {
  account?: boolean;
  messages?: boolean;
  showAccountSettings?: boolean;
}) {
  const signedIn = useSignedIn();
  const hasSettingsLink = signedIn && showAccountSettings;
  return <>
    <nav className="bp-nav" aria-label="Main navigation">
      <AppLink href="/" aria-current={!account && !messages ? 'page' : undefined}><Icon name="map" />Map</AppLink>
      <AppLink href={signedIn ? '/messages' as Href : { pathname: '/login', params: { returnTo: '/messages' } }} aria-current={messages ? 'page' : undefined}>
        <svg className="bp-icon" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#0a604d" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 4.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-6.5 4v-4A2 2 0 0 1 3 15.5v-9a2 2 0 0 1 2-2Z" />
        </svg>Messages</AppLink>
      {!hasSettingsLink && <AppLink href="/login" aria-current={account ? 'page' : undefined}>
        <Icon name="user" />{signedIn ? 'Account' : 'Sign in'}
      </AppLink>}
    </nav>
    {hasSettingsLink && <AppLink href="/login" className="bp-square bp-account-settings" aria-label="Account settings"
      aria-current={account ? 'page' : undefined}>
      <svg className="bp-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
        strokeLinejoin="round" aria-hidden="true">
        <path d="M10 3h4l.4 2.2 1.9 1.1 2.1-.8 2 3.5-1.7 1.4v2.2l1.7 1.4-2 3.5-2.1-.8-1.9 1.1L14 20h-4l-.4-2.2-1.9-1.1-2.1.8-2-3.5 1.7-1.4v-2.2L3.6 9l2-3.5 2.1.8 1.9-1.1L10 3Z" />
        <circle cx="12" cy="11.5" r="3" />
      </svg>
    </AppLink>}
  </>;
}
export function Feedback({ error, retry, loading }: { error?: string; retry: () => void; loading: string }) {
  return error ? <div className="bp-feedback" role="alert"><p>{error}</p><button className="bp-text" onClick={retry}>Try again</button></div>
    : <p className="bp-muted" role="status">{loading}</p>;
}
export function AvailableCount({ count }: { count: number }) {
  return <span className={'bp-badge ' + (count ? 'available' : 'unreported')}>{count} available</span>;
}
