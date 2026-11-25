import type { LatLngTuple } from 'leaflet';
import type { PointerEvent } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Charger, Station } from './api';
import MapPanel, { chargerPinZoom, initialCamera, stationAvailability, type Pin } from './MapPanel.web';
import { RemainingTime, useStationStatusResource } from './stationStatus.web';
import { StationSheetDetail } from './Station.web';
import { Age, Brand, Feedback, Icon, Nav } from './ui.web';

let lastCamera = initialCamera;
let lastSelected: string | undefined;
let lastSearch = '';
let lastAvailableOnly = false;
let lastListDetent: ListDetent | undefined;
let lastBounds = 'south=19.32&west=-99.25&north=19.46&east=-99.07&limit=200';
const stationPanelBreakpoint = '(max-width: 700px)';
const gripDragSlop = 6;
const listDetents = ['collapsed', 'mid', 'expanded'] as const;
type ListDetent = typeof listDetents[number];
type MapStation = Station & { chargers?: Charger[] };

interface ListGripDrag {
  heights: [number, number, number];
  offset: number;
  distance: number;
  time: number;
  y: number;
  velocity: number;
}

interface StationGripDrag {
  pointerId: number;
  startX: number;
  startY: number;
  startOffset: number;
  travel: number;
  moved: boolean;
  list?: ListGripDrag;
}

function listReleaseDetent({ heights, offset, distance, velocity }: ListGripDrag) {
  const height = heights[2] - offset;
  const flick = distance >= gripDragSlop && Math.abs(velocity) >= 0.45;
  const momentum = flick ? Math.max(-100, Math.min(100, velocity * 120)) : 0;
  const projected = height - momentum;
  let closest = 0;
  for (let index = 1; index < heights.length; index++) {
    if (Math.abs(heights[index] - projected) < Math.abs(heights[closest] - projected)) closest = index;
  }
  if (flick && velocity < 0) {
    const next = heights.findIndex(stop => stop > height + 1);
    if (next !== -1) closest = Math.max(closest, next);
  } else if (flick && velocity > 0) {
    const next = heights.findIndex(stop => stop >= height - 1) - 1;
    if (next >= 0) closest = Math.min(closest, next);
  }
  return listDetents[closest];
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

function stationChargerPins(station: MapStation): Pin[] {
  if (!station.chargers?.length) return [station];
  const pins: Pin[] = [];
  const counts: Station['counts'] = { available: 0, occupied: 0, out_of_service: 0, unreported: 0 };
  let nextStatusChangeAt: string | null = null;
  station.chargers.forEach((charger, index) => {
    if (typeof charger.latitude === 'number' && Number.isFinite(charger.latitude) &&
        typeof charger.longitude === 'number' && Number.isFinite(charger.longitude)) {
      pins.push({
        id: charger.id, stationId: station.id, name: station.name + ', ' + charger.label, number: index + 1,
        latitude: charger.latitude, longitude: charger.longitude, status: charger.status,
        nextStatusChangeAt: charger.occupiedUntil,
      });
    } else {
      counts[charger.status]++;
      if (charger.occupiedUntil && (!nextStatusChangeAt || charger.occupiedUntil < nextStatusChangeAt)) {
        nextStatusChangeAt = charger.occupiedUntil;
      }
    }
  });
  if (!pins.length) return [station];
  if (pins.length < station.chargers.length) pins.push({ ...station, counts, nextStatusChangeAt });
  return pins;
}

function revealStationCard(scrollRegion: HTMLElement, heading: HTMLElement, button: HTMLButtonElement) {
  const regionTop = scrollRegion.getBoundingClientRect().top + scrollRegion.clientTop;
  const headingBottom = getComputedStyle(heading).position === 'sticky'
    ? heading.getBoundingClientRect().bottom : regionTop;
  const focusClearance = 6;
  const visibleTop = Math.max(regionTop, headingBottom) + focusClearance;
  const visibleBottom = regionTop + scrollRegion.clientHeight - focusClearance;
  const card = button.getBoundingClientRect();
  const scrollDelta = card.top < visibleTop || card.height > visibleBottom - visibleTop
    ? card.top - visibleTop
    : Math.max(0, card.bottom - visibleBottom);
  if (scrollDelta) scrollRegion.scrollTop += scrollDelta;
}

export default function Explore() {
  const [bounds, setBounds] = useState(lastBounds);
  const [zoom, setZoom] = useState(lastCamera.zoom);
  const [search, setSearch] = useState(lastSearch);
  const [availableOnly, setAvailableOnly] = useState(lastAvailableOnly);
  const [listDetentPreference, setListDetentPreference] = useState(lastListDetent);
  const [listRevealedOnReturn, setListRevealedOnReturn] = useState(false);
  const wideScreen = useSyncExternalStore(subscribeToWideScreen, isWideScreen, defaultWideScreen);
  const preferredListDetent = listDetentPreference ?? (wideScreen ? 'mid' : 'collapsed');
  const listDetent = listRevealedOnReturn && preferredListDetent === 'collapsed' ? 'mid' : preferredListDetent;
  const listOpen = listDetent !== 'collapsed';
  const [selection, setSelection] = useState<{ id: string; keyboard?: boolean } | undefined>(
    () => lastSelected === undefined ? undefined : { id: lastSelected },
  );
  const selectedId = selection?.id;
  const [selectedGroup, setSelectedGroup] = useState<{ stationIds: Set<string>; keyboard: boolean }>();
  const [detailStation, setDetailStation] = useState<Station>();
  const [detailOpen, setDetailOpen] = useState(true);
  const stationsOpen = detailStation ? detailOpen : listOpen;
  const mobileList = !wideScreen && !detailStation;
  const fullScreenDetail = !wideScreen && detailOpen && Boolean(detailStation);
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
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const listScrollTop = useRef(0);
  const restoreListFocus = useRef(false);
  const focusResultsOnOpen = useRef(false);
  const showChargers = zoom >= chargerPinZoom;
  const { data, error, retry, clock } = useStationStatusResource<MapStation[]>(
    '/stations?' + bounds + (showChargers ? '&includeChargers=true' : ''),
  );
  const filter = search.trim().toLocaleLowerCase();
  const results = useMemo(() => {
    const matches = (data ?? [])
      .filter(station => (!availableOnly || station.counts.available > 0)
        && (station.name + ' ' + station.address).toLocaleLowerCase().includes(filter))
      .map(station => ({ station, distance: position ? distanceFrom(position, station) : undefined }));
    if (position) matches.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    return matches;
  }, [data, filter, position, availableOnly]);
  const pins = useMemo(() => results.flatMap(({ station }) => showChargers ? stationChargerPins(station) : [station]),
    [results, showChargers]);
  const selected = results.find(({ station }) => station.id === selectedId)?.station;
  const listedResults = selectedGroup ? results.filter(({ station }) => selectedGroup.stationIds.has(station.id)) : results;
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
      (detailHeading.current ?? resultsHeading.current)?.focus({ preventScroll: true });
    }
  }, [stationsOpen]);
  useLayoutEffect(() => {
    const scrollRegion = stationResults.current;
    if (!scrollRegion) return;
    if (detailStation && stationsOpen) {
      scrollRegion.scrollTop = 0;
      detailHeading.current?.focus({ preventScroll: true });
    } else if (restoreListFocus.current) {
      restoreListFocus.current = false;
      const card = selectedId && list.current?.querySelector<HTMLButtonElement>('[data-station="' + CSS.escape(selectedId) + '"] button');
      scrollRegion.scrollTop = card ? listScrollTop.current : 0;
      if (card && listHeading.current) revealStationCard(scrollRegion, listHeading.current, card);
      (card || resultsHeading.current)?.focus({ preventScroll: true });
    }
  }, [detailStation, selectedId, stationsOpen, fullScreenDetail]);
  useLayoutEffect(() => {
    if (!selectedGroup) return;
    stationResults.current?.scrollTo({ top: 0 });
    if (selectedGroup.keyboard) resultsHeading.current?.focus({ preventScroll: true });
  }, [selectedGroup]);
  useLayoutEffect(() => {
    if (selection?.keyboard === undefined) return;
    const scrollRegion = stationResults.current;
    const heading = listHeading.current;
    const button = list.current?.querySelector<HTMLButtonElement>('[data-station="' + CSS.escape(selection.id) + '"] button');
    if (!scrollRegion || !heading || !button) return;

    revealStationCard(scrollRegion, heading, button);
    if (selection.keyboard) button.focus({ preventScroll: true });
  }, [selection]);
  useEffect(() => () => { requestNumber.current++; clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!searchControlsOpen) return;
    searchPanel.current?.focus({ preventScroll: true });

    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.isComposing || searchPanel.current?.closest('[inert]')) return;
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
    if (!open && fullScreenDetail) {
      backToList();
      return;
    }
    if (detailStation) {
      if (!open) focusGripOnCollapse();
      setDetailOpen(open);
    } else setListDetent(open ? 'mid' : 'collapsed');
  }

  function focusGripOnCollapse() {
    if (stationResults.current?.contains(document.activeElement)) grip.current?.focus({ preventScroll: true });
  }

  function setListDetent(next: ListDetent) {
    if (next === 'collapsed') focusGripOnCollapse();
    setListRevealedOnReturn(false);
    lastListDetent = next;
    setListDetentPreference(next);
  }

  function stepListDetent(direction: -1 | 1) {
    const index = listDetents.indexOf(listDetent) + direction;
    if (index >= 0 && index < listDetents.length) setListDetent(listDetents[index]);
  }

  function startGripDrag(event: PointerEvent<HTMLButtonElement>) {
    const sheet = drawer.current;
    const viewport = sheet?.parentElement;
    if (event.button !== 0 || !event.isPrimary || !sheet || !viewport) return;
    const sheetBounds = sheet.getBoundingClientRect();
    const gripHeight = event.currentTarget.offsetHeight;
    const topGap = mobileList ? parseFloat(getComputedStyle(sheet).getPropertyValue('--bp-sheet-top-gap')) : 0;
    const expandedHeight = mobileList ? viewport.clientHeight - topGap : sheetBounds.height;
    const travel = expandedHeight - gripHeight;
    if (travel <= 0) return;

    const startOffset = mobileList ? expandedHeight - sheetBounds.height : sheetBounds.bottom - viewport.getBoundingClientRect().bottom;
    event.currentTarget.setPointerCapture(event.pointerId);
    const listDrag: ListGripDrag | undefined = mobileList ? {
      heights: [gripHeight, gripHeight + travel / 2, expandedHeight],
      offset: startOffset,
      distance: 0,
      time: event.timeStamp,
      y: event.clientY,
      velocity: 0,
    } : undefined;
    gripDrag.current = {
      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      startOffset, travel, moved: false, list: listDrag,
    };
    suppressGripClick.current = false;
    updateDrawerDrag(gripDrag.current, startOffset);
  }

  function updateDrawerDrag(drag: StationGripDrag, offset: number) {
    if (!explorer.current) return;
    explorer.current.dataset.stationsDragging = 'true';
    if (drag.list) explorer.current.style.setProperty('--bp-sheet-drag-height', (drag.list.heights[2] - offset) + 'px');
    else explorer.current.style.setProperty('--bp-sheet-offset', offset + 'px');
  }

  function sampleListDrag(listDrag: ListGripDrag, travel: number, event: PointerEvent<HTMLButtonElement>) {
    const movement = event.clientY - listDrag.y;
    if (!movement) return;
    listDrag.offset = Math.max(0, Math.min(travel, listDrag.offset + movement));
    listDrag.distance += Math.abs(movement);
    listDrag.velocity = movement / Math.max(1, event.timeStamp - listDrag.time);
    listDrag.y = event.clientY;
    listDrag.time = event.timeStamp;
  }

  function moveGripDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = gripDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientY - drag.startY;
    drag.moved ||= Math.hypot(event.clientX - drag.startX, delta) >= gripDragSlop;
    if (!drag.moved) return;
    if (drag.list) sampleListDrag(drag.list, drag.travel, event);
    const offset = drag.list?.offset ?? Math.max(0, Math.min(drag.travel, drag.startOffset + delta));
    updateDrawerDrag(drag, offset);
  }

  function finishGripDrag(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const drag = gripDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientY - drag.startY;
    suppressGripClick.current = cancelled || drag.moved || Math.hypot(event.clientX - drag.startX, delta) >= gripDragSlop;
    gripDrag.current = null;
    if (explorer.current) {
      delete explorer.current.dataset.stationsDragging;
      explorer.current.style.removeProperty('--bp-sheet-offset');
      explorer.current.style.removeProperty('--bp-sheet-drag-height');
    }
    if (cancelled || !suppressGripClick.current) return;
    if (drag.list) {
      if (!mobileList) return;
      sampleListDrag(drag.list, drag.travel, event);
      if (event.timeStamp - drag.list.time > 85) drag.list.velocity = 0;
      setListDetent(listReleaseDetent(drag.list));
    } else if (Math.abs(delta) >= Math.min(64, drag.travel / 3)) {
      setStationsOpen(delta < 0);
    }
  }

  function skipToResults() {
    if (stationsOpen) {
      (detailHeading.current ?? resultsHeading.current)?.focus();
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
        setDetailStation(undefined);
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
    setSelectedGroup(undefined);
    setDetailStation(undefined);
    setSelection({ id, keyboard });
    if (!listOpen) setListDetent('mid');
  }

  function selectPinGroup(stationIds: string[], keyboard: boolean) {
    lastSelected = undefined;
    setSelection(undefined);
    setDetailStation(undefined);
    setSelectedGroup({ stationIds: new Set(stationIds), keyboard });
    if (!listOpen) setListDetent('mid');
  }

  function openDetails(station: Station) {
    listScrollTop.current = stationResults.current?.scrollTop ?? 0;
    lastSelected = station.id;
    setSelection({ id: station.id });
    setDetailOpen(true);
    setDetailStation(station);
  }

  function backToList() {
    restoreListFocus.current = true;
    if (!listOpen) setListRevealedOnReturn(true);
    setDetailStation(undefined);
  }

  return <main className="bp-shell bp-explore">
    <header className="bp-header" inert={fullScreenDetail}><Brand /><Nav /></header>
    <div className="bp-explorer" data-stations-open={stationsOpen} data-station-list-detent={mobileList ? listDetent : undefined}
      data-station-detail-fullscreen={fullScreenDetail} ref={explorer}>
      <h1 className="bp-screen-reader">Charging map</h1>
      <div className="bp-search-controls" inert={fullScreenDetail}>
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
              <button type="button" className="bp-filter" aria-pressed={availableOnly} title="Stations with an available charger"
                onClick={() => setAvailableOnly(value => !value)}><span aria-hidden="true" className="bp-filter-mark" />Available chargers</button>
            </div>
          </>}
          <p className={searchControlsOpen ? 'bp-location-message' : 'bp-screen-reader'} role="status">
            {locating ? 'Locating…' : locationMessage}
          </p>
        </section>
      </div>
      <button type="button" className="bp-skip" inert={fullScreenDetail} onClick={skipToResults}>Skip map to {detailStation ? 'station details' : 'station results'}</button>
      <MapPanel camera={lastCamera} position={position} pins={pins} selected={selectedId} onSelect={selectPin} onSelectGroup={selectPinGroup}
        inert={fullScreenDetail} clock={clock} clusterStations
        onMove={(camera, query) => {
          if (query !== lastBounds) setSelectedGroup(undefined);
          lastCamera = camera;
          lastBounds = query;
          setBounds(query);
          setZoom(camera.zoom);
        }} />
      <p className="bp-screen-reader" role="status">{!fullScreenDetail && data && results.length + (results.length === 1 ? ' station' : ' stations') + ' in view'}</p>
      <p className="bp-screen-reader" role="status">{!detailStation && selected && 'Selected ' + selected.name}</p>
      <div className="bp-station-sheet-viewport">
        <div className="bp-station-drawer" ref={drawer} onKeyDown={event => {
          if (!fullScreenDetail || event.key !== 'Escape' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          backToList();
        }}>
          <button type="button" className="bp-station-grip" ref={grip}
            aria-label={fullScreenDetail ? 'Return to station list' :
              mobileList && listDetent === 'mid' ? 'Expand station results fully' :
              (stationsOpen ? 'Collapse ' : 'Expand ') + (detailStation ? 'station details' : 'station results')}
            aria-expanded={stationsOpen} aria-controls="bp-station-results" onPointerDown={startGripDrag}
            onPointerMove={moveGripDrag} onPointerUp={finishGripDrag}
            onPointerCancel={event => finishGripDrag(event, true)}
            onLostPointerCapture={event => finishGripDrag(event, true)}
            onClick={event => {
              if (suppressGripClick.current && event.detail !== 0) return;
              if (!mobileList) setStationsOpen(!stationsOpen);
              else if (listDetent === 'expanded') setListDetent('collapsed');
              else stepListDetent(1);
            }}
            onKeyDown={event => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                if (mobileList) stepListDetent(event.key === 'ArrowUp' ? 1 : -1);
                else setStationsOpen(event.key === 'ArrowUp');
              } else if (mobileList && (event.key === 'Home' || event.key === 'End')) {
                event.preventDefault();
                setListDetent(event.key === 'Home' ? 'collapsed' : 'expanded');
              }
            }}>
            <span aria-hidden="true" />
          </button>
          <section id="bp-station-results" className={'bp-stations' + (detailStation ? ' bp-stations-detail' : '')} ref={stationResults}
            aria-label={detailStation ? 'Station details' : 'Stations in this map area'} inert={!stationsOpen}>
            {detailStation ? <StationSheetDetail summary={detailStation} headingRef={detailHeading} onBack={backToList} /> : <>
              <div className="bp-list-heading" ref={listHeading}>
                <h2 ref={resultsHeading} tabIndex={-1}>{selectedGroup ? 'Stations at selected pins' : 'Stations in view'}{' '}
                  {data && <span className="bp-total">{listedResults.length}</span>}</h2>
                {selectedGroup && <button type="button" className="bp-text" onClick={() => {
                  setSelectedGroup(undefined);
                  resultsHeading.current?.focus({ preventScroll: true });
                }}>Show all stations</button>}
              </div>
              {position && <p className="bp-sort" role="status">Nearest to your location first</p>}
              {(!data || error) && <Feedback error={error} retry={retry} loading="Loading stations…" />}
              {data && !listedResults.length && <div className="bp-empty" role="status">
                <Icon name="map" /><h3>{hasFilters ? 'No matching stations' : 'No stations in this area'}</h3>
                <p>{availableOnly ? 'No matching station in this area has an available charger.' :
                  filter ? 'Try a different station name or address.' : 'Zoom out or move the map to explore another area.'}</p>
                {hasFilters && <button className="bp-text" onClick={() => { setSearch(''); setAvailableOnly(false); }}>Clear filters</button>}
              </div>}
              <ul className="bp-station-list" ref={list}>{listedResults.map(({ station, distance }) => {
                const availability = stationAvailability(station.counts);
                const chargerCount = Object.values(station.counts).reduce((total, count) => total + count, 0);
                return <li key={station.id} data-station={station.id} className={station.id === selectedId ? 'current' : ''}>
                  <button type="button" className="bp-station-card"
                    onClick={() => openDetails(station)} aria-current={selectedId === station.id ? 'true' : undefined}>
                    <span className="bp-card-top"><span className={'bp-availability ' + availability.status}>{availability.label}</span>
                      <span className="bp-distance">{distance !== undefined ? formatDistance(distance) + ' · ' : ''}{chargerCount} {chargerCount === 1 ? 'charger' : 'chargers'}</span></span>
                    <span className="bp-station-name">{station.name}</span><span className="bp-address">{station.address}</span>
                    <span className="bp-card-bottom"><span>{station.latestReportAt ? <>Latest station report <Age at={station.latestReportAt} /></> : 'No station reports yet'}
                      {station.nextStatusChangeAt && clock &&
                        <RemainingTime until={station.nextStatusChangeAt} clock={clock} prefix="Next estimate: " />}</span>
                      <span className="bp-card-arrow" aria-hidden="true">→</span></span>
                  </button>
                </li>;
              })}</ul>
              {data?.length === 200 && <p className="bp-muted">Showing up to 200 stations. Zoom in to narrow the area.</p>}
            </>}
          </section>
        </div>
      </div>
    </div>
  </main>;
}
