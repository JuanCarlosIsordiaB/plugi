import { useState } from 'react';
import { useResource } from '../charging/ui.web';

export const conversationsPath = '/vehicle-contact/conversations';

export function useConversationPage<T>(path: string) {
  const [history, setHistory] = useState<string[]>([]);
  const before = history.at(-1);
  const resource = useResource<T>(before ? path + '?before=' + encodeURIComponent(before) : path, true);
  function refresh() {
    setHistory([]);
    resource.retry();
  }
  return { ...resource, refresh, isOlder: !!before, older: (id: string) => setHistory([...history, id]),
    newer: () => setHistory(history.slice(0, -1)) };
}

export function PageButtons({ older, newer }: { older?: () => void; newer?: () => void }) {
  if (!older && !newer) return null;
  return <div className="bc-actions">
    {newer && <button type="button" className="bp-secondary" onClick={newer}>Newer</button>}
    {older && <button type="button" className="bp-secondary" onClick={older}>Older</button>}
  </div>;
}

export function Timestamp({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>;
}
