import type { LatLng, LatLngTuple, Map as LeafletMap, Point, PointTuple } from 'leaflet';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { statusLabels, type Station, type Status } from './api';
import { type StationStatusClock, watchRemainingTime } from './stationStatus.web';

export interface Pin {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  number?: number;
  stationId?: string;
  status?: Status;
  counts?: Station['counts'];
  nextStatusChangeAt?: string | null;
}
export function stationAvailability(counts: Station['counts']) {
  if (counts.available) return { status: 'available', label: counts.available + ' available' };
  if (counts.occupied && !counts.unreported && !counts.out_of_service) return { status: 'occupied', label: 'Occupied' };
  if (counts.out_of_service && !counts.unreported && !counts.occupied) return { status: 'out_of_service', label: 'Out of service' };
  if (counts.occupied || counts.out_of_service) return { status: 'unreported', label: '0 available' };
  return { status: 'unreported', label: counts.unreported ? 'No reports' : 'No chargers' };
}
export interface Camera { center: LatLngTuple; zoom: number }
export const initialCamera: Camera = { center: [19.418, -99.168], zoom: 13 };
export const chargerPinZoom = 15;
const clusterRadius = 72;
const detailPinWidth = 116;
const detailPinHeight = 58;
const detailPinSpacingX = detailPinWidth + 4;
const detailPinSpacingY = detailPinHeight + 8;

function pinPosition(pin: Pin, centerLongitude: number): LatLngTuple {
  const longitude = pin.longitude + 360 * Math.round((centerLongitude - pin.longitude) / 360);
  return [pin.latitude, longitude];
}

function pinChargerCount(pin: Pin) {
  return pin.stationId ? 1 : Object.values(pin.counts ?? {}).reduce((sum, value) => sum + value, 0);
}

function chargerUnit(count: number) {
  return count === 1 ? 'charger' : 'chargers';
}

function chargerCountLabel(count: number) {
  return count + ' ' + chargerUnit(count);
}

function chargerCountHeading(count: number) {
  const heading = document.createElement('span');
  heading.className = 'bp-map-pin-count';
  const number = document.createElement('strong');
  number.textContent = String(count);
  heading.append(number, ' ' + chargerUnit(count));
  return heading;
}

function groupAvailability(pins: Pin[]) {
  const counts: Station['counts'] = { available: 0, occupied: 0, out_of_service: 0, unreported: 0 };
  for (const pin of pins) {
    if (pin.counts) {
      counts.available += pin.counts.available;
      counts.occupied += pin.counts.occupied;
      counts.out_of_service += pin.counts.out_of_service;
      counts.unreported += pin.counts.unreported;
    } else if (pin.status) counts[pin.status]++;
  }
  return stationAvailability(counts);
}

function appendPinLabels(face: HTMLElement, title: string | HTMLElement, status: string) {
  const heading = document.createElement('span');
  heading.className = 'bp-map-pin-heading';
  heading.append(title);
  const subtitle = document.createElement('span');
  subtitle.className = 'bp-map-pin-status';
  subtitle.textContent = status;
  face.append(heading, subtitle);
}

function pinIcon(L: typeof import('leaflet'), face: HTMLElement, iconSize: PointTuple, pointed: boolean) {
  return L.divIcon({
    className: 'bp-marker' + (pointed ? ' bp-point-marker' : ''),
    html: face,
    iconSize,
    iconAnchor: [iconSize[0] / 2, pointed ? iconSize[1] - 3 : iconSize[1] / 2],
  });
}

interface PinGroup {
  point: Point;
  pins: Pin[];
}

function stationGroups(map: LeafletMap, pins: Pin[]): PinGroup[] {
  const groups: PinGroup[] = [];
  const center = map.getCenter().lng;
  for (const pin of pins) {
    const point = map.latLngToLayerPoint(pinPosition(pin, center));
    let nearest: PinGroup | undefined;
    let distance = clusterRadius;
    for (const group of groups) {
      const separation = group.point.distanceTo(point);
      if (separation <= distance) {
        distance = separation;
        nearest = group;
      }
    }
    if (!nearest) {
      groups.push({ point, pins: [pin] });
      continue;
    }
    const count = nearest.pins.length;
    nearest.point = nearest.point.multiplyBy(count).add(point).divideBy(count + 1);
    nearest.pins.push(pin);
  }
  return groups;
}

function overlappingPinGroups(map: LeafletMap, pins: Pin[]) {
  const center = map.getCenter().lng;
  const projected = pins.map(pin => {
    const point = map.latLngToLayerPoint(pinPosition(pin, center));
    return { pin, point, x: Math.floor(point.x / detailPinSpacingX), y: Math.floor(point.y / detailPinSpacingY) };
  });
  const key = (x: number, y: number) => x + ':' + y;
  const cells = new Map<string, Set<typeof projected[number]>>();
  for (const item of projected) {
    const id = key(item.x, item.y);
    if (!cells.has(id)) cells.set(id, new Set());
    cells.get(id)?.add(item);
  }
  const groups: Pin[][] = [];
  const remaining = new Set(projected);
  for (const first of remaining) {
    const connected = [first];
    remaining.delete(first);
    cells.get(key(first.x, first.y))?.delete(first);
    for (const item of connected) {
      for (let x = item.x - 1; x <= item.x + 1; x++) {
        for (let y = item.y - 1; y <= item.y + 1; y++) {
          const neighbors = cells.get(key(x, y));
          if (!neighbors) continue;
          for (const neighbor of neighbors) {
            if (Math.abs(item.point.x - neighbor.point.x) >= detailPinSpacingX ||
                Math.abs(item.point.y - neighbor.point.y) >= detailPinSpacingY) continue;
            connected.push(neighbor);
            remaining.delete(neighbor);
            neighbors.delete(neighbor);
          }
        }
      }
    }
    groups.push(connected.map(item => item.pin));
  }
  return groups;
}

function addCluster(
  L: typeof import('leaflet'), map: LeafletMap, markers: import('leaflet').LayerGroup,
  group: Pin[], center: LatLng | LatLngTuple,
  results?: {
    open: (keyboard: boolean, source?: HTMLElement) => void;
    stationSelected: boolean;
    selectedGroup?: string;
    clock?: StationStatusClock;
  },
) {
  const key = (results ? 'charger:' : 'station:') + group.map(pin => pin.id).sort().join(',');
  const current = results?.stationSelected || results?.selectedGroup === key;
  const count = group.reduce((total, pin) => total + pinChargerCount(pin), 0);
  const chargers = chargerCountLabel(count);
  const label = (results ? 'Show station results for ' : 'Zoom in on ') + chargers;
  const face = document.createElement('span');
  const availability = results ? groupAvailability(group) : undefined;
  const heading = chargerCountHeading(count);
  face.className = 'bp-pin-cluster' + (availability ? ' bp-pin-overlap ' + availability.status : '') +
    (current ? ' selected' : '');
  if (availability) appendPinLabels(face, heading, availability.label);
  else face.append(heading);
  const iconSize: PointTuple = results ? [detailPinWidth, detailPinHeight] : [44, 44];
  const marker = L.marker(center, {
    icon: pinIcon(L, face, iconSize, !!results),
    title: label, alt: label, autoPanOnFocus: false, zIndexOffset: current ? 1000 : 0,
  }).addTo(markers);
  const zoomIn = () => {
    const bounds = L.latLngBounds(group.map(pin => pinPosition(pin, L.latLng(center).lng)));
    const fit = map.getBoundsZoom(bounds, false, L.point(100, 100));
    const zoom = Math.min(chargerPinZoom, Math.max(map.getZoom() + 2, fit));
    map.setView(center, zoom, { animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches });
  };
  const element = marker.getElement();
  marker.on('click', () => results ? results.open(false, element) : zoomIn());
  if (element) {
    element.dataset.cluster = key;
    if (results) {
      element.dataset.chargerGroup = 'true';
      element.setAttribute('aria-pressed', String(current));
    }
    element.setAttribute('aria-label', label);
    if (availability) element.setAttribute('aria-description', availability.label + '.');
    element.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      if (results) results.open(true, element);
      else {
        map.getContainer().focus({ preventScroll: true });
        zoomIn();
      }
    });
  }
  let nextEstimate: string | undefined;
  const clock = results?.clock;
  if (clock) {
    for (const { nextStatusChangeAt } of group) {
      if (nextStatusChangeAt && (!nextEstimate || nextStatusChangeAt < nextEstimate)) nextEstimate = nextStatusChangeAt;
    }
  }
  const stopEstimate = element && clock && nextEstimate ?
    showPinEstimate(face, element, nextEstimate, clock, true) : undefined;
  return { element, stopEstimate };
}

function showPinEstimate(face: HTMLElement, marker: HTMLElement, until: string, clock: StationStatusClock, compact: boolean) {
  const badge = document.createElement('time');
  badge.className = 'bp-pin-timer' + (compact ? '' : ' bp-pin-timer-float');
  badge.dateTime = until;
  badge.setAttribute('aria-hidden', 'true');
  const baseDescription = marker.getAttribute('aria-description');
  return watchRemainingTime(until, clock, seconds => {
    const active = badge.parentElement === face;
    if (!seconds) {
      if (active) {
        badge.remove();
        if (baseDescription) marker.setAttribute('aria-description', baseDescription);
        else marker.removeAttribute('aria-description');
      }
      return;
    }
    const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
    const remainder = String(seconds % 60).padStart(2, '0');
    const text = 'Est. ends in ' + minutes + ':' + remainder;
    if (badge.textContent !== text) badge.textContent = text;
    if (!active) {
      face.append(badge);
      const endTime = new Date(until).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
      marker.setAttribute('aria-description', (baseDescription ? baseDescription + ' ' : '') + 'Next occupied estimate ends at ' + endTime + '.');
    }
  }, { everySecond: true });
}

interface Props {
  camera: Camera;
  position?: LatLngTuple;
  pins: Pin[];
  selected?: string;
  selectedGroup?: string;
  inert?: boolean;
  clock?: StationStatusClock;
  clusterStations?: boolean;
  onSelect?: (id: string, keyboard: boolean, source?: HTMLElement) => void;
  onSelectGroup?: (stationIds: string[], keyboard: boolean, sourceId?: string) => void;
  onMove?: (camera: Camera, query: string) => void;
}

export default function MapPanel({ camera, pins, position, selected, selectedGroup, inert, clock, clusterStations = false, onSelect, onSelectGroup, onMove }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const centeredPosition = useRef<LatLngTuple | undefined>(undefined);
  const focusedPin = useRef<string | undefined>(undefined);
  const [loaded, setLoaded] = useState<{ L: typeof import('leaflet'); map: LeafletMap }>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const initialView = useEffectEvent(() => camera);
  const select = useEffectEvent((id: string, keyboard: boolean, source?: HTMLElement) => onSelect?.(id, keyboard, source));
  const selectGroup = useEffectEvent((ids: string[], keyboard: boolean, source?: HTMLElement) => {
    if (ids.length > 1 && onSelectGroup) onSelectGroup(ids, keyboard, source?.dataset.cluster);
    else onSelect?.(ids[0], keyboard, source);
  });
  const publish = useEffectEvent((map: LeafletMap) => {
    const bounds = map.getBounds();
    const world = bounds.getEast() - bounds.getWest() >= 360;
    const wrap = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;
    const center = map.getCenter();
    const query = new URLSearchParams({
      south: String(Math.max(-90, bounds.getSouth())), north: String(Math.min(90, bounds.getNorth())),
      west: String(world ? -180 : wrap(bounds.getWest())), east: String(world ? 180 : wrap(bounds.getEast())), limit: '200',
    });
    onMove?.({ center: [center.lat, center.lng], zoom: map.getZoom() }, query.toString());
  });
  useEffect(() => {
    let disposed = false;
    let map: LeafletMap | undefined;
    let observer: ResizeObserver | undefined;
    let tileFailed = false;
    void import('leaflet').then(L => {
      if (disposed || !host.current) return;
      const start = initialView();
      const instance = L.map(host.current, { center: start.center, zoom: start.zoom, zoomControl: false, minZoom: 2, worldCopyJump: true });
      map = instance;
      const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      });
      tiles.on('loading', () => { tileFailed = false; });
      tiles.on('tileerror', () => { tileFailed = true; });
      tiles.on('load', () => { if (!disposed) setError(tileFailed ? 'Some map tiles could not load.' : ''); });
      tiles.addTo(instance);
      const moved = () => publish(instance);
      instance.on('moveend resize', moved);
      observer = new ResizeObserver(() => { instance.invalidateSize(); });
      observer.observe(host.current);
      setLoaded({ L, map: instance });
      moved();
    }).catch(() => { if (!disposed) setError('The map could not load.'); });
    return () => { disposed = true; observer?.disconnect(); map?.remove(); };
  }, [attempt]);

  useEffect(() => {
    if (!loaded || !position || centeredPosition.current === position) return;
    loaded.map.setView(position, 14, { animate: false });
    centeredPosition.current = position;
  }, [loaded, position]);

  useEffect(() => {
    if (!loaded || !position) return;
    const { L, map } = loaded;
    const marker = L.marker(position, {
      icon: L.divIcon({ className: 'bp-user-location', iconSize: [18, 18], iconAnchor: [9, 9] }),
      keyboard: false, interactive: false, title: 'Your location', zIndexOffset: -100,
    }).addTo(map);
    marker.getElement()?.setAttribute('aria-label', 'Your location');
    return () => { marker.remove(); };
  }, [loaded, position]);

  const interactive = !!onSelect;
  const zoom = camera.zoom;
  useEffect(() => {
    if (!loaded) return;
    const { L, map } = loaded;
    const markers = L.layerGroup().addTo(map);
    const stopEstimates: (() => void)[] = [];
    function restoreFocus(element: HTMLElement, key?: string) {
      if (key && focusedPin.current === key && document.activeElement === document.body) element.focus({ preventScroll: true });
    }
    const compact = clusterStations && zoom >= chargerPinZoom;
    const singlePins = compact ? overlappingPinGroups(map, pins).flatMap(group => {
      if (group.length === 1) return group;
      const anchor = group.find(pin => pin.stationId) ?? group[0];
      const stationIds = [...new Set(group.map(pin => pin.stationId ?? pin.id))];
      const { element, stopEstimate } = addCluster(L, map, markers, group, pinPosition(anchor, map.getCenter().lng),
        {
          open: (keyboard, source) => selectGroup(stationIds, keyboard, source),
          stationSelected: stationIds.length === 1 && selected === stationIds[0],
          selectedGroup,
          clock,
        });
      if (element) restoreFocus(element, element.dataset.cluster);
      if (stopEstimate) stopEstimates.push(stopEstimate);
      return [];
    }) : clusterStations ? stationGroups(map, pins).flatMap(group => {
      if (group.pins.length === 1) return group.pins;
      const { element } = addCluster(L, map, markers, group.pins, map.layerPointToLatLng(group.point));
      if (element) restoreFocus(element, element.dataset.cluster);
      return [];
    }) : pins;
    for (const pin of singlePins) {
      const face = document.createElement('span');
      const availability = pin.counts ? stationAvailability(pin.counts) :
        pin.stationId && pin.status ? { status: pin.status, label: statusLabels[pin.status] } : undefined;
      const stationId = pin.stationId ?? pin.id;
      const current = selected === stationId;
      face.className = 'bp-pin ' + (availability?.status ?? pin.status ?? '') + (current ? ' selected' : '');
      if (availability) {
        face.classList.add('bp-pin-pill');
        if (compact) {
          face.classList.add('bp-compact-pin');
          if (pin.stationId) face.classList.add('bp-charger-pill');
          const title = pin.stationId ? 'Charger ' + pin.number : chargerCountHeading(pinChargerCount(pin));
          appendPinLabels(face, title, availability.label);
        } else {
          const status = document.createElement('span');
          status.className = 'bp-map-pin-status';
          status.textContent = availability.label;
          face.append(status);
        }
      } else if (pin.number) face.textContent = String(pin.number).padStart(2, '0');
      else {
        const dot = document.createElement('span');
        dot.className = 'bp-map-marker-dot';
        dot.setAttribute('aria-hidden', 'true');
        face.append(dot);
      }
      const label = availability ? pin.name + ', ' + availability.label +
        (compact && !pin.stationId ? ', ' + chargerCountLabel(pinChargerCount(pin)) : '') :
        pin.status ? pin.name + ', ' + statusLabels[pin.status] : pin.name;
      const iconSize: PointTuple = compact ? [detailPinWidth, detailPinHeight] : [44, 44];
      const marker = L.marker(pinPosition(pin, map.getCenter().lng), {
        icon: pinIcon(L, face, iconSize, true),
        title: label, alt: label, interactive, keyboard: interactive, zIndexOffset: current ? 1000 : 0,
      }).addTo(markers);
      const element = marker.getElement();
      element?.setAttribute('aria-label', label);
      if (element && availability && pin.nextStatusChangeAt && clock) {
        const stopEstimate = showPinEstimate(face, element, pin.nextStatusChangeAt, clock, compact);
        if (stopEstimate) stopEstimates.push(stopEstimate);
      }
      if (interactive && element) {
        element.dataset.pin = pin.id;
        if (pin.stationId) element.dataset.chargerPin = pin.id;
        element.setAttribute('aria-pressed', String(current));
        element.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            select(stationId, true, element);
          }
        });
        marker.on('click', () => select(stationId, false, element));
        restoreFocus(element, pin.id);
      }
    }
    if (focusedPin.current && document.activeElement === document.body) map.getContainer().focus({ preventScroll: true });
    focusedPin.current = undefined;
    return () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && map.getContainer().contains(active)) focusedPin.current = active.dataset.cluster ?? active.dataset.pin;
      stopEstimates.forEach(stop => stop());
      markers.remove();
    };
  }, [loaded, pins, selected, selectedGroup, interactive, clock, clusterStations, zoom]);

  return <section className="bp-map" aria-label="Charging map" inert={inert}>
    <div ref={host} className="bp-map-surface" aria-label="Interactive charging map" />
    {error && <div className="bp-map-error" role="status">{error} <button type="button" onClick={() => { setError(''); setLoaded(undefined); setAttempt(n => n + 1); }}>Retry map</button></div>}
  </section>;
}
