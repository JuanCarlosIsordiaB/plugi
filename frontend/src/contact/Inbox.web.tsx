import { AppLink, Feedback } from '../charging/ui.web';
import { ContactPage } from './common.web';
import { conversationsPath, PageButtons, Timestamp, useConversationPage } from './conversations.web';

interface Conversation { id: string; updatedAt: string }

function ConversationList() {
  const page = useConversationPage<{ conversations: Conversation[] }>(conversationsPath);
  const items = page.data?.conversations;
  return <>
    <div className="bc-actions"><AppLink className="bp-primary" href="/contact">Contact a driver</AppLink></div>
    <section className="bc-card">
      <div className="bc-heading"><h2>Inbox</h2><button className="bp-secondary" disabled={!page.data && !page.error} onClick={page.refresh}>Refresh</button></div>
      {!items ? <Feedback {...page} loading="Loading conversations…" /> : items.length === 0 ?
        <p className="bp-muted">{page.isOlder ? 'No older conversations.' : 'No conversations yet. Incoming messages and replies to your requests will appear here.'}</p> :
        <ul>{items.map(item => <li className="bc-row" key={item.id}>
          <AppLink className="bc-summary" href={{ pathname: '/messages/[id]', params: { id: item.id } }}>
            <strong>Charging conversation</strong><span>Updated <Timestamp value={item.updatedAt} /></span>
          </AppLink>
        </li>)}</ul>}
      <PageButtons older={items?.length === 50 ? () => page.older(items[items.length - 1].id) : undefined}
        newer={page.isOlder ? page.newer : undefined} />
    </section>
  </>;
}

export default function Inbox() {
  return <ContactPage title="Messages" path="/messages" introduction="Sign in to read and reply to charging messages."><ConversationList /></ContactPage>;
}
