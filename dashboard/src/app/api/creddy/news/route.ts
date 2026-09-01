import { assertRole } from '@/lib/auth';
import { configuredNewsService, requireNewsWrites } from '@/lib/creddy-news-service';
import { notifyNews } from '@/lib/creddy-news-slack';
import type { NewsPatch } from '@/lib/creddy-news-types';

export async function GET(request: Request) {
  const auth = await assertRole('viewer');
  if (!auth.ok) return Response.json({ error: 'Staff access required.' }, { status: 403 });
  const offset = Number(new URL(request.url).searchParams.get('offset') ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) return Response.json({ error: 'Invalid page.' }, { status: 400 });
  try {
    const items = await configuredNewsService().list(offset);
    return Response.json({ items, enabled: process.env.CREDDY_NEWS_ENABLED === 'true' }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 503 }); }
}

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: 'Invalid request origin.' }, { status: 403 });
  const auth = await assertRole('editor');
  if (!auth.ok) return Response.json({ error: 'Editor access required.' }, { status: 403 });
  try {
    requireNewsWrites();
    const body = await request.json() as { id: string; revision: number; action: string; patch?: NewsPatch };
    if (!['edit', 'delete', 'retry_notification'].includes(body.action)) throw new Error('Unsupported news action.');
    const service = configuredNewsService();
    if (body.action !== 'retry_notification') await service.manage(body.id, body.revision, body.action as 'edit' | 'delete', body.patch ?? null, `dashboard:${auth.user.id}`);
    let warning: string | undefined;
    try { await notifyNews(service, body.id); }
    catch { warning = 'App state saved. Slack notification is pending; use Retry Slack.'; }
    return Response.json({ item: await service.get(body.id), warning });
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
}
