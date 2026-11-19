import type { LatLngTuple } from 'leaflet';
import type { PointerEvent } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Station } from './api';
import MapPanel, { initialCamera, stationAvailability } from './MapPanel.web';
import { Age, AppLink, Brand, Feedback, Icon, Nav, useResource } from './ui.web';

let lastCamera = initialCamera;
let lastSelected: string | undefined;
let lastSearch = '';
let lastAvailableOnly = false;
let lastStationsOpen: boolean | undefined;
let lastBounds = 'south=19.32&west=-99.25&north=19.46&east=-99.07&limit=200';
const stationPanelBreakpoint = '(max-width: 700px)';
const gripDragSlop = 6;

interface StationGripDrag {
  pointerId: number;
  startX: number;
  startY: number;
  startOffset: number;
  travel: number;
  moved: boolean;
}

function subscribeToWideScreen(onChange: () => void) {
  const media = window.matchMedia(stationPanelBreakpoint);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function isWideScreen() {
  return !window.matchMedia(stationPanelBreakpoint).matches;
}

function defaultWideScreen() {
  return false;
}

function distanceFrom([latitude, longitude]: LatLngTuple, station: Station) {
  const radians = Math.PI / 180;
  const a = Math.sin((station.latitude - latitude) * radians / 2) ** 2
    + Math.cos(latitude * radians) * Math.cos(station.latitude * radians)
    * Math.sin((station.longitude - longitude) * radians / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, a)));
}

function formatDistance(km: number) {
  return km < 1 ? Math.round(km * 1000) + ' m' : km.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' km';
}

export default function Explore() {
  const [bounds, setBounds] = useState(lastBounds);
  const [search, setSearch] = useState(lastSearch);
  const [availableOnly, setAvailableOnly] = useState(lastAvailableOnly);
  const [stationsOpenPreference, setStationsOpenPreference] = useState(lastStationsOpen);
  const wideScreen = useSyncExternalStore(subscribeToWideScreen, isWideScreen, defaultWideScreen);
  const stationsOpen = stationsOpenPreference ?? wideScreen;
  const [selection, setSelection] = useState<{ id: string; keyboard?: boolean } | undefined>(
    () => lastSelected === undefined ? undefined : { id: lastSelected },
  );
  const selectedId = selection?.id;
  const [position, setPosition] = useState<LatLngTuple>();
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const [searchControlsOpen, setSearchControlsOpen] = useState(false);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const searchPanel = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const requestNumber = useRef(0);
  const explorer = useRef<HTMLDivElement>(null);
  const drawer = useRef<HTMLDivElement>(null);
  const grip = useRef<HTMLButtonElement>(null);
  const gripDrag = useRef<StationGripDrag | null>(null);
  const suppressGripClick = useRef(false);
  const stationResults = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listHeading = useRef<HTMLDivElement>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const focusResultsOnOpen = useRef(false);
  const { data, error, retry } = useResource<Station[]>('/stations?' + bounds);
  const filter = search.trim().toLocaleLowerCase();
  const results = useMemo(() => {
    const matches = (data ?? [])
      .filter(station => (!availableOnly || station.counts.available > 0)
        && (station.name + ' ' + station.address).toLocaleLowerCase().includes(filter))
      .map(station => ({ station, distance: position ? distanceFrom(position, station) : undefined }));
    if (position) matches.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    return matches;
  }, [data, filter, position, availableOnly]);
  const pins = useMemo(() => results.map(result => result.station), [results]);
  const selected = pins.find(pin => pin.id === selectedId);
  const filterCount = Number(Boolean(filter)) + Number(availableOnly);
  const hasFilters = filterCount > 0;
  useEffect(() => {
    lastSearch = search;
    lastAvailableOnly = availableOnly;
  }, [search, availableOnly]);
  useEffect(() => {
    if (stationsOpen && focusResultsOnOpen.current) {
      focusResultsOnOpen.current = false;
      stationResults.current?.scrollTo({ top: 0 });
      resultsHeading.current?.focus({ preventScroll: true });
    }
  }, [stationsOpen]);
  useLayoutEffect(() => {
    if (selection?.keyboard === undefined) return;
    const scrollRegion = stationResults.current;
    const heading = listHeading.current;
    const link = list.current?.querySelector<HTMLAnchorElement>('[data-station="' + CSS.escape(selection.id) + '"] a');
    if (!scrollRegion || !heading || !link) return;

    const regionTop = scrollRegion.getBoundingClientRect().top + scrollRegion.clientTop;
    const headingBottom = getComputedStyle(heading).position === 'sticky'
      ? heading.getBoundingClientRect().bottom : regionTop;
    const focusClearance = 6;
    const visibleTop = Math.max(regionTop, headingBottom) + focusClearance;
    const visibleBottom = regionTop + scrollRegion.clientHeight - focusClearance;
    const card = link.getBoundingClientRect();
    const scrollDelta = card.top < visibleTop || card.height > visibleBottom - visibleTop
      ? card.top - visibleTop
      : Math.max(0, card.bottom - visibleBottom);
    if (scrollDelta) scrollRegion.scrollTop += scrollDelta;
    if (selection.keyboard) link.focus({ preventScroll: true });
  }, [selection]);
  useEffect(() => () => { requestNumber.current++; clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!searchControlsOpen) return;
    searchPanel.current?.focus({ preventScroll: true });

    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      closeSearchControls();
    }

    document.addEventListener('keydown', dismissOnEscape, true);
    return () => document.removeEventListener('keydown', dismissOnEscape, true);
  }, [searchControlsOpen]);

  function closeSearchControls() {
    setSearchControlsOpen(false);
    searchTrigger.current?.focus({ preventScroll: true });
  }

  function setStationsOpen(open: boolean) {
    if (!open && stationResults.current?.contains(document.activeElement)) {
      grip.current?.focus({ preventScroll: true });
    }
    lastStationsOpen = open;
    setStationsOpenPreference(open);
  }

  function startGripDrag(event: PointerEvent<HTMLButtonElement>) {
    const sheet = drawer.current;
    const viewport = sheet?.parentElement;
    if (event.button !== 0 || !event.isPrimary || !sheet || !viewport) return;
    const sheetBounds = sheet.getBoundingClientRect();
    const travel = sheetBounds.height - event.currentTarget.offsetHeight;
    if (travel <= 0) return;

    const startOffset = sheetBounds.bottom - viewport.getBoundingClientRect().bottom;
    event.currentTarget.setPointerCapture(event.pointerId);
    gripDrag.current = {
      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      startOffset, travel, moved: false,
    };
    suppressGripClick.current = false;
    setDrawerOffset(startOffset);
  }

  function setDrawerOffset(offset: number) {
    if (!explorer.current) return;
    explorer.current.dataset.stationsDragging = 'true';
    explorer.current.style.setProperty('--bp-sheet-offset', offset + 'px');
  }

  function moveGripDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = gripDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientY - drag.startY;
    drag.moved ||= Math.hypot(event.clientX - drag.startX, delta) >= gripDragSlop;
    if (drag.moved) setDrawerOffset(Math.max(0, Math.min(drag.travel, drag.startOffset + delta)));
  }

  function finishGripDrag(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const drag = gripDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientY - drag.startY;
    const threshold = Math.min(64, drag.travel / 3);
    suppressGripClick.current = cancelled || drag.moved || Math.hypot(event.clientX - drag.startX, delta) >= gripDragSlop;
    gripDrag.current = null;
    if (explorer.current) {
      delete explorer.current.dataset.stationsDragging;
      explorer.current.style.removeProperty('--bp-sheet-offset');
    }
    if (!cancelled && Math.abs(delta) >= threshold) setStationsOpen(delta < 0);
  }

  function skipToResults() {
    if (stationsOpen) {
      resultsHeading.current?.focus();
      return;
    }
    focusResultsOnOpen.current = true;
    setStationsOpen(true);
  }

  function locate() {
    if (locating) return;
    if (!navigator.geolocation || !window.isSecureContext) {
      setLocationMessage('Location is unavailable in this browser. Move the map to choose an area.');
      return;
    }
    const request = ++requestNumber.current;
    setLocating(true);
    setLocationMessage('');
    function finish(message: string, point?: LatLngTuple) {
      if (request !== requestNumber.current) return;
      requestNumber.current++;
      clearTimeout(timer.current);
      setLocating(false);
      setLocationMessage(message);
      if (point) {
        setPosition(point);
        setSearch('');
        setSelection(undefined);
        lastSelected = undefined;
        stationResults.current?.scrollTo({ top: 0 });
      }
    }
    const timeoutMessage = 'Location timed out. Try again or move the map to choose an area.';
    timer.current = setTimeout(() => finish(timeoutMessage), 12000);
    try {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => finish('', [coords.latitude, coords.longitude]),
        failure => finish(failure.code === 1
          ? 'Location access is off. Allow it in your browser or move the map to choose an area.'
          : failure.code === 3 ? timeoutMessage : 'Your location is unavailable. Try again or move the map.'),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
      );
    } catch {
      finish('Your location is unavailable. Move the map to choose an area.');
    }
  }

  function selectPin(id: string, keyboard: boolean) {
    lastSelected = id;
    setSelection({ id, keyboard });
    if (!stationsOpen) setStationsOpen(true);
  }

  return <main className="bp-shell bp-explore">
    <header className="bp-header"><Brand /><Nav /></header>
    <div className="bp-explorer" data-stations-open={stationsOpen} ref={explorer}>
      <h1 className="bp-screen-reader">Charging map</h1>
      <div className="bp-search-controls">
        <button type="button" className="bp-search-trigger" ref={searchTrigger}
          aria-expanded={searchControlsOpen} aria-controls="bp-search-panel"
          aria-describedby={hasFilters ? 'bp-active-filters' : undefined}
          onClick={() => searchControlsOpen ? closeSearchControls() : setSearchControlsOpen(true)}>
          <Icon name="search" />Search &amp; filters
          {hasFilters && <span className="bp-search-count" aria-hidden="true">{filterCount}</span>}
        </button>
        {hasFilters && <span className="bp-screen-reader" id="bp-active-filters">
          {filterCount} active {filterCount === 1 ? 'filter' : 'filters'}
        </span>}
        <section id="bp-search-panel" ref={searchPanel} className={searchControlsOpen ? 'bp-search-panel' : undefined}
          aria-labelledby={searchControlsOpen ? 'bp-search-heading' : undefined} tabIndex={searchControlsOpen ? -1 : undefined}>
          {searchControlsOpen && <>
            <div className="bp-search-panel-heading">
              <h2 id="bp-search-heading">Search &amp; filters</h2>
              <button type="button" className="bp-square" aria-label="Close search and filters" onClick={closeSearchControls}>
                <Icon name="close" />
              </button>
            </div>
            <label className="bp-search"><Icon name="search" />
              <input type="search" placeholder="Station name or address" aria-label="Search stations by name or address in this map area"
                value={search} onChange={event => setSearch(event.target.value)} />
            </label>
            <div className="bp-tools">
              <button type="button" className="bp-locate" onClick={locate} aria-disabled={locating}>
                <span className="bp-crosshair" aria-hidden="true" />Use my location
              </button>
              <button type="button" className="bp-filter" aria-pressed={availableOnly} title="Stations with a charger reported available"
                onClick={() => setAvailableOnly(value => !value)}><span aria-hidden="true" className="bp-filter-mark" />Reported available</button>
            </div>
          </>}
          <p className={searchControlsOpen ? 'bp-location-message' : 'bp-screen-reader'} role="status">
            {locating ? 'Locating…' : locationMessage}
          </p>
        </section>
      </div>
      <button type="button" className="bp-skip" onClick={skipToResults}>Skip map to station results</button>
      <MapPanel camera={lastCamera} position={position} pins={pins} selected={selectedId} onSelect={selectPin}
        onMove={(camera, query) => { lastCamera = camera; lastBounds = query; setBounds(query); }} />
      <p className="bp-screen-reader" role="status">{data && results.length + (results.length === 1 ? ' station' : ' stations') + ' in view'}</p>
      <p className="bp-screen-reader" role="status">{selected && 'Selected ' + selected.name}</p>
      <div className="bp-station-sheet-viewport">
        <div className="bp-station-drawer" ref={drawer}>
          <button type="button" className="bp-station-grip" ref={grip} aria-label={stationsOpen ? 'Collapse station results' : 'Expand station results'}
            aria-expanded={stationsOpen} aria-controls="bp-station-results" onPointerDown={startGripDrag}
            onPointerMove={moveGripDrag} onPointerUp={finishGripDrag}
            onPointerCancel={event => finishGripDrag(event, true)}
            onLostPointerCapture={event => finishGripDrag(event, true)}
            onClick={event => {
              if (!suppressGripClick.current || event.detail === 0) setStationsOpen(!stationsOpen);
            }}
            onKeyDown={event => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
              event.preventDefault();
              setStationsOpen(event.key === 'ArrowUp');
            }}>
            <span aria-hidden="true" />
          </button>
          <section id="bp-station-results" className="bp-stations" ref={stationResults} aria-label="Stations in this map area" inert={!stationsOpen}>
            <div className="bp-list-heading" ref={listHeading}>
              <h2 ref={resultsHeading} tabIndex={-1}>Stations in view {data && <span className="bp-total">{results.length}</span>}</h2>
            </div>
            {position && <p className="bp-sort" role="status">Nearest to your location first</p>}
            {!data && <Feedback error={error} retry={retry} loading="Loading stations…" />}
            {data && !results.length && <div className="bp-empty" role="status">
              <Icon name="map" /><h3>{hasFilters ? 'No matching stations' : 'No stations in this area'}</h3>
              <p>{availableOnly ? 'No matching station in this area has a charger reported available.' :
                filter ? 'Try a different station name or address.' : 'Zoom out or move the map to explore another area.'}</p>
              {hasFilters && <button className="bp-text" onClick={() => { setSearch(''); setAvailableOnly(false); }}>Clear filters</button>}
            </div>}
            <ul className="bp-station-list" ref={list}>{results.map(({ station, distance }) => {
              const availability = stationAvailability(station.counts);
              const chargerCount = Object.values(station.counts).reduce((total, count) => total + count, 0);
              return <li key={station.id} data-station={station.id} className={station.id === selectedId ? 'current' : ''}>
                <AppLink href={{ pathname: '/stations/[id]', params: { id: station.id } }} className="bp-station-card"
                  onClick={() => { lastSelected = station.id; }} aria-current={selectedId === station.id ? 'true' : undefined}>
                  <div className="bp-card-top"><span className={'bp-availability ' + availability.status}>{availability.label}</span>
                    <span className="bp-distance">{distance !== undefined ? formatDistance(distance) + ' · ' : ''}{chargerCount} {chargerCount === 1 ? 'charger' : 'chargers'}</span></div>
                  <h3>{station.name}</h3><p className="bp-address">{station.address}</p>
                  <div className="bp-card-bottom"><span>{station.latestReportAt ? <>Latest station report <Age at={station.latestReportAt} /></> : 'No station reports yet'}</span>
                    <span className="bp-card-arrow" aria-hidden="true">↗</span></div>
                </AppLink>
              </li>;
            })}</ul>
            {data?.length === 200 && <p className="bp-muted">Showing up to 200 stations. Zoom in to narrow the area.</p>}
          </section>
        </div>
      </div>
    </div>
  </main>;
}
