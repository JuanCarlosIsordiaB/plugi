import { useSyncExternalStore } from 'react';

const base = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api/v1').replace(/\/$/, '');

export const statusLabels = {
  available: 'Available',
  occupied: 'Occupied',
  out_of_service: 'Out of service',
  unreported: 'Unreported',
} as const;
export type Status = keyof typeof statusLabels;
export type ReportStatus = Exclude<Status, 'unreported'>;
export const reportStatuses: ReportStatus[] = ['available', 'occupied', 'out_of_service'];
export function isReportStatus(value: unknown): value is ReportStatus {
  return reportStatuses.includes(value as ReportStatus);
}
export const defaultReportDuration = 30;
export const maxReportDuration = 720;
export function parseReportDuration(value: unknown) {
  if (typeof value !== 'string' || !/^\d{1,3}$/.test(value)) return undefined;
  const duration = Number(value);
  return duration >= 1 && duration <= maxReportDuration ? duration : undefined;
}
export interface Station {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  latestReportAt: string | null;
  statusAsOf: string;
  nextStatusChangeAt: string | null;
  counts: Record<Status, number>;
}
export interface Charger {
  id: string;
  label: string;
  latitude: number | null;
  longitude: number | null;
  connectorTypes: string[];
  status: Status;
  latestReportAt: string | null;
  occupiedUntil: string | null;
  availableByTimer: boolean;
}
export interface StationDetail extends Station {
  chargers: Charger[];
}
interface Tokens { accessToken: string; refreshToken: string }
interface Challenge { requiresTwoFactor: true; challengeId: string }
export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(base + path, { ...options, credentials: 'omit', cache: 'no-store' });
  } catch (cause) {
    if (options?.signal?.aborted) throw cause;
    throw new Error('Cannot reach buscaPila. Check your connection and try again.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(response.status, typeof body?.message === 'string' ? body.message : 'The request failed. Please try again.');
  }
  const body = await response.text();
  return body ? JSON.parse(body) as T : undefined as T;
}

const listeners = new Set<() => void>();
let tokens: Tokens | null = null;
let refreshFlight: { original: Tokens; promise: Promise<Tokens> } | null = null;
function setTokens(next: Tokens | null) {
  tokens = next;
  listeners.forEach(fn => fn());
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function useSignedIn() {
  return useSyncExternalStore(subscribe, () => !!tokens, () => false);
}

export function useSessionVersion() {
  return useSyncExternalStore(subscribe, () => tokens ? sessionNumber : 0, () => 0);
}
export function signIn(email: string, password: string, signal: AbortSignal) {
  return request<Tokens | Challenge>('/auth/sign-in', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }), signal,
  });
}
export function verifyCode(code: string, challenge: string, signal: AbortSignal) {
  return request<Tokens>('/auth/2fa/sign-in/' + encodeURIComponent(code), {
    method: 'POST', headers: { 'x-challenge-id': challenge }, signal,
  });
}
const expired = () => new ApiError(401, 'Sign in again to continue.');

async function rotate(original: Tokens): Promise<Tokens> {
  if (refreshFlight?.original === original) return refreshFlight.promise;
  const promise = request<Tokens>('/auth/refresh', {
    method: 'POST', headers: { Authorization: 'Bearer ' + original.refreshToken },
  }).then(next => {
    if (tokens !== original) throw expired();
    setTokens(next);
    return next;
  }).catch(error => {
    if (tokens === original && error instanceof ApiError && error.status === 401) setTokens(null);
    throw error;
  }).finally(() => {
    if (refreshFlight?.original === original) refreshFlight = null;
  });
  refreshFlight = { original, promise };
  return promise;
}

let sessionNumber = 0;
export function startSession(pair: Tokens) {
  sessionNumber++;
  setTokens(pair);
}
export async function authenticated<T>(path: string, options: RequestInit = {}) {
  const original = tokens;
  const identity = sessionNumber;
  if (!original) throw expired();
  const send = (pair: Tokens) => {
    if (options.signal?.aborted) throw options.signal.reason;
    const headers = new Headers(options.headers);
    headers.set('Authorization', 'Bearer ' + pair.accessToken);
    return request<T>(path, { ...options, headers });
  };
  try { return await send(original); }
  catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    if (!tokens || sessionNumber !== identity) throw expired();
    const next = tokens === original ? await rotate(original) : tokens;
    try { return await send(next); }
    catch (retryError) {
      if (retryError instanceof ApiError && retryError.status === 401 && tokens === next) setTokens(null);
      throw retryError;
    }
  }
}
export async function signOut() {
  const identity = sessionNumber;
  await authenticated('/auth/logout', { method: 'POST' });
  if (identity === sessionNumber) { sessionNumber++; setTokens(null); }
}
export function submitReport(id: string, charger: string, status: ReportStatus, durationMinutes?: number) {
  return authenticated<{ id: string; chargerId: string; reportedAt: string; status: ReportStatus; occupiedUntil: string | null }>(
    '/stations/' + encodeURIComponent(id) + '/chargers/' + encodeURIComponent(charger) + '/reports',
    jsonRequest('POST', { status, durationMinutes: status === 'occupied' ? durationMinutes : undefined }),
  );
}

export function jsonRequest(method: 'POST' | 'PUT', body: object): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
