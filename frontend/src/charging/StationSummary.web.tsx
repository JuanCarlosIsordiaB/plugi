import type { Station } from './api';
import { stationAvailability } from './MapPanel.web';
import { connectorLabel, type ConnectorType } from './StationFacts.web';
import { RemainingTime, type StationStatusClock } from './stationStatus.web';

type StationEquipment = 'ac' | 'dc' | 'nacs' | 'other';

function stationEquipment(connector?: string): StationEquipment {
  if (connector === 'nacs') return 'nacs';
  if (connector && ['ccs1', 'ccs2', 'chademo', 'gbt_dc'].includes(connector)) return 'dc';
  if (connector && ['j1772', 'type_2', 'gbt_ac'].includes(connector)) return 'ac';
  return 'other';
}

export function StationThumbnail({ connector }: { connector?: string }) {
  const equipment = stationEquipment(connector);
  return <svg className={'bp-station-thumbnail bp-station-thumbnail-' + equipment} viewBox="0 0 84 84" aria-hidden="true">
    <path fill="var(--thumbnail-field)" d="M0 0h84v84H0z" />
    <g fill="none" stroke="var(--thumbnail-ink)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      {equipment === 'nacs' ? <>
        <path d="M27 68V29a13 13 0 0 1 26 0v39z" fill="var(--thumbnail-accent)" />
        <path d="M35 60V30a5 5 0 0 1 10 0v30z" fill="var(--thumbnail-field)" />
        <path d="M53 33c8 0 9 5 9 12v12a4 4 0 0 1-8 0v-9" />
      </> : equipment === 'dc' ? <>
        <rect x="23" y="16" width="32" height="52" rx="4" fill="var(--thumbnail-accent)" />
        <rect x="30" y="23" width="18" height="12" rx="2" fill="var(--thumbnail-field)" />
        <path d="M31 53h16m-16 6h16m8-22c7 0 9 4 9 10v10a4.5 4.5 0 0 0 9 0V43m0 0v-6" />
      </> : equipment === 'ac' ? <>
        <path d="M33 68V43m9 25V43" />
        <rect x="25" y="18" width="25" height="30" rx="6" fill="var(--thumbnail-accent)" />
        <circle cx="37.5" cy="34" r="4.5" fill="var(--thumbnail-field)" />
        <path d="M50 39c6 0 9 4 9 10v9a4.5 4.5 0 0 0 9 0V45m0 0v-5" />
      </> : <>
        <rect x="28" y="20" width="22" height="48" rx="3" fill="var(--thumbnail-accent)" />
        <rect x="33" y="26" width="12" height="9" rx="1" fill="var(--thumbnail-field)" />
        <path d="M50 40c7 0 9 4 9 10v9a4 4 0 0 0 8 0V46m0 0v-5" />
      </>}
      <path d="M13 68h61" strokeWidth="1.5" />
    </g>
  </svg>;
}

export function StationSummary({ station, connectorTypes, catalog, distanceLabel, filtered, clock }: {
  station: Station;
  connectorTypes: string[];
  catalog?: ConnectorType[];
  distanceLabel?: string;
  filtered: boolean;
  clock?: StationStatusClock;
}) {
  const availability = stationAvailability(station.counts);
  const chargerCount = Object.values(station.counts).reduce((total, count) => total + count, 0);

  return <span className="bp-summary-content">
    <span className="bp-station-name">{station.name}</span>
    <span className="bp-address">{station.address}</span>
    <span className="bp-summary-metadata">
      <span className={'bp-availability ' + availability.status}>{availability.label}</span>
      <span>{chargerCount} {filtered ? 'matching ' : ''}{chargerCount === 1 ? 'charger' : 'chargers'}
        {distanceLabel && ' · ' + distanceLabel}
      </span>
    </span>
    {connectorTypes.length > 0 && <span className="bp-summary-connectors">
      {connectorTypes.slice(0, 2).map(type => connectorLabel(type, catalog)).join(' · ')}
      {connectorTypes.length > 2 && ' · +' + (connectorTypes.length - 2) + ' more'}
    </span>}
    {station.nextStatusChangeAt && clock &&
      <RemainingTime until={station.nextStatusChangeAt} clock={clock} prefix="Next estimate: " />}
  </span>;
}
