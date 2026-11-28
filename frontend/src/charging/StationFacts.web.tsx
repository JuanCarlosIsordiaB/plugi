import type { Station } from './api';

const catalogAccessLabels = { public: 'Listed as public', private: 'Listed as private', restricted: 'Listed as restricted' };
const pricingLabels = { free: 'Free', paid: 'Paid', mixed: 'Varies' };

export function StationFacts({ station }: { station: Station }) {
  const access = station.access_type && station.access_type !== 'unknown' ? catalogAccessLabels[station.access_type] : undefined;
  const pricing = station.pricing_type && station.pricing_type !== 'unknown' ? pricingLabels[station.pricing_type] : undefined;

  return <dl className="bp-station-facts">
    <div><dt>Access</dt><dd>{access ?? 'Not listed'}</dd></div>
    <div><dt>Charging cost</dt><dd>{pricing ?? 'Not listed'}</dd></div>
  </dl>;
}

export function StationGlyph({ className }: { className?: string }) {
  return <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 21h12M5 21V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v16M5 9h8m0 6h1a2 2 0 0 1 2 2v1a2 2 0 0 0 4 0v-6m-2-5v3a2 2 0 0 0 4 0V7m-4 1h4m-3-3V3m2 2V3M8 15l2-2-.5 2H11l-2 2 .5-2H8Z" />
  </svg>;
}

export interface ConnectorType {
  id: string;
  label: string;
}

export function connectorLabel(id: string, catalog?: ConnectorType[]) {
  return catalog?.find(entry => entry.id === id)?.label ?? id.toUpperCase();
}
