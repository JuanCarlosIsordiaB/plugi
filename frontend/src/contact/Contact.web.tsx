import { type FormEvent, useEffect, useRef, useState } from 'react';
import { authenticated, jsonRequest } from '../charging/api';
import { AppLink } from '../charging/ui.web';
import { ContactPage, identifierFields, MessageField, normalizeIdentifier, useAction } from './common.web';

const suggestedMessage = 'Hello! How much longer will you be charging?';
// Leave a margin for the request to reach the server before its 10-minute token expires.
const plateLookupLifetimeMs = 9 * 60_000 + 55_000;
type LookupMethod = keyof typeof identifierFields;
type LookupResult = { registered: false } | { registered: true; contactToken?: string };
type Target = { vin: string } | { plate: string; contactToken: string; expiresAt: number };

function RequestForm() {
  const [method, setMethod] = useState<LookupMethod>('plate');
  const [identifier, setIdentifier] = useState('');
  const identifierInput = useRef<HTMLInputElement>(null);
  const focusLookup = useRef(false);
  const [target, setTarget] = useState<Target>();
  const [unavailable, setUnavailable] = useState(false);
  const [lookupExpired, setLookupExpired] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState(suggestedMessage);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const lookup = useAction();
  const send = useAction();

  useEffect(() => {
    if (target || accepted) resultHeading.current?.focus();
    if (focusLookup.current && identifierInput.current) {
      identifierInput.current.focus();
      focusLookup.current = false;
    }
  }, [target, accepted, method]);

  function clearLookupFeedback() {
    setUnavailable(false);
    setLookupExpired(false);
    lookup.clearError();
  }

  function chooseMethod(next: LookupMethod) {
    setMethod(next);
    setIdentifier('');
    clearLookupFeedback();
  }

  function lookUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = normalizeIdentifier(identifier);
    const body = method === 'vin' ? { vin: value } : { plate: value };
    clearLookupFeedback();
    const expiresAt = Date.now() + plateLookupLifetimeMs;
    void lookup.run<Target | undefined>(async signal => {
      const result = await authenticated<LookupResult>('/vehicle-contact/lookup', {
        ...jsonRequest('POST', body), signal,
      });
      if (!result.registered) return undefined;
      if (method === 'vin') return { vin: value };
      if (result.contactToken) return { plate: value, contactToken: result.contactToken, expiresAt };
      throw new Error('Plate lookup is temporarily unavailable. Try again or use the VIN.');
    }, match => {
      if (match) setTarget(match);
      else setUnavailable(true);
    });
  }

  function initiate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || !message.trim()) return;
    if ('expiresAt' in target && Date.now() >= target.expiresAt) {
      focusLookup.current = true;
      setTarget(undefined);
      setLookupExpired(true);
      send.clearError();
      return;
    }
    const recipient = 'vin' in target ? { vin: target.vin } : { contactToken: target.contactToken };
    void send.run(signal => authenticated<{ accepted: true }>('/vehicle-contact', {
      ...jsonRequest('POST', { ...recipient, message: message.trim() }), signal,
    }), () => {
      setAccepted(true);
      setTarget(undefined);
      setIdentifier('');
      setMessage(suggestedMessage);
    });
  }

  if (accepted) return <section className="bc-card">
    <h2 ref={resultHeading} tabIndex={-1}>Request accepted</h2>
    <p role="status">If the driver replies, the conversation will appear in Messages.</p>
    <AppLink className="bp-primary" href="/messages">View messages</AppLink>
    <button className="bp-text" onClick={() => {
      focusLookup.current = true;
      setAccepted(false);
    }}>Look up another vehicle</button>
  </section>;
  if (target) return <form className="bp-form bc-card" onSubmit={initiate}>
    <h2 ref={resultHeading} tabIndex={-1}>Write a charging message</h2>
    <p className="bp-muted">{'vin' in target ? 'VIN ending in ' + target.vin.slice(-4) : 'Plate ' + target.plate}</p>
    <fieldset disabled={send.pending}><legend className="bp-screen-reader">Charging message</legend><MessageField label="Message" value={message} onChange={setMessage} /></fieldset>
    {send.error && <p className="bp-error" role="alert">{send.error}</p>}
    <button className="bp-primary" disabled={send.pending}>{send.pending ? 'Submitting…' : 'Send request'}</button>
    <button className="bp-text" type="button" disabled={send.pending} onClick={() => {
      focusLookup.current = true;
      setTarget(undefined);
      setIdentifier('');
      setMessage(suggestedMessage);
      send.clearError();
    }}>Choose another vehicle</button>
  </form>;
  const field = identifierFields[method];
  return <form className="bp-form bc-card" onSubmit={lookUp}>
    <fieldset disabled={lookup.pending}>
      <legend>Look up by</legend>
      <div className="bc-methods">
        <label className="bp-option"><input type="radio" name="method" value="plate" checked={method === 'plate'}
          onChange={() => chooseMethod('plate')} />Plate</label>
        <label className="bp-option"><input type="radio" name="method" value="vin" checked={method === 'vin'}
          onChange={() => chooseMethod('vin')} />VIN</label>
      </div>
      <div className="bc-identifier">
        <label htmlFor="bc-lookup-identifier">{field.label}</label>
        <input id="bc-lookup-identifier" ref={identifierInput} name={method} required autoCapitalize="characters" autoComplete="off"
          spellCheck={false} maxLength={48} pattern={field.pattern} title={field.title} value={identifier}
          aria-describedby="bc-lookup-hint" onChange={event => {
            setIdentifier(event.target.value);
            clearLookupFeedback();
          }} />
        <p id="bc-lookup-hint" className="bp-muted bc-hint">{method === 'plate'
          ? 'Plate lookup supports Mexican plates. For other plates, use the VIN.'
          : 'Enter the 17-character VIN.'}</p>
      </div>
    </fieldset>
    {lookupExpired && <p className="bp-feedback" role="status">This plate lookup expired. Look up the plate again to continue with your saved message.</p>}
    {unavailable && <div>
      <p className="bp-feedback" role="status">{method === 'plate'
        ? 'No vehicle is available for contact with that plate. Check the plate or try the VIN.'
        : 'No vehicle is available for contact with that VIN. Check the VIN and try again.'}</p>
      {method === 'plate' && <button className="bp-text" type="button" onClick={() => {
        focusLookup.current = true;
        chooseMethod('vin');
      }}>Try the VIN</button>}
    </div>}
    {lookup.error && <p className="bp-error" role="alert">{lookup.error}</p>}
    <button className="bp-primary" disabled={lookup.pending}>{lookup.pending ? 'Looking up…' : 'Look up vehicle'}</button>
  </form>;
}

export default function Contact() {
  return <ContactPage title="Contact a driver" path="/contact" introduction="Sign in to find a vehicle and ask the driver about charging."><RequestForm /></ContactPage>;
}
