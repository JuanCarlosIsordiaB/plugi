import { AppLink, Feedback, useResource } from '../charging/ui.web';
import { type Proposal, proposalsPath } from './api';
import ProposalPage from './ProposalPage.web';

const statusLabels = { pending: 'Pending review', approved: 'Approved', rejected: 'Rejected' } as const;
const statusStyles = { pending: 'occupied', approved: 'available', rejected: 'out_of_service' } as const;
const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

function ProposalDate({ date }: { date: string }) {
  return <time dateTime={date}>{dateFormat.format(new Date(date))}</time>;
}

function MyProposals() {
  const { data, error, retry } = useResource<Proposal[]>(proposalsPath, true);
  return <>
    <div className="bp-proposals-actions">
      <AppLink href="/proposals/new" className="bp-primary">Propose a station</AppLink>
    </div>
    {!data && <div className="bp-page-surface bp-proposal-state"><Feedback error={error} retry={retry} loading="Loading your proposals…" /></div>}
    {data?.length === 0 && <div className="bp-page-surface bp-proposal-state" role="status">
      <h2>No proposals yet</h2><p>Propose a charging station you know about to help others find it.</p>
    </div>}
    {!!data?.length && <ul className="bp-proposal-list">
      {data.map(({ id, status, station, stationId, createdAt, reviewedAt }) => <li key={id}>
        <article className="bp-page-surface bp-proposal-card">
          <div className="bp-proposal-card-heading">
            <h2>{station.name}</h2>
            <span className={'bp-badge ' + statusStyles[status]}>{statusLabels[status]}</span>
          </div>
          <p className="bp-muted">{station.address}</p>
          <p>{station.chargers.length} {station.chargers.length === 1 ? 'charger' : 'chargers'}</p>
          <ul className="bp-proposal-dates">
            <li>Submitted <ProposalDate date={createdAt} /></li>
            {reviewedAt && <li>Reviewed <ProposalDate date={reviewedAt} /></li>}
          </ul>
          {status === 'approved' && stationId && <AppLink href={{ pathname: '/stations/[id]', params: { id: stationId } }}
            className="bp-secondary" aria-label={'View published station ' + station.name}>View station</AppLink>}
        </article>
      </li>)}
    </ul>}
  </>;
}

export default function ProposalList() {
  return <ProposalPage title="My proposals"><MyProposals /></ProposalPage>;
}
