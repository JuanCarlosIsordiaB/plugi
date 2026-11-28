import { AppLink, Feedback } from '../charging/ui.web';
import { ContactPage } from './common.web';
import { conversationsPath, PageButtons, Timestamp, useConversationPage } from './conversations.web';

interface Conversation { id: string; updatedAt: string }

function ConversationList() {
  const page = useConversationPage<{ conversations: Conversation[] }>(conversationsPath);
  const items = page.data?.conversations;
  return <section className="bp-page-surface bc-card">
    <div className="bc-heading">
      <h2>Inbox</h2>
      <div className="bc-actions">
        <button className="bp-secondary" disabled={!page.data && !page.error} onClick={page.refresh}>Refresh</button>
        <AppLink className="bp-primary" href="/contact">Contact a driver</AppLink>
      </div>
    </div>
    {!items ? <Feedback {...page} loading="Loading conversations…" /> : items.length === 0 ?
      <p className="bc-state" role="status">{page.isOlder ? 'No older conversations.' : 'No conversations yet. Incoming messages and replies to your requests will appear here.'}</p> :
      <ul className="bc-inbox-list">{items.map(item => <li key={item.id}>
        <AppLink className="bc-summary" href={{ pathname: '/messages/[id]', params: { id: item.id } }}>
          <span><strong>Charging conversation</strong><span className="bp-muted">Updated <Timestamp value={item.updatedAt} /></span></span>
        </AppLink>
      </li>)}</ul>}
    <PageButtons older={items?.length === 50 ? () => page.older(items[items.length - 1].id) : undefined}
      newer={page.isOlder ? page.newer : undefined} />
  </section>;
}

export default function Inbox() {
  return <ContactPage title="Messages" path="/messages" introduction="Sign in to read and reply to charging messages."><ConversationList /></ContactPage>;
}
