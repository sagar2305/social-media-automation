'use client';

import { useCallback, useEffect, useState } from 'react';
import { NEWS_CATEGORIES, publicHttps, type NewsItem, type NewsPatch } from '@/lib/creddy-news-types';

const labels = { published: 'Published', not_published: 'Not published', deleted: 'Deleted' };
const button = 'rounded-lg border px-3 py-2 text-sm disabled:opacity-40';

export function NewsManager({ canEdit }: { canEdit: boolean }) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState('all');
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<NewsItem | null>(null);
  const [patch, setPatch] = useState<NewsPatch>({ headline: '', summary: '', category: 'Credit cards' });
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/creddy/news?offset=${offset}`, { cache: 'no-store', signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not load News.');
      setItems(data.items); setEnabled(data.enabled); setError('');
    } catch (failure) {
      if (!signal?.aborted) setError((failure as Error).message);
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [offset]);
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    const timer = setInterval(() => { if (!document.hidden) void reload(controller.signal); }, 5000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [reload]);
  async function act(item: NewsItem, action: 'edit' | 'delete' | 'retry_notification') {
    if (action === 'delete' && !window.confirm('Delete this story from the app? It will remain in the Deleted list and will not be automatically re-imported.')) return;
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/creddy/news', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: item.id, revision: item.revision, action, ...(action === 'edit' ? { patch } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'News action failed.');
      setNotice(result.warning ?? (action === 'delete' ? 'Deleted from app News.' : action === 'edit' ? 'Saved to app News.' : 'Slack notification checked.'));
      setEditing(null); await reload();
    } catch (failure) { setNotice((failure as Error).message); }
    finally { setBusy(false); }
  }
  const visible = items.filter(item => filter === 'all' || item.status === filter);
  return <section className="space-y-5">
    <div><h1 className="text-2xl font-semibold">App News</h1>
      <p className="mt-1 text-sm text-muted-foreground">Short news for iOS and Android. Website articles and social approval stay separate.</p></div>
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-sm">Status <select aria-label="News status" className="ml-2 rounded-lg border bg-background p-2" value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="all">All on this page</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <button className={button} onClick={() => void reload()}>Refresh</button>
      <span className="text-sm text-muted-foreground">Updates every 5 seconds</span>
    </div>
    {!enabled && !loading && <p className="rounded-lg border p-3 text-sm">News publishing is disabled. Configure and enable it after the database and Slack setup are verified.</p>}
    {error && <p role="alert" className="rounded-lg border border-red-300 p-3 text-sm">{error}</p>}
    {notice && <p role="status" className="rounded-lg border p-3 text-sm">{notice}</p>}
    {loading ? <p>Loading News...</p> : !error && !visible.length ? <p className="rounded-xl border p-8 text-muted-foreground">No news in this view. Eligible stories appear after the shared cycle runs.</p> : null}
    <div className="grid gap-4 lg:grid-cols-2">{visible.map(item => <article key={item.id} className="space-y-3 rounded-xl border bg-card p-5">
      <div className="flex justify-between gap-3"><span className={`rounded-full px-3 py-1 text-xs font-medium ${item.status === 'published' ? 'bg-green-100 text-green-900' : item.status === 'deleted' ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-900'}`}>{labels[item.status]}</span>
        <span className="text-xs text-muted-foreground">Revision {item.revision}</span></div>
      <h2 className="text-lg font-semibold">{item.content.headline}</h2>
      <p className="whitespace-pre-wrap text-sm leading-6">{item.content.summary}</p>
      <p className="text-xs text-muted-foreground">{item.content.publisher} · {item.content.category} · Updated {new Date(item.updated_at).toLocaleString()}</p>
      {publicHttps(item.content.source_url) && <a href={item.content.source_url} target="_blank" rel="noreferrer" className="text-sm underline">Original source</a>}
      {item.validation_error && <p className="text-sm text-amber-700">{item.validation_error}</p>}
      {item.slack_error && <p className="text-sm text-amber-700">Slack: {item.slack_error}</p>}
      <div className="flex flex-wrap gap-2">{canEdit && enabled && item.status === 'published' && <>
        <button className={button} disabled={busy} onClick={() => { setEditing(item); setPatch({ headline: item.content.headline, summary: item.content.summary, category: item.content.category }); }}>Edit</button>
        <button className={`${button} text-red-700`} disabled={busy} onClick={() => void act(item, 'delete')}>Delete from app</button>
      </>}{canEdit && enabled && item.slack_revision < item.revision && <button className={button} disabled={busy} onClick={() => void act(item, 'retry_notification')}>Retry Slack</button>}</div>
    </article>)}</div>
    <div className="flex items-center gap-3"><button className={button} disabled={offset === 0 || busy} onClick={() => setOffset(Math.max(0, offset - 100))}>Previous</button>
      <span className="text-sm">Page {offset / 100 + 1}</span><button className={button} disabled={items.length < 100 || busy} onClick={() => setOffset(offset + 100)}>Next</button></div>
    {editing && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="news-edit-title">
      <form className="w-full max-w-xl space-y-4 rounded-xl bg-background p-6" onSubmit={event => { event.preventDefault(); void act(editing, 'edit'); }}>
        <h2 id="news-edit-title" className="text-xl font-semibold">Edit app News</h2>
        <p className="text-sm text-muted-foreground">Changes go live immediately. Keep the text consistent with its verified source.</p>
        <label className="block text-sm">Headline<input autoFocus required minLength={10} maxLength={160} className="mt-1 w-full rounded border bg-background p-2" value={patch.headline} onChange={event => setPatch({ ...patch, headline: event.target.value })} /></label>
        <label className="block text-sm">Summary<textarea required minLength={80} maxLength={480} rows={6} className="mt-1 w-full rounded border bg-background p-2" value={patch.summary} onChange={event => setPatch({ ...patch, summary: event.target.value })} /><span>{patch.summary.length}/480 characters</span></label>
        <label className="block text-sm">Category<select className="ml-2 rounded border bg-background p-2" value={patch.category} onChange={event => setPatch({ ...patch, category: event.target.value as NewsPatch['category'] })}>{NEWS_CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></label>
        {notice && <p role="alert" className="text-sm">{notice}</p>}
        <div className="flex gap-2"><button type="submit" disabled={busy} className={button}>{busy ? 'Saving...' : 'Save to app'}</button><button type="button" disabled={busy} className={button} onClick={() => setEditing(null)}>Cancel</button></div>
      </form>
    </div>}
  </section>;
}
