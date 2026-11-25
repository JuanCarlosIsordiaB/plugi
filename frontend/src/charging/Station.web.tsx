import { router, useLocalSearchParams } from 'expo-router';
import { type Ref, useEffect, useRef, useState } from 'react';
import { ApiError, type Charger, type ReportStatus, type Station, type StationDetail, defaultReportDuration, isReportStatus, maxReportDuration, parseReportDuration, reportStatuses, statusLabels, submitReport, useSignedIn } from './api';
import MapPanel, { type Pin } from './MapPanel.web';
import { RemainingTime, type StationStatusClock, useStationStatusResource } from './stationStatus.web';
import { AppLink, Age, AvailableCount, Brand, Feedback, Icon, Nav, errorMessage, useResource } from './ui.web';

let submittedAtStation: string | undefined;
const detailLink = (id: string) => ({ pathname: '/stations/[id]' as const, params: { id } });
const durationPresets = [15, defaultReportDuration, 60, 120];

function useStationDetail(id: string | undefined) {
  return useStationStatusResource<StationDetail>(id ? '/stations/' + encodeURIComponent(id) : null);
}

function StationChargers({ station, clock, showMapPins = false }: {
  station: StationDetail; clock?: StationStatusClock; showMapPins?: boolean;
}) {
  const catalog = useResource<{ id: string; label: string }[]>('/connector-types');
  const SectionHeading = showMapPins ? 'h2' : 'h3';
  const ChargerHeading = showMapPins ? 'h3' : 'h4';
  return <>
    <div className="bp-section-title"><SectionHeading>Chargers</SectionHeading><AvailableCount count={station.counts.available} /></div>
    {station.chargers.length === 0 && <p>No chargers listed.</p>}
    <ul className="bp-chargers">{station.chargers.map((item, index) => <li className="bp-charger" key={item.id}>
      <div><div className="bp-charger-title">
        {showMapPins && item.latitude !== null && item.longitude !== null && <span className="bp-pin-number"
          aria-label={'Map pin ' + (index + 1)}>{String(index + 1).padStart(2, '0')}</span>}
        <ChargerHeading>{item.label}</ChargerHeading></div>
        <p>{item.connectorTypes.map(type => catalog.data?.find(entry => entry.id === type)?.label ?? type.toUpperCase()).join(' · ')}</p>
        <span className={'bp-availability ' + item.status}>{item.availableByTimer ? 'Available · estimate ended' : statusLabels[item.status]}</span>
        {item.status === 'occupied' && item.occupiedUntil && clock && <RemainingTime until={item.occupiedUntil} clock={clock} />}
        {item.latestReportAt && <p className="bp-charger-age">Reported <Age at={item.latestReportAt} /></p>}
      </div>
      <AppLink href={{ pathname: '/stations/[id]/report', params: { id: station.id, charger: item.id } }} className="bp-secondary"
        aria-label={'Report status for ' + item.label}>Report</AppLink>
    </li>)}</ul>
    {catalog.error && <Feedback error="Connector names could not load." retry={catalog.retry} loading="" />}
  </>;
}

export function StationSheetDetail({ summary, headingRef, onBack }: {
  summary: Station;
  headingRef: Ref<HTMLHeadingElement>;
  onBack: () => void;
}) {
  const detail = useStationDetail(summary.id);
  const station = detail.data;
  return <>
    <div className="bp-sheet-station-toolbar">
      <button className="bp-text bp-back-to-results" type="button" onClick={onBack}><Icon name="back" />Back to station list</button>
    </div>
    <header className="bp-sheet-station-heading">
      <h2 ref={headingRef} tabIndex={-1}>{station?.name ?? summary.name}</h2>
      <p className="bp-muted">{station?.address ?? summary.address}</p>
    </header>
    {station ? <StationChargers station={station} clock={detail.clock} /> : <Feedback error={detail.error} retry={detail.retry} loading="Loading station…" />}
    {station && detail.error && <Feedback error={detail.error} retry={detail.retry} loading="" />}
    <AppLink href={detailLink(summary.id)} className="bp-text bp-return">Open station page</AppLink>
  </>;
}

export default function StationScreen({ reporting = false }: { reporting?: boolean }) {
  const { id, charger, status, durationMinutes } = useLocalSearchParams<{
    id: string; charger?: string; status?: string; durationMinutes?: string;
  }>();
  const detail = useStationDetail(id);
  const station = detail.data;
  const [confirmed] = useState(() => !reporting && typeof id === 'string' && submittedAtStation === id);
  useEffect(() => { if (confirmed) submittedAtStation = undefined; }, [confirmed]);
  const selected = station?.chargers.find(item => item.id === charger);
  const pins: Pin[] = station?.chargers.flatMap((item, index) =>
    item.latitude !== null && item.longitude !== null ? [{
      id: item.id, name: item.label, latitude: item.latitude, longitude: item.longitude, number: index + 1, status: item.status,
    }] : []) ?? [];
  const back = reporting ? detailLink(id) : '/' as const;
  return <main className={'bp-shell bp-detail' + (reporting ? ' bp-report' : '')}>
    <header className="bp-header"><Brand /><Nav showAccountSettings={!reporting} /></header>
    <div className="bp-detail-grid">
      <header className="bp-station-title"><div className="bp-title-row">
        <AppLink href={back} className="bp-square" aria-label={reporting ? 'Back to station' : 'Back to map'}><Icon name="back" /></AppLink>
        <h1>{station?.name ?? 'Station'}</h1>
      </div>{station && <p>{reporting ? 'Community reports' : station.address}</p>}</header>
      {station && <MapPanel key={station.id} camera={{
        center: [station.latitude, station.longitude], zoom: 17,
      }} pins={pins.length ? pins : [station]} selected={charger} />}
      <section className="bp-sheet bp-detail-sheet">
        {confirmed && <p className="bp-success" role="status">Report submitted.</p>}
        {station && detail.error && <Feedback error={detail.error} retry={detail.retry} loading="" />}
        {!station ? <Feedback error={detail.error} retry={detail.retry} loading="Loading station…" /> :
          reporting ? selected ? <ReportForm key={selected.id} id={id} charger={selected} status={status} initialDuration={durationMinutes} /> :
          <p role="alert">This charger is unavailable. <AppLink href={detailLink(id)}>Back to station</AppLink></p> :
          <>
            <StationChargers station={station} clock={detail.clock} showMapPins />
            <AppLink href="/" className="bp-text bp-return">Back to map</AppLink>
          </>}
      </section>
    </div>
  </main>;
}

function ReportForm({ id, charger, status, initialDuration }: { id: string; charger: Charger; status?: string; initialDuration?: string }) {
  const [choice, setChoice] = useState<ReportStatus>(isReportStatus(status) ? status : 'available');
  const [durationMinutes, setDurationMinutes] = useState(() => String(parseReportDuration(initialDuration) ?? defaultReportDuration));
  const signedIn = useSignedIn();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function login(duration: number | undefined) {
    router.replace({ pathname: '/login', params: {
      station: id, charger: charger.id, status: choice,
      ...(duration === undefined ? {} : { durationMinutes: String(duration) }),
    } });
  }
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    const duration = choice === 'occupied' ? parseReportDuration(durationMinutes) : undefined;
    if (choice === 'occupied' && duration === undefined) {
      setError('Enter a whole number of minutes from 1 to ' + maxReportDuration + '.');
      return;
    }
    if (!signedIn) { login(duration); return; }
    busy.current = true;
    setPending(true);
    setError('');
    try {
      await submitReport(id, charger.id, choice, duration);
      if (mounted.current) {
        submittedAtStation = id;
        router.replace(detailLink(id));
      }
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof ApiError && cause.status === 401) login(duration);
      else setError(errorMessage(cause));
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return <form onSubmit={send} className="bp-form bp-report-form">
    <div className="bp-section-title"><h2>Report status</h2><AppLink href={detailLink(id)} className="bp-square" aria-label="Close report"><Icon name="close" /></AppLink></div>
    <fieldset disabled={pending}><legend>What is the status of {charger.label}?</legend>
      {reportStatuses.map((value, index) => <label key={value} className={'bp-option' + (choice === value ? ' checked' : '')}>
        <span aria-hidden="true">{['✓', '◷', '−'][index]}</span>{statusLabels[value]}
        <input type="radio" name="status" value={value} checked={choice === value} onChange={() => setChoice(value)} />
      </label>)}
    </fieldset>
    {choice === 'occupied' && <fieldset className="bp-report-duration" disabled={pending}>
      <legend>Estimated time remaining</legend>
      <div className="bp-duration-presets">{durationPresets.map(minutes => <button key={minutes} type="button" className="bp-secondary"
        aria-pressed={parseReportDuration(durationMinutes) === minutes} onClick={() => {
          setDurationMinutes(String(minutes));
          setError('');
        }}>{minutes} min</button>)}</div>
      <label>Minutes<input name="durationMinutes" type="number" inputMode="numeric" min={1} max={maxReportDuration}
        required value={durationMinutes} onChange={event => {
          setDurationMinutes(event.target.value);
          setError('');
        }} /></label>
    </fieldset>}
    {error && <p role="alert" className="bp-error">{error}</p>}
    <button type="submit" className="bp-primary" disabled={pending}>{pending ? 'Submitting…' : 'Submit report'}</button>
    <AppLink href={detailLink(id)} className="bp-text bp-return">Cancel</AppLink>
  </form>;
}
