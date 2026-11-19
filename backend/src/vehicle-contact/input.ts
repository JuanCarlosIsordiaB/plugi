import { BadRequestException } from '@nestjs/common';
import { bodyFields, stringField } from '../auth/input.js';

const defaultMessage = 'Hello! How much longer will you be charging?';
const plateKeys = ['plate', 'plateCountry', 'plateRegion'] as const;

function normalized(value: unknown, name: string, pattern: RegExp) {
  const raw = stringField(value, name, 48).trim();
  if (!/^[a-z0-9 -]+$/i.test(raw))
    throw new BadRequestException('Invalid ' + name + '.');
  const result = raw.toUpperCase().replace(/[ -]/g, '');
  if (!pattern.test(result))
    throw new BadRequestException('Invalid ' + name + '.');
  return result;
}
function vin(value: unknown) {
  return normalized(value, 'VIN', /^[A-HJ-NPR-Z0-9]{17}$/);
}
function plate(data: Record<string, unknown>) {
  return {
    plate: normalized(data.plate, 'plate', /^[A-Z0-9]{1,12}$/),
    plateCountry: normalized(data.plateCountry, 'plate country', /^[A-Z]{2}$/),
    plateRegion: normalized(
      data.plateRegion,
      'plate region',
      /^[A-Z0-9]{1,12}$/,
    ),
  };
}
export function registration(input: unknown) {
  const data = bodyFields(input, ['vin', ...plateKeys]);
  return {
    vin: vin(data.vin),
    ...plate(data),
  };
}
export function messageBody(value: unknown) {
  const text = stringField(value, 'message', 500);
  if (
    /[\p{Cc}\p{Cf}<>]/u.test(text) ||
    /(?:[a-z][a-z\d+.-]*:\/\/|www\.|\b(?:fuck\s+you|kill\s+yourself)\b)/iu.test(
      text,
    )
  )
    throw new BadRequestException(
      'Use a respectful plain-text charging message without links.',
    );
  return text.trim();
}
function identifier(data: Record<string, unknown>) {
  if (data.vin !== undefined) {
    if (plateKeys.some((key) => data[key] !== undefined))
      throw new BadRequestException('Use one vehicle identifier.');
    return { vin: vin(data.vin) };
  }
  return plate(data);
}
export function lookupIdentifier(input: unknown) {
  return identifier(bodyFields(input, ['vin', ...plateKeys]));
}
export function initiation(input: unknown) {
  const data = bodyFields(input, ['vin', ...plateKeys, 'message']);
  return {
    target: identifier(data),
    message:
      data.message === undefined ? defaultMessage : messageBody(data.message),
  };
}
export function choice<T extends string>(
  value: unknown,
  options: readonly T[],
): T {
  if (!options.includes(value as T))
    throw new BadRequestException('Invalid selection.');
  return value as T;
}
