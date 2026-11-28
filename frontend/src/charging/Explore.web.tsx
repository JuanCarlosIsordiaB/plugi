import type { LatLngTuple } from 'leaflet';
import type { PointerEvent } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Charger, Station } from './api';
import { ExploreFilters, type StationFilters } from './ExploreFilters.web';
import MapPanel, { chargerPinZoom, initialCamera, type Pin } from './MapPanel.web';
import { StationGlyph, type ConnectorType } from './StationFacts.web';
import { StationSummary, StationThumbnail } from './StationSummary.web';
import { useStationStatusResource } from './stationStatus.web';
import { StationSheetDetail } from './Station.web';
import { Brand, Feedback, Icon, Nav, useResource } from './ui.web';

let lastCamera = initialCamera;
let lastSelected: string | undefined;
let lastSearch = '';
const defaultFilters: StationFilters = { availableOnly: false, publicOnly: false, connector: '' };
let lastFilters = defaultFilters;
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

function stationChargerPins(station: MapStation, connector: string): Pin[] {
  if (!station.chargers?.length) return [station];
  const pins: Pin[] = [];
  const counts: Station['counts'] = { available: 0, occupied: 0, out_of_service: 0, unreported: 0 };
  let nextStatusChangeAt: string | null = null;
  station.chargers.forEach((charger, index) => {
    if (connector && !charger.connectorTypes.includes(connector)) return;
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
  if (Object.values(counts).some(count => count > 0)) pins.push({ ...station, counts, nextStatusChangeAt });
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
  const [filters, setFilters] = useState(lastFilters);
  const { availableOnly, publicOnly, connector } = filters;
  const [listDetentPreference, setListDetentPreference] = useState(lastListDetent);
  const [listRevealedOnReturn, setListRevealedOnReturn] = useState(false);
  const wideScreen = useSyncExternalStore(subscribeToWideScreen, isWideScreen, defaultWideScreen);
  const preferredListDetent = listDetentPreference ?? (wideScreen ? 'mid' : 'collapsed');
  const listDetent = listRevealedOnReturn && preferredListDetent === 'collapsed' ? 'mid' : preferredListDetent;
  const listOpen = listDetent !== 'collapsed';
  const [selectedId, setSelectedId] = useState(lastSelected);
  const [preview, setPreview] = useState<{ keyboard: boolean; source?: HTMLElement }>();
  const [selectedGroup, setSelectedGroup] = useState<{ stationIds: Set<string>; keyboard: boolean; sourceId?: string }>();
  const [detailStation, setDetailStation] = useState<Station>();
  const [detailOpen, setDetailOpen] = useState(true);
  const stationsOpen = detailStation ? detailOpen : listOpen;
  const mobileList = !wideScreen && !detailStation;
  const expandedMobileList = mobileList && listDetent === 'expanded';
  const fullScreenDetail = !wideScreen && detailOpen && Boolean(detailStation);
  const [position, setPosition] = useState<LatLngTuple>();
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
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
  const previewPanel = useRef<HTMLElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const previewHasFocus = useRef(false);
  const listScrollTop = useRef(0);
  const restoreListFocus = useRef(false);
  const focusResultsOnOpen = useRef(false);
  const showChargers = zoom >= chargerPinZoom;
  const { data, error, retry, clock } = useStationStatusResource<MapStation[]>('/stations?' + bounds + '&includeChargers=true');
  const catalog = useResource<ConnectorType[]>('/connector-types');
  const filter = search.trim().toLocaleLowerCase();
  const results = useMemo(() => {
    const matches = (data ?? []).flatMap(station => {
      if ((publicOnly && station.access_type !== 'public') ||
          !(station.name + ' ' + station.address).toLocaleLowerCase().includes(filter)) return [];
      const chargers = connector ? station.chargers?.filter(charger => charger.connectorTypes.includes(connector)) : undefined;
      if (connector ? !chargers?.length || (availableOnly && !chargers.some(charger => charger.status === 'available'))
        : availableOnly && !station.counts.available) return [];

      const counts = connector && chargers
        ? chargers.reduce<Station['counts']>((total, charger) => {
          total[charger.status]++;
          return total;
        }, { available: 0, occupied: 0, out_of_service: 0, unreported: 0 })
        : station.counts;
      const nextStatusChangeAt = connector
        ? chargers?.reduce<string | null>((first, charger) =>
          charger.occupiedUntil && (!first || charger.occupiedUntil < first) ? charger.occupiedUntil : first, null) ?? null
        : station.nextStatusChangeAt;
      return [{ station, mapStation: { ...station, counts, nextStatusChangeAt },
        connectorTypes: connector ? [connector] : [...new Set(station.chargers?.flatMap(charger => charger.connectorTypes))],
        distance: position ? distanceFrom(position, station) : undefined }];
    });
    if (position) matches.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    return matches;
  }, [data, filter, position, availableOnly, publicOnly, connector]);
  const pins = useMemo(() => results.flatMap(({ mapStation }) => showChargers ? stationChargerPins(mapStation, connector) : [mapStation]),
    [results, showChargers, connector]);
  const selected = results.find(({ station }) => station.id === selectedId);
  const previewStation = preview && !detailStation && (wideScreen || !listOpen) ? selected : undefined;
  const previewId = previewStation?.station.id;
  if (preview && data && !selected) {
    setPreview(undefined);
    setSelectedId(undefined);
  }
  const listedResults = selectedGroup ? results.filter(({ station }) => selectedGroup.stationIds.has(station.id)) : results;
  const stationCount = data ? listedResults.length + (listedResults.length === 1 ? ' station' : ' stations') : undefined;
  const gripCaption = stationCount ?? (error ? 'Stations unavailable' : 'Loading stations…');
  const gripAction = !stationsOpen ? 'View list' : mobileList && listDetent === 'mid' ? 'Expand list fully' : 'Collapse list';
  const activeFilterCount = [availableOnly, publicOnly, Boolean(connector)].filter(Boolean).length;
  const hasFilters = Boolean(filter || activeFilterCount);
  useEffect(() => {
    lastSearch = search;
    lastFilters = filters;
  }, [search, filters]);
  useEffect(() => { lastSelected = selectedId; }, [selectedId]);
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
    if (preview?.keyboard) previewButton.current?.focus({ preventScroll: true });
    if (!preview && !selectedId && previewHasFocus.current && document.activeElement === document.body) {
      explorer.current?.querySelector<HTMLElement>('.bp-map-surface')?.focus({ preventScroll: true });
      previewHasFocus.current = false;
    }
  }, [preview, selectedId]);
  useLayoutEffect(() => {
    if (!previewId || !wideScreen) return;
    const scrollRegion = stationResults.current;
    const heading = listHeading.current;
    const button = list.current?.querySelector<HTMLButtonElement>('[data-station="' + CSS.escape(previewId) + '"] button');
    if (!scrollRegion || !heading || !button) return;

    revealStationCard(scrollRegion, heading, button);
  }, [previewId, wideScreen]);
  useEffect(() => () => { requestNumber.current++; clearTimeout(timer.current); }, []);

  function dismissPreview(restoreFocus = false) {
    if (!preview) return;
    if (restoreFocus || previewPanel.current?.contains(document.activeElement)) {
      const map = explorer.current?.querySelector<HTMLElement>('.bp-map-surface');
      const source = restoreFocus ? preview.source : undefined;
      const key = source?.dataset.pin ?? source?.dataset.cluster;
      const attribute = source?.dataset.pin ? 'data-pin' : 'data-cluster';
      const marker = source?.isConnected ? source : key && map?.querySelector<HTMLElement>('[' + attribute + '="' + CSS.escape(key) + '"]');
      (marker || map)?.focus({ preventScroll: true });
    }
    previewHasFocus.current = false;
    setPreview(undefined);
    setSelectedId(undefined);
  }

  function clearFilters() {
    setSearch('');
    resetStationFilters();
    resultsHeading.current?.focus({ preventScroll: true });
  }

  function resetStationFilters() {
    dismissPreview();
    setFilters(defaultFilters);
    setSelectedGroup(undefined);
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
    if (next !== 'collapsed') dismissPreview();
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
    const sheetStyle = getComputedStyle(sheet);
    const topGap = mobileList ? parseFloat(getComputedStyle(viewport).paddingTop) : 0;
    const navigationSpace = mobileList ? parseFloat(sheetStyle.paddingBottom) : 0;
    const expandedHeight = mobileList ? viewport.clientHeight - topGap - navigationSpace : sheetBounds.height;
    const travel = expandedHeight - gripHeight;
    if (travel <= 0) return;

    const startOffset = mobileList
      ? expandedHeight - (sheetBounds.height - navigationSpace)
      : sheetBounds.bottom - viewport.getBoundingClientRect().bottom;
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
    if (drag.list) {
      const height = drag.list.heights[2] - offset;
      explorer.current.style.setProperty('--bp-sheet-drag-height', height + 'px');
      explorer.current.toggleAttribute('data-stations-lifting', height > drag.list.heights[0] + 1);
    } else explorer.current.style.setProperty('--bp-sheet-offset', offset + 'px');
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
      delete explorer.current.dataset.stationsLifting;
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
    if (expandedMobileList) setListDetent('mid');
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
        setPreview(undefined);
        setSelectedId(undefined);
        setSelectedGroup(undefined);
        setDetailStation(undefined);
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

  function selectPin(id: string, keyboard: boolean, source?: HTMLElement) {
    setSelectedGroup(undefined);
    setDetailStation(undefined);
    setSelectedId(id);
    previewHasFocus.current = false;
    setPreview({ keyboard, source });
    if (!wideScreen && listOpen) setListDetent('collapsed');
  }

  function selectPinGroup(stationIds: string[], keyboard: boolean, sourceId?: string) {
    setSelectedId(undefined);
    setPreview(undefined);
    setDetailStation(undefined);
    setSelectedGroup({ stationIds: new Set(stationIds), keyboard, sourceId });
    if (!listOpen) setListDetent('mid');
  }

  function openDetails(station: Station) {
    listScrollTop.current = stationResults.current?.scrollTop ?? 0;
    setSelectedId(station.id);
    setPreview(undefined);
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
      data-station-detail-fullscreen={fullScreenDetail} ref={explorer} onKeyDown={event => {
        if (!previewStation || event.key !== 'Escape' || event.nativeEvent.isComposing ||
            !(event.target instanceof HTMLElement) || !event.target.closest('.bp-map, .bp-station-preview')) return;
        event.preventDefault();
        dismissPreview(true);
      }}>
      <section className="bp-discover-controls" aria-labelledby="bp-discover-heading" inert={fullScreenDetail}>
        <h1 id="bp-discover-heading">Find EV charging</h1>
        <div className="bp-explore-toolbar">
          <div className="bp-toolbar-brand"><Brand markOnly /></div>
          <label className="bp-search"><Icon name="search" />
            <input type="search" placeholder="Search map" aria-label="Search stations by name or address in this map area"
              value={search} onChange={event => { dismissPreview(); setSearch(event.target.value); setSelectedGroup(undefined); }} />
          </label>
          <ExploreFilters filters={filters} activeCount={activeFilterCount} catalog={catalog} onReset={resetStationFilters}
            onChange={change => {
              dismissPreview();
              setFilters(current => ({ ...current, ...change }));
              setSelectedGroup(undefined);
            }} />
        </div>
      </section>
      <div className="bp-map-actions" inert={fullScreenDetail}>
        <button type="button" className="bp-locate" onClick={locate} aria-disabled={locating}
          title="Use my location" aria-label="Use my location">
          <span className="bp-crosshair" aria-hidden="true" /><span className="bp-locate-label">Use my location</span>
        </button>
        <p className={'bp-location-message' + (expandedMobileList ? ' bp-screen-reader' : '')} role="status">
          {locating ? 'Locating…' : locationMessage}
        </p>
      </div>
      <button type="button" className="bp-skip" inert={fullScreenDetail} onClick={skipToResults}>Skip map to {detailStation ? 'station details' : 'station results'}</button>
      <MapPanel camera={lastCamera} position={position} pins={pins} selected={selectedId} selectedGroup={selectedGroup?.sourceId}
        onSelect={selectPin} onSelectGroup={selectPinGroup}
        inert={fullScreenDetail || expandedMobileList} clock={clock} clusterStations
        onMove={(camera, query) => {
          if (query !== lastBounds) {
            setSelectedGroup(undefined);
            dismissPreview();
          }
          lastCamera = camera;
          lastBounds = query;
          setBounds(query);
          setZoom(camera.zoom);
        }} />
      <div className="bp-map-guide" aria-hidden="true">
        <StationGlyph />
        <span>{showChargers ? 'Individual chargers' : 'Zoom in to see individual chargers'}</span>
      </div>
      {previewStation && <section className="bp-station-preview" aria-label="Station preview" ref={previewPanel}
        onFocus={() => { previewHasFocus.current = true; }}
        onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) previewHasFocus.current = false;
        }}>
        <button className="bp-preview-open" type="button" ref={previewButton} onClick={() => openDetails(previewStation.station)}>
          <StationThumbnail connector={previewStation.connectorTypes[0]} />
          <StationSummary station={previewStation.mapStation} connectorTypes={previewStation.connectorTypes}
            catalog={catalog.data} filtered={Boolean(connector)} clock={clock}
            distanceLabel={previewStation.distance === undefined ? undefined : formatDistance(previewStation.distance)} />
          <span className="bp-station-chevron" aria-hidden="true" />
          <span className="bp-screen-reader">Open station details</span>
        </button>
        <button className="bp-preview-dismiss" type="button" onClick={() => dismissPreview(true)} aria-label="Dismiss station preview">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </section>}
      <p className="bp-screen-reader" role="status">
        {!fullScreenDetail && stationCount && stationCount + (selectedGroup ? ' at selected pins' : ' in the map area')}
      </p>
      <p className="bp-screen-reader" role="status">{!detailStation && selected && 'Selected ' + selected.station.name}</p>
      <div className="bp-station-sheet-viewport">
        <div className="bp-station-drawer" ref={drawer} onKeyDown={event => {
          if (!fullScreenDetail || event.key !== 'Escape' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          backToList();
        }}>
          <button type="button" className="bp-station-grip" ref={grip}
            aria-label={fullScreenDetail ? 'Return to station list' : detailStation
              ? (stationsOpen ? 'Collapse' : 'Expand') + ' station details'
              : gripAction + ', ' + gripCaption}
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
            <span className="bp-grip-handle" aria-hidden="true" />
          </button>
          <section id="bp-station-results" className={'bp-stations' + (detailStation ? ' bp-stations-detail' : '')} ref={stationResults}
            aria-label={detailStation ? 'Station details' : 'Stations in this map area'} inert={!stationsOpen}>
            {detailStation ? <StationSheetDetail summary={detailStation} headingRef={detailHeading}
              thumbnailConnector={selected?.connectorTypes[0]} onBack={backToList} /> : <>
              <div className="bp-list-heading" ref={listHeading}>
                <div>
                  <h2 ref={resultsHeading} tabIndex={-1}>{stationCount ?? 'Charging stations'}</h2>
                  {selectedGroup && <p className="bp-list-context">At selected pins</p>}
                </div>
                {selectedGroup && <button type="button" className="bp-text" onClick={() => {
                  setSelectedGroup(undefined);
                  resultsHeading.current?.focus({ preventScroll: true });
                }}>Show all stations</button>}
                {!selectedGroup && hasFilters && <button type="button" className="bp-text" onClick={clearFilters}>Clear filters</button>}
              </div>
              {position && <p className="bp-sort" role="status">Nearest to your location first</p>}
              {(!data || error) && <Feedback error={error} retry={retry} loading="Loading stations…" />}
              {data && !listedResults.length && <div className="bp-empty" role="status">
                <Icon name="map" /><h3>{hasFilters ? 'No matching stations' : 'No stations in this area'}</h3>
                <p>{hasFilters ? 'Change the filters or move the map to another area.' : 'Zoom out or move the map to explore another area.'}</p>
              </div>}
              <ul className="bp-station-list" ref={list}>{listedResults.map(({ station, mapStation, distance, connectorTypes }) =>
                <li key={station.id} data-station={station.id} className={station.id === selectedId ? 'current' : ''}>
                  <button type="button" className="bp-station-row"
                    onClick={() => openDetails(station)} aria-current={selectedId === station.id ? 'true' : undefined}>
                    <StationThumbnail connector={connectorTypes[0]} />
                    <StationSummary station={mapStation} connectorTypes={connectorTypes} catalog={catalog.data}
                      filtered={Boolean(connector)} clock={clock} distanceLabel={distance === undefined ? undefined : formatDistance(distance)} />
                    <span className="bp-station-chevron" aria-hidden="true" />
                  </button>
                </li>
              )}</ul>
              {data?.length === 200 && <p className="bp-muted">Showing up to 200 stations. Zoom in to narrow the area.</p>}
            </>}
          </section>
        </div>
      </div>
    </div>
  </main>;
}
