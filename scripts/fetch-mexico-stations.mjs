// Read-only collector for public EV charging stations in Mexico from open data sources.
// Sources: Open Charge Map (CC BY 4.0, needs OCM_API_KEY) and OpenStreetMap via Overpass (ODbL).
// Writes data/mexico-stations.json and data/mexico-stations-review.json. It never calls the buscaPila API.
import { writeFile } from 'node:fs/promises';

const userAgent = 'buscaPila-catalog/0.1';
const mergeDistance = 30;
const reviewDistance = 100;
const mexicoBounds = { minLat: 14, maxLat: 33, minLng: -119, maxLng: -86 };

const sources = {
  ocm: {
    provider: 'ocm',
    license: 'CC BY 4.0 (community data); third-party provider data remains with its owner',
    attribution: 'Data from Open Charge Map, https://openchargemap.org',
  },
  osm: {
    provider: 'osm',
    license: 'ODbL 1.0',
    attribution: '© OpenStreetMap contributors, https://www.openstreetmap.org/copyright',
  },
};

// Raw label patterns mapped to buscaPila connector codes (backend/migrations/002_charging_stations.sql).
const connectorPatterns = [
  [/ccs.*(type ?1|combo ?1|sae)|type1_combo|combo 1/i, 'ccs1'],
  [/ccs.*(type ?2|combo ?2)|type2_combo|combo 2/i, 'ccs2'],
  [/chademo/i, 'chademo'],
  [/gb.?t.*dc|gb_dc/i, 'gbt_dc'],
  [/gb.?t.*ac|gb_ac|gb\/t/i, 'gbt_ac'],
  [/nacs|j3400|tesla/i, 'nacs'],
  [/j-?1772|type ?1\b|^type1$/i, 'j1772'],
  [/type ?2|mennekes|^type2$/i, 'type_2'],
];

function connectorCode(label) {
  return connectorPatterns.find(([pattern]) => pattern.test(label))?.[1] ?? null;
}

function normalize(value) {
  return (value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function distance(a, b) {
  const radians = Math.PI / 180;
  const lat = (b.latitude - a.latitude) * radians;
  const lng = (b.longitude - a.longitude) * radians;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * radians)
    * Math.cos(b.latitude * radians) * Math.sin(lng / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(Math.min(1, h)));
}

function sharesNameToken(a, b) {
  const stop = new Set(['de', 'la', 'el', 'los', 'las', 'del', 'y', 'ev', 'station', 'charging', 'cargador', 'electrolinera']);
  const tokens = new Set(normalize(a.name).split(' ').filter((t) => t.length > 2 && !stop.has(t)));
  return normalize(b.name).split(' ').some((t) => tokens.has(t));
}

function insideMexico({ latitude, longitude }) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= mexicoBounds.minLat && latitude <= mexicoBounds.maxLat
    && longitude >= mexicoBounds.minLng && longitude <= mexicoBounds.maxLng;
}

function record({ provider, externalId, sourceUrl, labels, ...fields }) {
  const raw = [...new Set(labels.filter(Boolean))].sort();
  const codes = [...new Set(raw.map(connectorCode).filter(Boolean))].sort();
  return {
    ...fields,
    publishedConnectorTypes: raw,
    connectorTypes: codes,
    unmappedConnectorTypes: raw.filter((label) => !connectorCode(label)),
    sourceUrl,
    sources: [{ provider, externalId, sourceUrl, license: sources[provider].license }],
  };
}

async function getJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${new URL(url).host}`);
  return response.json();
}

async function fetchOcm() {
  const key = process.env.OCM_API_KEY;
  if (!key) throw new Error('OCM_API_KEY is not set; Open Charge Map requires a free API key.');
  const url = new URL('https://api.openchargemap.io/v3/poi');
  Object.entries({ countrycode: 'MX', maxresults: '10000', compact: 'false', verbose: 'false', key })
    .forEach(([name, value]) => url.searchParams.set(name, value));
  const rows = await getJson(url.href);
  return rows.map((poi) => {
    const a = poi.AddressInfo ?? {};
    const address = [a.AddressLine1, a.AddressLine2, a.Town, a.StateOrProvince, a.Postcode, 'Mexico']
      .filter((part) => part && String(part).trim()).join(', ');
    const connections = poi.Connections ?? [];
    return record({
      provider: 'ocm',
      externalId: String(poi.ID),
      sourceUrl: `https://openchargemap.org/site/poi/details/${poi.ID}`,
      name: (a.Title ?? '').trim() || `Charging station ${poi.ID}`,
      address,
      latitude: a.Latitude,
      longitude: a.Longitude,
      state: a.StateOrProvince?.trim() || null,
      publishedOutletCount: poi.NumberOfPoints
        ?? (connections.reduce((sum, c) => sum + (c.Quantity ?? 1), 0) || null),
      maxPowerKw: Math.max(0, ...connections.map((c) => c.PowerKW ?? 0)) || null,
      network: poi.OperatorInfo?.Title && !/unknown/i.test(poi.OperatorInfo.Title) ? poi.OperatorInfo.Title : null,
      hours: a.AccessComments?.trim() || null,
      labels: connections.map((c) => c.ConnectionType?.Title),
    });
  });
}

const osmSocketLabels = {
  type1: 'Type 1 (J1772)', type2: 'Type 2', type2_cable: 'Type 2 (tethered)',
  type1_combo: 'CCS Combo 1', type2_combo: 'CCS Combo 2', chademo: 'CHAdeMO',
  tesla_supercharger: 'Tesla Supercharger', tesla_destination: 'Tesla Destination', nacs: 'NACS',
  gb_ac: 'GB/T AC', gb_dc: 'GB/T DC', schuko: 'Schuko', nema_5_15: 'NEMA 5-15',
  nema_5_20: 'NEMA 5-20', nema_14_50: 'NEMA 14-50', cee_blue: 'CEE Blue',
};

async function fetchOsm() {
  const query = '[out:json][timeout:180];area["ISO3166-1"="MX"][admin_level=2]->.mx;'
    + 'nwr["amenity"="charging_station"](area.mx);out center tags;';
  const mirrors = ['https://overpass-api.de', 'https://overpass.kumi.systems', 'https://overpass.private.coffee'];
  let data;
  const errors = [];
  for (const mirror of mirrors) {
    try {
      data = await getJson(`${mirror}/api/interpreter?data=${encodeURIComponent(query)}`);
      break;
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (!data) throw new Error(errors.join('; '));
  return data.elements.map((el) => {
    const t = el.tags ?? {};
    const sockets = Object.keys(t).filter((k) => /^socket:[^:]+$/.test(k) && t[k] !== 'no' && t[k] !== '0');
    const outlets = sockets.reduce((sum, k) => sum + (Number.parseInt(t[k], 10) || 0), 0);
    const address = [
      [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' '),
      t['addr:suburb'], t['addr:city'], t['addr:state'], t['addr:postcode'],
    ].filter(Boolean).join(', ');
    const id = `${el.type}/${el.id}`;
    return record({
      provider: 'osm',
      externalId: id,
      sourceUrl: `https://www.openstreetmap.org/${id}`,
      name: t.name ?? t.brand ?? t.operator ?? `Charging station ${id}`,
      address: address ? `${address}, Mexico` : '',
      latitude: el.lat ?? el.center?.lat,
      longitude: el.lon ?? el.center?.lon,
      state: t['addr:state'] ?? null,
      publishedOutletCount: outlets || Number.parseInt(t.capacity, 10) || null,
      maxPowerKw: null,
      network: t.network ?? t.brand ?? t.operator ?? null,
      hours: t.opening_hours ?? null,
      labels: sockets.map((k) => osmSocketLabels[k.slice(7)] ?? k.slice(7)),
    });
  });
}

function merge(primary, secondary) {
  const pick = (a, b) => (a === null || a === undefined || a === '' ? b : a);
  const raw = [...new Set([...primary.publishedConnectorTypes, ...secondary.publishedConnectorTypes])].sort();
  return {
    ...primary,
    address: pick(primary.address, secondary.address),
    state: pick(primary.state, secondary.state),
    publishedOutletCount: pick(primary.publishedOutletCount, secondary.publishedOutletCount),
    maxPowerKw: pick(primary.maxPowerKw, secondary.maxPowerKw),
    network: pick(primary.network, secondary.network),
    hours: pick(primary.hours, secondary.hours),
    publishedConnectorTypes: raw,
    connectorTypes: [...new Set([...primary.connectorTypes, ...secondary.connectorTypes])].sort(),
    unmappedConnectorTypes: raw.filter((label) => !connectorCode(label)),
    sources: [...primary.sources, ...secondary.sources],
  };
}

const review = [];
const fetched = {};
for (const [provider, fetcher] of [['ocm', fetchOcm], ['osm', fetchOsm]]) {
  try {
    fetched[provider] = await fetcher();
    console.log(`${provider}: ${fetched[provider].length} records`);
  } catch (error) {
    fetched[provider] = [];
    console.warn(`${provider}: skipped (${error.message})`);
  }
}

const valid = (rows) => rows.filter((row) => {
  if (insideMexico(row)) return true;
  review.push({ reason: 'invalid_or_outside_mexico_coordinates', sources: row.sources });
  return false;
});
const ocm = valid(fetched.ocm);
const osm = valid(fetched.osm);

// OCM records come first because they carry richer connector data; OSM records merge into them.
const stations = [...ocm];
for (const row of osm) {
  const near = stations
    .filter((s) => s.sources.every((src) => src.provider !== 'osm'))
    .map((s) => ({ s, meters: distance(s, row) }))
    .filter(({ meters }) => meters <= reviewDistance)
    .sort((a, b) => a.meters - b.meters);
  const close = near.filter(({ meters }) => meters <= mergeDistance);
  if (close.length === 1) {
    stations[stations.indexOf(close[0].s)] = merge(close[0].s, row);
    continue;
  }
  if (close.length > 1 || near.some(({ s }) => sharesNameToken(s, row))) {
    review.push({
      reason: close.length > 1 ? 'multiple_candidates_within_30m' : 'possible_duplicate_within_100m',
      sources: [...row.sources, ...near.flatMap(({ s }) => s.sources)],
    });
  }
  stations.push(row);
}

stations.sort((a, b) => (a.state ?? '~').localeCompare(b.state ?? '~') || a.name.localeCompare(b.name));
for (const s of stations) {
  if (!s.connectorTypes.length) review.push({ reason: 'no_supported_connector_type', sources: s.sources });
}

const usedProviders = Object.keys(sources).filter((p) => fetched[p].length);
if (!usedProviders.length) {
  console.error('No source returned data; existing output files were left unchanged.');
  process.exit(1);
}
const generatedAt = new Date().toISOString();
await writeFile('data/mexico-stations.json', JSON.stringify({
  generatedAt,
  country: 'MX',
  sources: usedProviders.map((p) => sources[p]),
  count: stations.length,
  stations,
}, null, 2) + '\n');
await writeFile('data/mexico-stations-review.json', JSON.stringify({ generatedAt, count: review.length, review }, null, 2) + '\n');

console.log(JSON.stringify({
  ocm: ocm.length,
  osm: osm.length,
  mergedStations: stations.length,
  multiSourceStations: stations.filter((s) => s.sources.length > 1).length,
  reviewCases: review.length,
}, null, 2));
