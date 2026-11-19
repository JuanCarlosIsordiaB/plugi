import { BadRequestException } from '@nestjs/common';
import { bodyFields, stringField } from '../auth/input.js';

function invalid(field: string): never {
  throw new BadRequestException('Invalid ' + field + '.');
}

function plainText(value: unknown, field: string, max: number): string {
  const text = stringField(value, field, max).trim();
  // Reject control characters and unpaired UTF-16 surrogates before storing JSON in PostgreSQL.
  if (/[\p{Cc}\p{Cs}]/u.test(text)) invalid(field);
  return text;
}

function coordinate(value: unknown, field: string, bound: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Math.abs(value) > bound
  )
    invalid(field);
  return value;
}

function charger(input: unknown) {
  const data = bodyFields(input, [
    'label',
    'latitude',
    'longitude',
    'connectorTypes',
  ]);
  const hasCoordinates = data.latitude != null || data.longitude != null;
  if (
    !Array.isArray(data.connectorTypes) ||
    !data.connectorTypes.length ||
    data.connectorTypes.length > 16
  )
    invalid('connector types');
  const connectorTypes = data.connectorTypes.map((id: unknown) => {
    if (typeof id !== 'string' || !/^[a-z0-9_]{1,32}$/.test(id))
      invalid('connector type');
    return id;
  });
  if (new Set(connectorTypes).size !== connectorTypes.length)
    invalid('duplicate connector type');
  return {
    label: plainText(data.label, 'charger label', 80),
    latitude: hasCoordinates
      ? coordinate(data.latitude, 'charger latitude', 90)
      : null,
    longitude: hasCoordinates
      ? coordinate(data.longitude, 'charger longitude', 180)
      : null,
    connectorTypes,
  };
}

export function stationInput(input: unknown) {
  const data = bodyFields(input, [
    'name',
    'address',
    'latitude',
    'longitude',
    'chargers',
  ]);
  if (
    !Array.isArray(data.chargers) ||
    data.chargers.length < 1 ||
    data.chargers.length > 32
  )
    invalid('chargers (provide 1 to 32)');
  return {
    name: plainText(data.name, 'station name', 120),
    address: plainText(data.address, 'station address', 300),
    latitude: coordinate(data.latitude, 'station latitude', 90),
    longitude: coordinate(data.longitude, 'station longitude', 180),
    chargers: data.chargers.map(charger),
  };
}
export type StationInput = ReturnType<typeof stationInput>;

export function reportStatus(input: unknown) {
  const { status } = bodyFields(input, ['status']);
  if (
    status === 'available' ||
    status === 'occupied' ||
    status === 'out_of_service'
  )
    return status;
  return invalid('report status');
}
export type ReportStatus = ReturnType<typeof reportStatus>;

export function reviewDecision(input: unknown) {
  const { decision } = bodyFields(input, ['decision']);
  if (decision === 'approve' || decision === 'reject') return decision;
  return invalid('review decision');
}

export function stationFilter(input: unknown) {
  const bounds = ['south', 'west', 'north', 'east'] as const;
  const data = bodyFields(input, [...bounds, 'limit']);
  const limit = data.limit === undefined ? '100' : data.limit;
  if (
    typeof limit !== 'string' ||
    !/^\d{1,3}$/.test(limit) ||
    +limit < 1 ||
    +limit > 200
  )
    invalid('limit (use 1 to 200)');
  const bounded = bounds.some((key) => data[key] !== undefined);
  function bound(key: (typeof bounds)[number], max: number) {
    if (!bounded) return null;
    const value = data[key];
    if (
      typeof value !== 'string' ||
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
    )
      invalid(key);
    return coordinate(Number(value), key, max);
  }
  const south = bound('south', 90);
  const north = bound('north', 90);
  if (south !== null && north !== null && south > north)
    invalid('latitude bounds');
  return {
    south,
    north,
    west: bound('west', 180),
    east: bound('east', 180),
    limit: Number(limit),
  };
}
export type StationFilter = ReturnType<typeof stationFilter>;
