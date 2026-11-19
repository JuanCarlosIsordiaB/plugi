import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useSessionVersion } from '../charging/api';
import { AppLink, Brand, Nav, errorMessage } from '../charging/ui.web';
import './styles.css';

export function ContactPage({ title, path, children, introduction }: {
  title: string; path: string; children: ReactNode; introduction: string;
}) {
  const session = useSessionVersion();
  return <main className="bp-shell bp-account">
    <header className="bp-header"><Brand /><Nav account={path === '/vehicles'} messages={path !== '/vehicles'} /></header>
    <div className="bc-page">
      <h1>{title}</h1>
      {session ? <div key={session} className="bc-content">{children}</div> : <section className="bc-card">
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

export type Plate = { plate: string; plateCountry: string; plateRegion: string };
export type VehicleInput = Plate & { vin: string };

export function readIdentifier(form: HTMLFormElement) {
  const data = new FormData(form);
  const field = (name: string) => String(data.get(name) ?? '').trim().toUpperCase().replace(/[ -]/g, '');
  return { vin: field('vin'), plate: field('plate'), plateCountry: field('plateCountry'), plateRegion: field('plateRegion') };
}

export function IdentifierFields({ method }: { method: 'vin' | 'plate' | 'both' }) {
  return <>
    {method !== 'vin' && <>
      <label>License plate<input name="plate" required autoCapitalize="characters" maxLength={48}
        pattern={String.raw`[ \-]*([a-zA-Z0-9][ \-]*){1,12}`} title="Use 1 to 12 letters or numbers. Spaces and hyphens are allowed." /></label>
      <div className="bc-columns">
        <label>Country code<input name="plateCountry" required autoCapitalize="characters" maxLength={2}
          pattern="[a-zA-Z]{2}" title="Enter the two-letter issuing country code." placeholder="e.g. MX" /></label>
        <label>Issuing region code<input name="plateRegion" required autoCapitalize="characters" maxLength={48}
          pattern={String.raw`[ \-]*([a-zA-Z0-9][ \-]*){1,12}`} title="Use 1 to 12 letters or numbers." placeholder="e.g. JAL" /></label>
      </div>
    </>}
    {method !== 'plate' && <label>Vehicle identification number (VIN)<input name="vin" required
      autoCapitalize="characters" maxLength={48} pattern={String.raw`[ \-]*([a-hj-npr-zA-HJ-NPR-Z0-9][ \-]*){17}`}
      title="Enter 17 VIN characters. I, O and Q are excluded." /></label>}
  </>;
}

export function MessageField({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
  return <label>{label}<input required name="message" value={value} maxLength={500} onChange={event => onChange(event.target.value)}
    pattern={String.raw`.*\S.*`} title="Enter a plain-text charging message." />
    <span className="bp-muted bc-hint">Plain text, up to 500 characters. Leave out links.</span>
  </label>;
}
