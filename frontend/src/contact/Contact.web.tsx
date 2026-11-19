import { type FormEvent, useState } from 'react';
import { authenticated, jsonRequest } from '../charging/api';
import { AppLink } from '../charging/ui.web';
import { ContactPage, IdentifierFields, MessageField, readIdentifier, useAction, type Plate } from './common.web';

const suggestedMessage = 'Hello! How much longer will you be charging?';
type Target = { vin: string } | Plate;

function RequestForm() {
  const [method, setMethod] = useState<'plate' | 'vin'>('plate');
  const [target, setTarget] = useState<Target>();
  const [unavailable, setUnavailable] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState(suggestedMessage);
  const lookup = useAction();
  const send = useAction();
  function lookUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { vin, ...plate } = readIdentifier(event.currentTarget);
    const identifier: Target = method === 'vin' ? { vin } : plate;
    setUnavailable(false);
    void lookup.run(signal => authenticated<{ registered: boolean }>('/vehicle-contact/lookup', {
      ...jsonRequest('POST', identifier), signal,
    }), result => {
      if (result.registered) setTarget(identifier);
      else setUnavailable(true);
    });
  }
  function initiate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || !message.trim()) return;
    void send.run(signal => authenticated<{ accepted: true }>('/vehicle-contact', {
      ...jsonRequest('POST', { ...target, message: message.trim() }), signal,
    }), () => { setAccepted(true); setTarget(undefined); setMessage(suggestedMessage); });
  }
  if (accepted) return <section className="bc-card">
    <h2>Request accepted</h2><p role="status">If the driver replies, the conversation will appear in Messages.</p>
    <AppLink className="bp-primary" href="/messages">View messages</AppLink>
    <button className="bp-text" onClick={() => setAccepted(false)}>Look up another vehicle</button>
  </section>;
  if (target) return <form className="bp-form bc-card" onSubmit={initiate}>
    <h2>Write a charging message</h2>
    <p className="bp-muted">{'vin' in target ? 'VIN ending in ' + target.vin.slice(-4) : target.plate + ' · ' + target.plateRegion + ', ' + target.plateCountry}</p>
    <fieldset disabled={send.pending}><legend className="bp-screen-reader">Charging message</legend><MessageField label="Message" value={message} onChange={setMessage} /></fieldset>
    {send.error && <p className="bp-error" role="alert">{send.error}</p>}
    <button className="bp-primary" disabled={send.pending}>{send.pending ? 'Submitting…' : 'Send request'}</button>
    <button className="bp-text" type="button" disabled={send.pending} onClick={() => {
      setTarget(undefined); setMessage(suggestedMessage); send.clearError();
    }}>Choose another vehicle</button>
  </form>;
  return <form className="bp-form bc-card" onSubmit={lookUp} onChange={() => { setUnavailable(false); lookup.clearError(); }}>
    <h2>Find a vehicle</h2><p className="bp-muted">Enter the exact details of the vehicle you’d like to contact about charging.</p>
    <fieldset disabled={lookup.pending}><legend className="bp-screen-reader">Vehicle lookup</legend>
      <label>Look up by<select name="method" value={method} onChange={event => setMethod(event.target.value === 'vin' ? 'vin' : 'plate')}>
        <option value="plate">License plate</option><option value="vin">VIN</option></select></label>
      <IdentifierFields key={method} method={method} />
    </fieldset>
    {unavailable && <p className="bp-feedback" role="status">No vehicle is available for contact with those details. Check the identifiers and try again.</p>}
    {lookup.error && <p className="bp-error" role="alert">{lookup.error}</p>}
    <button className="bp-primary" disabled={lookup.pending}>{lookup.pending ? 'Looking up…' : 'Look up vehicle'}</button>
  </form>;
}

export default function Contact() {
  return <ContactPage title="Contact a driver" path="/contact" introduction="Sign in to find a vehicle and ask the driver about charging."><RequestForm /></ContactPage>;
}
