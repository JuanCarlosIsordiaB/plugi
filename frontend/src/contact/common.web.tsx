import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useSessionVersion } from '../charging/api';
import { AppLink, Brand, Icon, Nav, errorMessage } from '../charging/ui.web';

export function ContactPage({ title, path, children, introduction, backToMessages }: {
  title: string; path: string; children: ReactNode; introduction: string; backToMessages?: boolean;
}) {
  const session = useSessionVersion();
  const vehicles = path === '/vehicles';
  return <main className="bp-shell bp-page-shell">
    <header className="bp-header"><Brand /><Nav account={vehicles} messages={!vehicles} /></header>
    <div className={'bp-page-content bc-page' + (vehicles ? ' bc-page-garage' : path === '/contact' ? ' bc-page-lookup' : '')}>
      <div className="bc-page-heading">
        {session && backToMessages && <AppLink href="/messages" className="bp-text bp-page-back"><Icon name="back" />Back to messages</AppLink>}
        <h1 className="bp-page-title">{title}</h1>
      </div>
      {session ? <div key={session} className="bc-content">{children}</div> : <section className="bp-page-surface bc-card bc-sign-in">
        <p>{introduction}</p>
        <AppLink className="bp-primary" href={{ pathname: '/login', params: { returnTo: path } }}>Sign in</AppLink>
      </section>}
    </div>
  </main>;
}

export function useAction() {
  const flight = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => flight.current?.abort(), []);
  async function run<T>(operation: (signal: AbortSignal) => Promise<T>, complete: (result: T) => void) {
    if (flight.current) return;
    const controller = new AbortController();
    flight.current = controller;
    setPending(true);
    setError('');
    try {
      const result = await operation(controller.signal);
      if (!controller.signal.aborted) complete(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      flight.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }
  return { run, pending, error, clearError: () => setError('') };
}

export function normalizeIdentifier(value: string) {
  return value.trim().toUpperCase().replace(/[ -]/g, '');
}

export const identifierFields = {
  plate: {
    label: 'License plate',
    pattern: String.raw`[ \-]*([a-zA-Z0-9][ \-]*){1,12}`,
    title: 'Use 1 to 12 letters or numbers. Spaces and hyphens are allowed.',
  },
  vin: {
    label: 'Vehicle identification number (VIN)',
    pattern: String.raw`[ \-]*([a-hj-npr-zA-HJ-NPR-Z0-9][ \-]*){17}`,
    title: 'Enter 17 VIN characters. I, O and Q are excluded.',
  },
};

export function MessageField({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
  const id = useId();
  const hint = id + '-hint';
  return <div className="bc-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} required name="message" value={value} maxLength={500} onChange={event => onChange(event.target.value)}
      pattern={String.raw`.*\S.*`} title="Enter a plain-text charging message." aria-describedby={hint} />
    <span id={hint} className="bp-muted bc-hint">Plain text, up to 500 characters. Leave out links.</span>
  </div>;
}
