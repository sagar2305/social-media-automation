import { createHash } from 'node:crypto';
import { basename } from 'node:path';

import type { NewsImageReplacement, NewsService } from '../../shared/creddy-news/creddy-news-service.js';
import { notifyNews } from '../../shared/creddy-news/creddy-news-slack.js';
import { publicHttps, type NewsItem } from '../../shared/creddy-news/creddy-news-types.js';
import { prepareNewsBrandImage } from '../creddy/editorial-image-delivery.js';
import { listJsonFiles, readJson, safeDataPath, writeJsonAtomic } from '../creddy/pipeline-store.js';

type PendingImage = {
  id: string;
  newsId?: string;
  reason: string;
  status: string;
  recordedAt?: string;
  lastAttemptAt?: string;
  attempts?: number;
  previousImage?: { url: string | null; imageRights: unknown; revision: number };
};

function hasApprovedImage(item: NewsItem): boolean {
  const image = item.provenance.imageRights as Partial<NewsImageReplacement> | null | undefined;
  return Boolean(item.content.image_url && publicHttps(item.content.image_url) && image
    && image.url === item.content.image_url
    && ['licensed', 'owned', 'publisher_permission', 'editorial_reference'].includes(image.rights ?? '')
    && typeof image.attribution === 'string' && image.attribution.trim());
}

/** Repair only the durable image queue for already-published News, five items per hourly run. */
export async function reconcilePendingNewsImages(root: string, options: {
  service: NewsService;
  env?: NodeJS.ProcessEnv;
  prepareImage?: typeof prepareNewsBrandImage;
  notify?: typeof notifyNews;
}) {
  const env = options.env ?? process.env;
  const result = { disabled: env.CREDDY_NEWS_ENABLED !== 'true', attempted: 0, updated: 0, completed: 0,
    pending: 0, failed: 0, results: [] as Array<{ id: string; status: 'complete' | 'pending'; reason?: string }> };
  if (result.disabled) return result;
  const queue: Array<{ path: string; record: PendingImage }> = [];
  for (const path of await listJsonFiles(safeDataPath(root, 'reports', 'news-image-pending'))) {
    try {
      const record = await readJson<PendingImage>(path);
      if (record.status !== 'pending_image_refresh') continue;
      if (typeof record.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(record.id)
        || record.newsId !== undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(record.newsId)) throw new Error('Invalid pending identity');
      queue.push({ path, record });
    } catch {
      result.failed++;
      result.results.push({ id: basename(path, '.json'), status: 'pending', reason: 'Pending image record could not be read.' });
    }
  }
  // Rotate failures and unknown brands so the same five items cannot starve the queue.
  queue.sort((a, b) => (a.record.lastAttemptAt ?? '').localeCompare(b.record.lastAttemptAt ?? '') || a.path.localeCompare(b.path));
  result.pending = queue.length;
  for (const { path, record } of queue.slice(0, 5)) {
    result.attempted++;
    const updatedRecord = { ...record, attempts: (record.attempts ?? 0) + 1, lastAttemptAt: new Date().toISOString() };
    let completed = false;
    let reason = 'Image repair failed; the item remains pending.';
    try {
      const newsId = record.newsId ?? `news-${createHash('sha256').update(record.id).digest('hex').slice(0, 32)}`;
      let item = await options.service.get(newsId);
      if (item.id !== newsId) throw new Error('News identity changed');
      updatedRecord.newsId = newsId;
      if (item.status !== 'published') {
        reason = 'News is not published; no image change was made.';
      } else if (item.content.image_url && !hasApprovedImage(item)) {
        reason = 'Existing image needs a provenance review; no image change was made.';
      } else {
        if (!item.content.image_url) {
          const image = await (options.prepareImage ?? prepareNewsBrandImage)(root, `${item.content.headline} ${item.content.summary}`, env);
          if (image) {
            updatedRecord.previousImage ??= { url: item.content.image_url, imageRights: item.provenance.imageRights ?? null, revision: item.revision };
            // Persist the preimage before the revision-guarded image mutation.
            await writeJsonAtomic(path, updatedRecord);
            const previousRevision = item.revision;
            item = await options.service.setImage(item.id, item.revision, image, 'pipeline:pending-image-repair');
            if (item.id !== newsId || item.status !== 'published' || item.content.image_url !== image.url || !hasApprovedImage(item)) {
              throw new Error('Image publication was not confirmed');
            }
            if (item.revision !== previousRevision) result.updated++;
          } else reason = 'No reviewed brand asset matches; the image remains pending.';
        }
        if (hasApprovedImage(item)) {
          await (options.notify ?? notifyNews)(options.service, item.id, env);
          const receipt = await options.service.get(item.id);
          completed = receipt.id === newsId && receipt.status === 'published' && hasApprovedImage(receipt)
            && receipt.revision >= item.revision && receipt.slack_revision >= receipt.revision
            && Boolean(receipt.slack_channel && receipt.slack_ts) && !receipt.slack_error
            && (!env.CREDDY_NEWS_SLACK_CHANNEL_ID || receipt.slack_channel === env.CREDDY_NEWS_SLACK_CHANNEL_ID);
          if (!completed) reason = 'Image is published; its Slack receipt remains pending.';
        }
      }
    } catch {
      result.failed++;
    }
    if (completed) { result.completed++; result.pending--; }
    try {
      await writeJsonAtomic(path, { ...updatedRecord, status: completed ? 'complete' : 'pending_image_refresh',
        reason: completed ? 'Published image and Slack receipt confirmed.' : reason,
        ...(completed ? { completedAt: new Date().toISOString() } : {}) });
    } catch {
      result.failed++;
      if (completed) { result.completed--; result.pending++; completed = false; }
      reason = 'Repair receipt could not be saved; the durable item can be retried.';
    }
    result.results.push({ id: record.id, status: completed ? 'complete' : 'pending', ...(completed ? {} : { reason }) });
  }
  return result;
}
