import { readFile } from 'node:fs/promises';

const [file, mode] = process.argv.slice(2);
const text = (value, limit) => typeof value === 'string'
  && value.trim().length > 0 && value.length <= limit
  && !value.includes('\0') && !/[\p{Cc}\p{Cs}]/u.test(value.trim());
const coordinate = (value, limit) => Number.isFinite(value) && Math.abs(value) <= limit;
const fields = (value, allowed) => value && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).every((key) => allowed.includes(key));

function validSourceUrl(value) {
  if (!text(value, 2048)) return false;
  const input = value.trim();
  const url = URL.parse(input);
  return /^https?:\/\//i.test(input) && !/[\s\\]/u.test(input)
    && url?.hostname && !url.username && !url.password;
}

function validStation(station) {
  return fields(station, ['name', 'address', 'latitude', 'longitude', 'chargers', 'source', 'existingStationId'])
    && text(station.name, 120) && text(station.address, 300)
    && coordinate(station.latitude, 90) && coordinate(station.longitude, 180)
    && fields(station.source, ['provider', 'externalId', 'sourceUrl'])
    && text(station.source.provider, 32)
    && /^[a-z0-9_]{1,32}$/.test(station.source.provider.trim())
    && text(station.source.externalId, 300)
    && validSourceUrl(station.source.sourceUrl)
    && (station.existingStationId === undefined
      || (typeof station.existingStationId === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(station.existingStationId)))
    && Array.isArray(station.chargers) && station.chargers.length >= 1
    && station.chargers.length <= 32
    && station.chargers.every((charger) =>
      fields(charger, ['label', 'latitude', 'longitude', 'connectorTypes']) && text(charger.label, 80)
      && ((charger.latitude == null && charger.longitude == null)
        || (coordinate(charger.latitude, 90) && coordinate(charger.longitude, 180)))
      && Array.isArray(charger.connectorTypes) && charger.connectorTypes.length >= 1
      && charger.connectorTypes.length <= 16
      && new Set(charger.connectorTypes).size === charger.connectorTypes.length
      && charger.connectorTypes.every((type) => typeof type === 'string' && /^[a-z0-9_]{1,32}$/.test(type)));
}

try {
  if (!file || (mode !== undefined && mode !== '--apply') || process.argv.length > 4) {
    throw new Error('Usage: node scripts/post-san-luis-potosi-stations.mjs batch.json [--apply]');
  }
  const batch = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  if (batch?.region !== 'MX-SLP' || !Array.isArray(batch.stations) || !batch.stations.length) {
    throw new Error('Expected a non-empty stations array in a batch with region MX-SLP.');
  }
  const sources = new Set();
  for (const [index, station] of batch.stations.entries()) {
    if (!validStation(station)) throw new Error(`Invalid or incomplete station at row ${index + 1}.`);
    const key = JSON.stringify([station.source.provider.trim(), station.source.externalId.trim()]);
    if (sources.has(key)) throw new Error(`Duplicate source at row ${index + 1}.`);
    sources.add(key);
  }
  if (mode !== '--apply') {
    console.log(`Preview: ${batch.stations.length} San Luis Potosí stations ready for API submission.`);
  } else {
    const base = new URL(process.env.STATION_API_URL ?? '');
    const token = process.env.STATION_ADMIN_TOKEN?.trim();
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (!token || base.username || base.password
      || !(base.protocol === 'https:' || (base.protocol === 'http:' && loopback))) {
      throw new Error('Set STATION_API_URL (HTTPS or local HTTP) and STATION_ADMIN_TOKEN.');
    }
    const endpoint = new URL('/api/v1/stations', base);
    let completed = 0;
    for (const [index, station] of batch.stations.entries()) {
      let response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(station),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new Error(`Request failed at row ${index + 1} after ${completed} successful posts. Retry the same batch.`);
      }
      if (response.status !== 201) {
        throw new Error(`API returned HTTP ${response.status} at row ${index + 1} after ${completed} successful posts.`);
      }
      const detail = await response.json();
      console.log(JSON.stringify({ row: index + 1, stationId: detail.id }));
      completed++;
    }
    console.log(`Submitted ${completed} stations.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
