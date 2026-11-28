import { type Href, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isReportStatus, parseReportDuration, signIn, signOut, startSession, useSignedIn, verifyCode } from './api';
import { AppLink, Brand, Feedback, Icon, Nav, errorMessage, useResource } from './ui.web';

function returnDestination(value: unknown): Href | null {
  if (typeof value !== 'string') return null;
  if (['/contact', '/messages', '/vehicles', '/proposals', '/proposals/new'].includes(value) ||
    /^\/messages\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return value as Href;
  return null;
}

const subscribeToHydration = () => () => {};

export default function Account() {
  const { station, charger, status, durationMinutes, returnTo } = useLocalSearchParams<{
    station?: string; charger?: string; status?: string; durationMinutes?: string; returnTo?: string;
  }>();
  const duration = status === 'occupied' ? parseReportDuration(durationMinutes) : undefined;
  const report = station && charger && isReportStatus(status)
    ? { pathname: '/stations/[id]/report' as const, params: {
      id: station, charger, status, ...(duration === undefined ? {} : { durationMinutes: String(duration) }),
    } } : null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const signedIn = useSignedIn();
  const ready = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const destination = report ?? returnDestination(returnTo);
  const profile = useResource<{ name: string; email: string }>('/account/profile', true);
  const flight = useRef<AbortController | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => flight.current?.abort(), []);
  useEffect(() => { if (challenge) codeInput.current?.focus(); }, [challenge]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (flight.current) return;
    const controller = new AbortController();
    flight.current = controller;
    setPending(true);
    setError('');
    try {
      const result = challenge ? await verifyCode(code, challenge, controller.signal) : await signIn(email.trim(), password, controller.signal);
      if (controller.signal.aborted) return;
      if ('requiresTwoFactor' in result) {
        setChallenge(result.challengeId);
        setPassword('');
      } else {
        startSession(result);
        router.replace(destination ?? '/');
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      flight.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }
  async function logout() {
    setPending(true);
    setError('');
    try { await signOut(); router.replace('/'); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setPending(false); }
  }
  return <main className="bp-shell bp-page-shell bp-account">
    <header className="bp-header"><Brand /><Nav account /></header>
    <div className="bp-page-content bp-page-narrow">
      <AppLink href={report ?? '/'} className="bp-text bp-page-back"><Icon name="back" />{report ? 'Back to report' : 'Back to map'}</AppLink>
      <h1 className="bp-page-title" id="bp-account-title">{signedIn ? 'Account' : challenge ? 'Verify your sign-in' : 'Sign in'}</h1>
      <section className="bp-page-surface" aria-labelledby="bp-account-title">
        {signedIn ? <div className="bp-form">
          {profile.data ? <div className="bp-account-profile">
            <span className="bp-account-avatar"><Icon name="user" /></span>
            <div><strong>{profile.data.name}</strong><p className="bp-muted">{profile.data.email}</p></div>
          </div> :
            <Feedback error={profile.error} retry={profile.retry} loading="Loading profile…" />}
          {destination && <AppLink href={destination} className="bp-primary">{report ? 'Continue report' : 'Continue'}</AppLink>}
          <div className="bp-account-links">
            <AppLink href={'/vehicles' as Href} className="bp-secondary">My vehicles</AppLink>
            <AppLink href={'/proposals' as Href} className="bp-secondary">My proposals</AppLink>
          </div>
          <button className="bp-text bp-account-signout" disabled={pending} onClick={logout}>Sign out</button>
          {error && <p className="bp-error" role="alert">{error}</p>}
        </div> : <form className="bp-form" onSubmit={submit}>
          {report && <p className="bp-muted">Sign in to submit your charger report.</p>}
          {challenge ? <label>Authenticator code<input ref={codeInput} required type="text" inputMode="numeric" autoComplete="one-time-code"
            pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value)} /></label> : <>
            <label>Email<input required type="email" autoComplete="username" placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)} /></label>
            <label>Password<input required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
          </>}
          {error && <p className="bp-error" role="alert">{error}</p>}
          <button className="bp-primary" disabled={!ready || pending} type="submit">{!ready || pending ? 'Please wait…' : challenge ? 'Verify code' : 'Sign in'}</button>
          {challenge && <button disabled={pending} className="bp-text" type="button" onClick={() => { setChallenge(''); setCode(''); setError(''); }}>Use email and password</button>}
        </form>}
      </section>
    </div>
  </main>;
}
