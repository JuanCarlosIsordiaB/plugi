import { readFile, writeFile } from 'node:fs/promises';

const matchDistance = 30;
const reviewDistance = 100;

function normalize(value) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
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

function readStation(row, index) {
  if (!row || typeof row.name !== 'string' || !normalize(row.name)
    || typeof row.address !== 'string'
    || !Number.isFinite(row.latitude) || Math.abs(row.latitude) > 90
    || !Number.isFinite(row.longitude) || Math.abs(row.longitude) > 180
    || typeof row.sourceUrl !== 'string'
    || (row.chargers !== undefined && !Array.isArray(row.chargers))) {
    throw new Error(`Invalid station at input row ${index + 1}.`);
  }
  const url = new URL(row.sourceUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`Invalid source URL at input row ${index + 1}.`);
  }
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  url.searchParams.sort();
  return {
    name: row.name.trim(), address: row.address.trim(),
    latitude: row.latitude, longitude: row.longitude, sourceUrl: url.href,
    chargers: row.chargers ?? [],
  };
}

function clean(rows) {
  const groups = [];
  const review = [];
  const sources = new Map();
  for (const record of rows.map(readStation)) {
    const previous = sources.get(record.sourceUrl) ?? [];
    if (!previous.some((entry) => JSON.stringify(entry) === JSON.stringify(record))) {
      previous.push(record);
    }
    sources.set(record.sourceUrl, previous);
  }

  for (const sourceUrl of [...sources.keys()].sort()) {
    const records = sources.get(sourceUrl);
    records.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const [station] = records;
    if (records.length > 1) review.push({ reason: 'conflicting_source_records', sourceUrls: [sourceUrl] });
    const name = normalize(station.name);
    const address = normalize(station.address);
    const candidates = [];
    const nearby = [];
    for (const group of groups) {
      const checks = group.sourceRecords.map((other) => ({
        meters: distance(station, other),
        sameName: name === normalize(other.name),
        sameAddress: Boolean(address) && address === normalize(other.address),
      }));
      if (checks.some(({ meters, sameName, sameAddress }) =>
        meters <= matchDistance || (meters <= reviewDistance && (sameName || sameAddress)))) {
        nearby.push(group);
      }
      if (records.length === 1 && group.sourceRecords.length === group.sourceUrls.length
        && checks.every(({ meters, sameName, sameAddress }) =>
          meters <= matchDistance && sameName && sameAddress)) candidates.push(group);
    }
    const match = candidates.length === 1 ? candidates[0] : undefined;
    const unresolved = nearby.filter((group) => group !== match);
    if (unresolved.length) {
      review.push({
        reason: 'nearby_location',
        sourceUrls: [sourceUrl, ...unresolved.flatMap((group) => group.sourceUrls)],
      });
    }
    if (match) {
      match.sourceUrls.push(sourceUrl);
      match.sourceRecords.push(...records);
    } else {
      const { name, address, latitude, longitude } = station;
      groups.push({ name, address, latitude, longitude, sourceUrls: [sourceUrl], sourceRecords: records });
    }
  }
  return {
    summary: {
      inputRecords: rows.length,
      distinctSourceUrls: sources.size,
      repeatedSourceRows: rows.length - sources.size,
      mergedDistinctSourceUrls: sources.size - groups.length,
      remainingLocations: groups.length,
      reviewCases: review.length,
    },
    stations: groups,
    review,
  };
}

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/clean-station-catalog.mjs input.json output.json');
  process.exitCode = 1;
} else {
  try {
    const input = JSON.parse((await readFile(inputPath, 'utf8')).replace(/^\uFEFF/, ''));
    if (!Array.isArray(input)) throw new Error('Expected a JSON array of source station records.');
    const result = clean(input);
    await writeFile(outputPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(result.summary, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
