import { useLocalSearchParams } from 'expo-router';
import { type FormEvent, useEffect, useState } from 'react';
import { authenticated, jsonRequest, useSessionVersion } from '../charging/api';
import { Feedback } from '../charging/ui.web';
import { ContactPage, MessageField, useAction } from './common.web';
import { conversationsPath, PageButtons, Timestamp, useConversationPage } from './conversations.web';

interface Message { id: string; body: string; mine: boolean; createdAt: string }

let blockedSession = 0;
const blockedThreads = new Set<string>();

function ReportMessage({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const action = useAction();
  function report(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = new FormData(event.currentTarget).get('reason');
    void action.run(signal => authenticated<void>('/vehicle-contact/messages/' + encodeURIComponent(id) + '/report', {
      ...jsonRequest('POST', { reason }), signal,
    }), () => setReported(true));
  }
  if (reported) return <p className="bp-muted" role="status">Message reported.</p>;
  if (!open) return <button className="bp-text" onClick={() => setOpen(true)}>Report message</button>;
  return <form className="bp-form bc-report" onSubmit={report}>
    <label>Reason<select required name="reason" defaultValue="" disabled={action.pending}>
      <option disabled value="">Choose a reason</option><option value="abuse">Abuse</option>
      <option value="spam">Spam</option><option value="other">Other</option>
    </select></label>
    {action.error && <p className="bp-error" role="alert">{action.error}</p>}
    <div className="bc-actions"><button className="bp-secondary" disabled={action.pending}>{action.pending ? 'Submitting…' : 'Submit report'}</button>
      <button type="button" className="bp-text" disabled={action.pending} onClick={() => { setOpen(false); action.clearError(); }}>Cancel</button></div>
  </form>;
}

function Conversation({ id, session }: { id: string; session: number }) {
  const path = conversationsPath + '/' + encodeURIComponent(id);
  const page = useConversationPage<{ id: string; messages: Message[] }>(path);
  const [draft, setDraft] = useState('');
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [blocked, setBlocked] = useState(() => blockedSession === session && blockedThreads.has(id));
  const [notice, setNotice] = useState('');
  const reply = useAction();
  const block = useAction();
  const messages = page.data?.messages;

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim()) return;
    setNotice('');
    void reply.run(signal => authenticated<Message>(path + '/replies', { ...jsonRequest('POST', { message: draft.trim() }), signal }), () => {
      setDraft(''); setNotice('Reply sent.'); page.refresh();
    });
  }
  function blockDriver() {
    setNotice('');
    void block.run(signal => authenticated<void>(path + '/block', { method: 'POST', signal }), () => {
      if (blockedThreads.size >= 200) {
        const oldest = blockedThreads.values().next();
        if (!oldest.done) blockedThreads.delete(oldest.value);
      }
      blockedThreads.add(id);
      setBlocked(true); setConfirmBlock(false); setDraft(''); setNotice('Driver blocked. Future messages between you are blocked.');
    });
  }
  return <>
    <section className="bp-page-surface bc-card">
      <div className="bc-heading"><h2>Messages</h2><button className="bp-secondary" disabled={!page.data && !page.error} onClick={page.refresh}>Refresh</button></div>
      {!messages ? <Feedback {...page} loading="Loading messages…" /> : messages.length === 0 ?
        <p className="bc-state" role="status">{page.isOlder ? 'No older messages.' : 'There are no visible messages in this conversation.'}</p> :
        <ol className="bc-thread">{messages.map(message => <li className={'bc-bubble' + (message.mine ? ' mine' : '')} key={message.id}>
          <strong>{message.mine ? 'You' : 'Other driver'}</strong>
          <p>{message.body}</p><Timestamp value={message.createdAt} />
          {!message.mine && <ReportMessage id={message.id} />}
        </li>)}</ol>}
      <PageButtons older={messages?.length === 100 ? () => page.older(messages[0].id) : undefined}
        newer={page.isOlder ? page.newer : undefined} />
    </section>
    {notice && <p className="bp-success" role="status">{notice}</p>}
    {blocked && !notice && <p className="bc-state">You blocked this driver.</p>}
    {messages && !blocked && <>
      <form className="bp-form bp-page-surface bc-card" onSubmit={send}>
        <fieldset disabled={reply.pending || block.pending}><legend className="bp-screen-reader">Reply to this conversation</legend>
          <MessageField label="Reply" value={draft} onChange={setDraft} /></fieldset>
        {reply.error && <p className="bp-error" role="alert">{reply.error}</p>}
        <button className="bp-primary" disabled={reply.pending || block.pending}>{reply.pending ? 'Sending…' : 'Send reply'}</button>
      </form>
      {confirmBlock ? <section className="bp-page-surface bc-card"><h2>Block this driver?</h2><p>This stops both of you from sending each other charging messages.</p>
        {block.error && <p className="bp-error" role="alert">{block.error}</p>}
        <div className="bc-actions"><button className="bp-secondary" disabled={block.pending || reply.pending} onClick={blockDriver}>{block.pending ? 'Blocking…' : 'Confirm block'}</button>
          <button className="bp-text" disabled={block.pending} onClick={() => { setConfirmBlock(false); block.clearError(); }}>Cancel</button></div>
      </section> : <div><button className="bp-text" disabled={reply.pending} onClick={() => setConfirmBlock(true)}>Block driver</button></div>}
    </>}
  </>;
}

export default function Thread() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const session = useSessionVersion();
  useEffect(() => {
    if (blockedSession !== session) {
      blockedThreads.clear();
      blockedSession = session;
    }
  }, [session]);
  const valid = typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  return <ContactPage title="Charging conversation" path={valid ? '/messages/' + id : '/messages'} introduction="Sign in to open this charging conversation." backToMessages>
    {valid ? <Conversation key={id} id={id} session={session} /> : <section className="bp-page-surface bc-card"><p className="bp-error" role="alert">Invalid conversation link.</p></section>}
  </ContactPage>;
}
