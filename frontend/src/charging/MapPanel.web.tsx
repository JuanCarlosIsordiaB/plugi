import type { LatLngTuple, Map as LeafletMap } from 'leaflet';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import type { Station, Status } from './api';

export interface Pin {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  number?: number;
  status?: Status;
  counts?: Station['counts'];
}
export function stationAvailability(counts: Station['counts']) {
  if (counts.available) return { status: 'available', label: counts.available + ' reported available' };
  if (counts.occupied && !counts.unreported && !counts.out_of_service) return { status: 'occupied', label: 'Occupied' };
  if (counts.out_of_service && !counts.unreported && !counts.occupied) return { status: 'out_of_service', label: 'Out of service' };
  if (counts.occupied || counts.out_of_service) return { status: 'unreported', label: '0 reported available' };
  return { status: 'unreported', label: counts.unreported ? 'No reports' : 'No chargers' };
}
export interface Camera { center: LatLngTuple; zoom: number }
export const initialCamera: Camera = { center: [19.418, -99.168], zoom: 13 };
interface Props {
  camera: Camera;
  position?: LatLngTuple;
  pins: Pin[];
  selected?: string;
  onSelect?: (id: string, keyboard: boolean) => void;
  onMove?: (camera: Camera, query: string) => void;
}

export default function MapPanel({ camera, pins, position, selected, onSelect, onMove }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const centeredPosition = useRef<LatLngTuple | undefined>(undefined);
  const focusedPin = useRef<string | undefined>(undefined);
  const [loaded, setLoaded] = useState<{ L: typeof import('leaflet'); map: LeafletMap }>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const initialView = useEffectEvent(() => camera);
  const select = useEffectEvent((id: string, keyboard: boolean) => onSelect?.(id, keyboard));
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
      L.control.zoom({ position: 'bottomright' }).addTo(instance);
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
  useEffect(() => {
    if (!loaded) return;
    const { L, map } = loaded;
    const markers = L.layerGroup().addTo(map);
    for (const pin of pins) {
      const face = document.createElement('span');
      const availability = pin.counts ? stationAvailability(pin.counts) : undefined;
      face.className = 'bp-pin ' + (availability?.status ?? pin.status ?? '') + (selected === pin.id ? ' selected' : '');
      if (availability) {
        face.classList.add('bp-pin-pill');
        const dot = document.createElement('i');
        dot.setAttribute('aria-hidden', 'true');
        face.append(dot, availability.label);
      } else if (pin.number) face.textContent = String(pin.number).padStart(2, '0');
      else {
        const icon = document.createElement('img');
        icon.src = '/icons/marker.svg';
        icon.alt = '';
        face.append(icon);
      }
      const longitude = pin.longitude + 360 * Math.round((map.getCenter().lng - pin.longitude) / 360);
      const label = availability ? pin.name + ', ' + availability.label : pin.name;
      const marker = L.marker([pin.latitude, longitude], {
        icon: L.divIcon({ className: availability ? 'bp-marker bp-pill-marker' : 'bp-marker', html: face, iconSize: [44, 44], iconAnchor: [22, 22] }),
        title: label, alt: label, interactive, keyboard: interactive, zIndexOffset: selected === pin.id ? 1000 : 0,
      }).addTo(markers);
      const element = marker.getElement();
      element?.setAttribute('aria-label', label);
      if (interactive && element) {
        element.dataset.pin = pin.id;
        element.setAttribute('aria-pressed', String(selected === pin.id));
        element.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            select(pin.id, true);
          }
        });
        marker.on('click', () => select(pin.id, false));
        if (focusedPin.current === pin.id && document.activeElement === document.body) element.focus({ preventScroll: true });
      }
    }
    focusedPin.current = undefined;
    return () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.dataset.pin && map.getContainer().contains(active)) focusedPin.current = active.dataset.pin;
      markers.remove();
    };
  }, [loaded, pins, selected, interactive]);

  return <section className="bp-map" aria-label="Charging map">
    <div ref={host} className="bp-map-surface" aria-label="Interactive charging map" />
    {error && <div className="bp-map-error" role="status">{error} <button type="button" onClick={() => { setError(''); setLoaded(undefined); setAttempt(n => n + 1); }}>Retry map</button></div>}
  </section>;
}
