import { useEffect, useMemo, useRef, useState } from 'react';
import type { Station } from './api';
import { useResource } from './ui.web';

export interface StationStatusClock {
  serverTime: number;
  receivedTime: number;
}

function statusChangeTime(value?: string | null) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : undefined;
}

function remainingMilliseconds(deadline: number, { serverTime, receivedTime }: StationStatusClock) {
  return deadline - serverTime - Math.max(0, performance.now() - receivedTime);
}

export function watchRemainingTime(
  until: string,
  clock: StationStatusClock,
  onChange: (seconds: number) => void,
  { everySecond = false } = {},
) {
  const deadline = statusChangeTime(until);
  if (deadline === undefined) return;
  const end = deadline;
  let timer: ReturnType<typeof setTimeout>;
  function tick() {
    clearTimeout(timer);
    const remaining = remainingMilliseconds(end, clock);
    onChange(Math.max(0, Math.ceil(remaining / 1000)));
    if (remaining <= 0) return;
    const unit = !everySecond && remaining > 60_000 ? 60_000 : 1000;
    timer = setTimeout(tick, (remaining % unit || unit) + 25);
  }
  timer = setTimeout(tick, 0);
  document.addEventListener('visibilitychange', tick);
  return () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', tick);
  };
}

export function useStationStatusResource<T extends Station | Station[]>(path: string | null) {
  const resource = useResource<T>(path, false, { retainData: true });
  const { data, error, pending, receivedAt, retry } = resource;
  const stations = Array.isArray(data) ? data : data ? [data] : [];
  const serverTime = statusChangeTime(stations[0]?.statusAsOf) ?? receivedAt?.wall;
  const receivedTime = receivedAt?.monotonic;
  const clock = useMemo(() => serverTime === undefined || receivedTime === undefined ? undefined : { serverTime, receivedTime },
    [serverTime, receivedTime]);
  let deadline: number | undefined;
  for (const station of stations) {
    const time = statusChangeTime(station.nextStatusChangeAt);
    if (time !== undefined && (deadline === undefined || time < deadline)) deadline = time;
  }
  const lastDeadlineRefresh = useRef<{ path: string; time: number }>(undefined);
  useEffect(() => {
    if (!path || deadline === undefined || !clock || pending || error) return;
    if (lastDeadlineRefresh.current?.path === path && lastDeadlineRefresh.current.time === deadline) return;
    const remaining = remainingMilliseconds(deadline, clock);
    const timeout = setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      lastDeadlineRefresh.current = { path, time: deadline };
      retry();
    }, Math.max(0, remaining) + 150);
    return () => clearTimeout(timeout);
  }, [path, deadline, pending, error, clock, retry]);
  useEffect(() => {
    if (!path) return;
    function onVisible() {
      if (document.visibilityState === 'visible') retry();
    }
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) onVisible();
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [path, retry]);
  return { ...resource, clock };
}

export function RemainingTime({ until, clock, prefix = '' }: { until: string; clock: StationStatusClock; prefix?: string }) {
  const deadline = statusChangeTime(until);
  const { serverTime, receivedTime } = clock;
  const [seconds, setSeconds] = useState(() => deadline === undefined ? 0 : Math.ceil(remainingMilliseconds(deadline, clock) / 1000));
  useEffect(() => watchRemainingTime(until, { serverTime, receivedTime }, setSeconds), [until, serverTime, receivedTime]);
  if (deadline === undefined) return null;
  const text = seconds <= 0 ? 'Estimate ended' : prefix + (seconds < 60
    ? seconds + ' sec remaining' : 'About ' + Math.ceil(seconds / 60) + ' min remaining');
  return <time className="bp-timer-note" dateTime={until} title={new Date(deadline).toLocaleString()}>{text}</time>;
}
