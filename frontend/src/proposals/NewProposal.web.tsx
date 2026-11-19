import { type FormEvent, useEffect, useRef, useState } from 'react';
import { authenticated, jsonRequest } from '../charging/api';
import MapPanel, { type Camera, initialCamera, type Pin } from '../charging/MapPanel.web';
import { AppLink, errorMessage, Feedback, useResource } from '../charging/ui.web';
import { type ConnectorType, type Proposal, proposalsPath, type ProposedStation } from './api';
import ProposalPage, { proposalsHref } from './ProposalPage.web';

const maxChargers = 32;
const maxConnectorTypes = 16;
const textPattern = String.raw`(?=.*\S)[^\p{Cc}\p{Cs}]+`;
const textValue = (data: FormData, name: string) => String(data.get(name) ?? '').trim();
const emptyPins: Pin[] = [];

function ProposalLocation() {
  const mapCamera = useRef<Camera>(initialCamera);
  const [mapReady, setMapReady] = useState(false);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const point = latitude !== '' && longitude !== '' && Math.abs(Number(latitude)) <= 90 && Math.abs(Number(longitude)) <= 180;

  return <section className="bp-proposal-section" aria-labelledby="proposal-location-heading">
    <h2 id="proposal-location-heading">Station location</h2>
    <p className="bp-muted">Move the map so the crosshair lines up with the station, or enter the coordinates directly.</p>
    <div className="bp-proposal-map">
      <MapPanel camera={initialCamera} pins={emptyPins} onMove={camera => { mapCamera.current = camera; setMapReady(true); }} />
      {mapReady && <span className="bp-proposal-crosshair" aria-hidden="true">+</span>}
    </div>
    <div className="bp-proposal-map-actions">
      <button type="button" className="bp-secondary" disabled={!mapReady} onClick={() => {
        const [lat, lng] = mapCamera.current.center;
        const wrappedLongitude = ((lng + 180) % 360 + 360) % 360 - 180;
        setLatitude(lat.toFixed(6));
        setLongitude(wrappedLongitude.toFixed(6));
      }}>Use map center</button>
      <span className="bp-muted" role="status">{point ? 'Selected location ' + latitude + ', ' + longitude : ''}</span>
    </div>
    <div className="bp-proposal-coordinates">
      <label>Latitude<input type="number" step="any" min={-90} max={90} required name="latitude"
        value={latitude} onChange={event => setLatitude(event.target.value)} /></label>
      <label>Longitude<input type="number" step="any" min={-180} max={180} required name="longitude"
        value={longitude} onChange={event => setLongitude(event.target.value)} /></label>
    </div>
  </section>;
}

function ChargerFields({ id, index, catalog, error, onRemove, onChange }: {
  id: number;
  index: number;
  catalog: ConnectorType[];
  error?: string;
  onRemove?: () => void;
  onChange: () => void;
}) {
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const locationRequired = !!latitude || !!longitude;

  return <section className="bp-proposal-charger" aria-labelledby={'charger-heading-' + id}>
    <div className="bp-card-top">
      <h3 id={'charger-heading-' + id}>Charger {index + 1}</h3>
      {onRemove && <button type="button" className="bp-text" aria-label={'Remove charger ' + (index + 1)}
        onClick={onRemove}>Remove</button>}
    </div>
    <label>Charger label<input name={'label-' + id} required maxLength={80} pattern={textPattern} /></label>
    <fieldset aria-describedby={error ? 'connector-error-' + id : undefined}>
      <legend>Connector types</legend>
      <div className="bp-proposal-connector-grid">
        {catalog.map((connector, connectorIndex) => <label key={connector.id}>
          <input type="checkbox" name={'connectors-' + id} value={connector.id}
            id={connectorIndex === 0 ? 'connector-first-' + id : undefined} onChange={onChange} />
          <span>{connector.label}</span>
        </label>)}
      </div>
      {error && <p id={'connector-error-' + id} className="bp-error" role="alert">{error}</p>}
    </fieldset>
    <details onInvalidCapture={event => { event.currentTarget.open = true; }}>
      <summary>Charger coordinates (optional)</summary>
      <div className="bp-proposal-coordinates">
        <label>Charger latitude<input type="number" step="any" min={-90} max={90} required={locationRequired} name={'latitude-' + id}
          value={latitude} onChange={event => setLatitude(event.target.value)} /></label>
        <label>Charger longitude<input type="number" step="any" min={-180} max={180} required={locationRequired} name={'longitude-' + id}
          value={longitude} onChange={event => setLongitude(event.target.value)} /></label>
      </div>
    </details>
  </section>;
}

function ProposalForm({ catalog }: { catalog: ConnectorType[] }) {
  const nextChargerId = useRef(1);
  const flight = useRef<AbortController>(null);
  const confirmation = useRef<HTMLHeadingElement>(null);
  const [chargerIds, setChargerIds] = useState([0]);
  const [connectorError, setConnectorError] = useState<{ id: number; message: string }>();
  const [proposal, setProposal] = useState<Proposal>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => flight.current?.abort(), []);
  useEffect(() => { if (proposal) confirmation.current?.focus(); }, [proposal]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (flight.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const chargers: ProposedStation['chargers'] = [];
    setError('');
    for (const id of chargerIds) {
      const connectorTypes = data.getAll('connectors-' + id).map(String);
      if (connectorTypes.length < 1 || connectorTypes.length > maxConnectorTypes) {
        setConnectorError({ id, message: connectorTypes.length ? 'Choose up to 16 connector types.' : 'Choose at least one connector type.' });
        form.querySelector<HTMLInputElement>('#connector-first-' + id)?.focus();
        return;
      }
      const latitude = textValue(data, 'latitude-' + id);
      const longitude = textValue(data, 'longitude-' + id);
      chargers.push({ label: textValue(data, 'label-' + id), connectorTypes,
        latitude: latitude ? Number(latitude) : null, longitude: longitude ? Number(longitude) : null });
    }
    setConnectorError(undefined);
    const station: ProposedStation = {
      name: textValue(data, 'name'), address: textValue(data, 'address'),
      latitude: Number(data.get('latitude')), longitude: Number(data.get('longitude')), chargers,
    };
    const controller = new AbortController();
    flight.current = controller;
    setPending(true);
    try {
      const created = await authenticated<Proposal>(proposalsPath, { ...jsonRequest('POST', station), signal: controller.signal });
      if (!controller.signal.aborted) setProposal(created);
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      flight.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  if (proposal) return <div className="bp-empty">
    <h2 ref={confirmation} tabIndex={-1}>Proposal submitted</h2>
    <p>{proposal.station.name} is pending review. You can track its status in My proposals.</p>
    <AppLink href={proposalsHref} className="bp-primary">View my proposals</AppLink>
  </div>;

  return <form className="bp-form" onSubmit={submit}>
    <fieldset className="bp-proposal-fields" disabled={pending}>
      <section className="bp-proposal-section" aria-labelledby="proposal-details-heading">
        <h2 id="proposal-details-heading">Station details</h2>
        <label>Station name<input name="name" required maxLength={120} pattern={textPattern} /></label>
        <label>Street address<input name="address" required maxLength={300} pattern={textPattern} /></label>
      </section>
      <ProposalLocation />
      <section className="bp-proposal-section" aria-labelledby="proposal-chargers-heading">
        <h2 id="proposal-chargers-heading">Chargers</h2>
        {chargerIds.map((id, index) => <ChargerFields key={id} id={id} index={index} catalog={catalog}
          error={connectorError?.id === id ? connectorError.message : undefined}
          onChange={() => { if (connectorError?.id === id) setConnectorError(undefined); }}
          onRemove={chargerIds.length > 1 ? () => {
            setChargerIds(ids => ids.filter(item => item !== id));
            if (connectorError?.id === id) setConnectorError(undefined);
          } : undefined} />)}
        {chargerIds.length < maxChargers && <button type="button" className="bp-secondary" onClick={() => {
          const id = nextChargerId.current++;
          setChargerIds(ids => [...ids, id]);
        }}>Add charger</button>}
      </section>
    </fieldset>
    {error && <p className="bp-error" role="alert">{error}</p>}
    <div className="bp-proposals-actions">
      <button type="submit" className="bp-primary" disabled={pending}>{pending ? 'Submitting…' : 'Submit proposal'}</button>
      <AppLink href={proposalsHref} className="bp-text">Cancel</AppLink>
    </div>
  </form>;
}

function NewProposalForm() {
  const { data, error, retry } = useResource<ConnectorType[]>('/connector-types');
  return data?.length ? <ProposalForm catalog={data} /> : <Feedback retry={retry} loading="Loading connector types…"
    error={error ?? (data ? 'No connector types are currently available.' : undefined)} />;
}

export default function NewProposal() {
  return <ProposalPage title="Propose a charging station" newProposal><NewProposalForm /></ProposalPage>;
}
