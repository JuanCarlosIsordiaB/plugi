import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ConnectorType } from './StationFacts.web';

export type StationFilters = {
  availableOnly: boolean;
  connector: string;
  publicOnly: boolean;
};

type FilterProps = {
  filters: StationFilters;
  activeCount: number;
  catalog: {
    data?: ConnectorType[];
    error?: string;
    pending: boolean;
    retry: () => void;
  };
  onChange: (change: Partial<StationFilters>) => void;
  onReset: () => void;
};

export function ExploreFilters({ filters, activeCount, catalog, onChange, onReset }: FilterProps) {
  const [open, setOpen] = useState(false);
  const disclosure = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const availability = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    panel.current.scrollTop = 0;
    availability.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !disclosure.current?.contains(event.target)) {
        const restoreIfFocusIsLost = disclosure.current?.contains(document.activeElement);
        setOpen(false);
        if (restoreIfFocusIsLost) requestAnimationFrame(() => {
          if (document.activeElement === document.body) trigger.current?.focus({ preventScroll: true });
        });
      }
    }
    document.addEventListener('pointerdown', dismissOutside, true);
    return () => document.removeEventListener('pointerdown', dismissOutside, true);
  }, [open]);

  function close() {
    trigger.current?.focus({ preventScroll: true });
    setOpen(false);
  }

  return <div className="bp-station-filters" ref={disclosure}
    onBlur={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}
    onKeyDown={event => {
      if (!open || event.key !== 'Escape' || event.nativeEvent.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    }}>
    <button type="button" className="bp-filter-trigger" ref={trigger} aria-expanded={open}
      aria-controls="bp-station-filters-panel" data-active={activeCount > 0}
      onClick={() => { if (open) close(); else setOpen(true); }}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.65"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 7h7m4 0h5M4 17h3m4 0h9" />
        <circle cx="13" cy="7" r="2" />
        <circle cx="9" cy="17" r="2" />
      </svg>
      Filters
      {activeCount > 0 && <>
        <span className="bp-filter-count" aria-hidden="true">{activeCount}</span>
        <span className="bp-screen-reader">{activeCount} active</span>
      </>}
    </button>
    <section className="bp-filter-panel" id="bp-station-filters-panel" ref={panel} aria-labelledby="bp-filter-heading" hidden={!open}>
      <h2 id="bp-filter-heading">Station filters</h2>
      <label className="bp-filter-option">
        <input ref={availability} type="checkbox" checked={filters.availableOnly}
          onChange={event => onChange({ availableOnly: event.target.checked })} />
        Available now
      </label>
      <label className="bp-filter-option">
        <input type="checkbox" checked={filters.publicOnly} aria-describedby="bp-public-filter-description"
          onChange={event => onChange({ publicOnly: event.target.checked })} />
        Public access
      </label>
      <p id="bp-public-filter-description" className="bp-screen-reader">Uses the access classification in the station catalog.</p>
      <label className="bp-connector-filter">
        Connector type
        <select value={filters.connector} disabled={!catalog.data?.length}
          onChange={event => onChange({ connector: event.target.value })}>
          <option value="">Any connector</option>
          {filters.connector && !catalog.data?.some(type => type.id === filters.connector) &&
            <option value={filters.connector}>Selected connector</option>}
          {catalog.data?.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
        </select>
      </label>
      <div className="bp-filter-catalog" role="status">
        {catalog.pending ? 'Loading connector types…' : catalog.error ? 'Connector filters unavailable.' :
          !catalog.data?.length ? 'No connector types available.' : null}
      </div>
      {catalog.error && <button type="button" className="bp-text bp-filter-retry" onClick={() => {
        availability.current?.focus();
        catalog.retry();
      }}>Retry connectors</button>}
      <div className="bp-filter-actions">
        <button type="button" className="bp-text" aria-disabled={!activeCount}
          onClick={() => { if (activeCount) onReset(); }}>Reset filters</button>
        <button type="button" className="bp-secondary" onClick={close}>Done</button>
      </div>
    </section>
  </div>;
}
