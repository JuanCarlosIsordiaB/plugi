import type { Href } from 'expo-router';
import type { ReactNode } from 'react';
import { useSignedIn } from '../charging/api';
import { AppLink, Brand, Icon, Nav } from '../charging/ui.web';

// Expo's typed route generator includes the index segment for this nested route.
export const proposalsHref = '/proposals' as Href;

export default function ProposalPage({ title, newProposal, children }: {
  title: string;
  newProposal?: boolean;
  children: ReactNode;
}) {
  const signedIn = useSignedIn();
  return <main className="bp-shell bp-page-shell">
    <header className="bp-header"><Brand /><Nav account /></header>
    <section className={'bp-page-content bp-proposals-content' + (newProposal ? ' bp-proposals-editor' : '')} aria-labelledby="proposal-title">
      <header className="bp-proposals-heading">
        {newProposal && <AppLink href={proposalsHref} className="bp-text bp-page-back"><Icon name="back" />My proposals</AppLink>}
        <h1 id="proposal-title" className="bp-page-title">{title}</h1>
      </header>
      {signedIn ? children : <div className="bp-page-surface bp-proposal-state">
        <p>{newProposal ? 'Sign in to propose a charging station.' : 'Sign in to view your station proposals.'}</p>
        <AppLink href={{ pathname: '/login', params: { returnTo: newProposal ? '/proposals/new' : '/proposals' } }}
          className="bp-primary">Sign in</AppLink>
      </div>}
    </section>
  </main>;
}
