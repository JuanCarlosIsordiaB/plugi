import { BadRequestException, UnauthorizedException } from '@nestjs/common';

function invalid(field: string): never {
  throw new BadRequestException('Invalid ' + field + '.');
}
export function bodyFields(
  value: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    invalid('request body');
  if (Object.keys(value).some((field) => !allowed.includes(field)))
    invalid('request field');
  return value as Record<string, unknown>;
}
export function stringField(value: unknown, field: string, max = 128): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    value.includes('\0')
  )
    invalid(field);
  return value;
}
export function emailField(value: unknown): string {
  const email = stringField(value, 'email', 254).trim().toLowerCase();
  const [local, domain, ...extra] = email.split('@');
  const atom = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+$/;
  const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (
    !domain ||
    extra.length ||
    local.length > 64 ||
    !local.split('.').every((part) => atom.test(part)) ||
    !domain.includes('.') ||
    !domain.split('.').every((part) => label.test(part))
  )
    invalid('email');
  return email;
}
export function newPassword(value: unknown): string {
  const password = stringField(value, 'password');
  if (
    password.length < 8 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^a-z\d\s]/i.test(password)
  ) {
    throw new BadRequestException(
      'Use 8–128 characters with uppercase, lowercase, a number and a symbol.',
    );
  }
  return password;
}
export function challengeId(value?: string): string {
  if (
    !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
      value ?? '',
    )
  ) {
    throw new UnauthorizedException('Invalid or expired challenge.');
  }
  return (value as string).toLowerCase();
}
export function otp(value: string): string {
  if (!/^\d{6}$/.test(value)) invalid('code');
  return value;
}
export function resetToken(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) invalid('reset token');
  return value;
}
