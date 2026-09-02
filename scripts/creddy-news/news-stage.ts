import { createHash } from 'node:crypto';
import { configuredNewsService, type NewsService } from '../../shared/creddy-news/creddy-news-service.js';
import { validateNewsContent, publicHttps, type NewsContent, type NewsCategory } from '../../shared/creddy-news/creddy-news-types.js';
import { notifyNews } from '../../shared/creddy-news/creddy-news-slack.js';
import { listJsonFiles, readJson, safeDataPath, writeJsonAtomic } from '../creddy/pipeline-store.js';
import { validateAnalysisDecision } from '../creddy/analysis-stage.js';
import { evaluateTrustedNewsPolicy } from '../creddy/news-policy.js';
import type { AnalysisDecisionRecord, CanonicalNewsRecord, RawArticleRecord } from '../creddy/pipeline-types.js';

export function newsSourceKey(value: string): string {
  const url = new URL(value); url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort(); url.pathname = url.pathname.replace(/\/$/, '') || '/';
  return url.toString();
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Defense in depth for source titles copied into Agent 03 output. Publisher
 * attribution is rendered separately, so remove only an exact trailing suffix. */
export function newsHeadlineWithoutPublisherSuffix(headline: string, publisher: string): string {
  const trimmed = headline.trim();
  const source = publisher.trim();
  if (!source) return trimmed;
  return trimmed.replace(
    new RegExp(`\\s+(?:-|–|—|\\|)\\s*${escapeRegularExpression(source)}\\s*$`, 'iu'),
    '',
  ).trim();
}

export type ApprovedNewsImage = { url: string; rights: 'licensed' | 'owned' | 'publisher_permission'; attribution: string };
export function prepareAppNews(
  decision: AnalysisDecisionRecord,
  article: CanonicalNewsRecord,
  evidence: RawArticleRecord[],
  now = Date.now(),
  approvedImage?: ApprovedNewsImage,
  firstSeenAt?: string,
) {
  const categories: Record<string, NewsCategory> = { card_offer: 'Credit cards', loyalty_news: 'Loyalty', redemption: 'Points & miles', travel_development: 'Travel rewards', evergreen_education: 'Credit cards' };
  const policy = evaluateTrustedNewsPolicy({ decision, article, evidence, firstSeenAt, now });
  const content: NewsContent = { headline: newsHeadlineWithoutPublisherSuffix(decision.headline, article.sourceName),
    summary: decision.summary,
    category: categories[decision.portfolioCategory ?? ''] ?? 'Credit cards',
    publisher: article.sourceName, source_url: article.canonicalUrl,
    image_url: null, published_at: policy.date.timestamp };
  const errors: string[] = [];
  try { validateAnalysisDecision(decision); } catch { errors.push('Analysis did not pass the current evidence/routing contract.'); }
  if (!policy.eligible) errors.push(policy.reason ?? 'The item did not pass the trusted-source News policy.');
  if (decision.canonicalId !== article.canonicalId) errors.push('Source identity mismatch.');
  const ids = new Set(evidence.map(item => item.id));
  if (!decision.claims.length || decision.claims.some(claim => claim.conflict || claim.confidence < 60
    || !claim.sourceRecordIds.length || claim.sourceRecordIds.some(id => !ids.has(id)))) errors.push('Every claim needs attached high-confidence evidence.');
  if (decision.expiry && (!Number.isFinite(Date.parse(decision.expiry)) || Date.parse(decision.expiry) <= now)) errors.push('Story has expired or has an invalid deadline.');
  try { validateNewsContent(content, now); } catch (error) { errors.push((error as Error).message); }
  // Only an operator-maintained rights registry may authorize an image. Scraped metadata cannot.
  const image = approvedImage;
  if (image && ['licensed', 'owned', 'publisher_permission'].includes(image.rights ?? '') && image.attribution?.trim() && publicHttps(image.url)) content.image_url = image.url;
  return { content, error: errors.length ? errors.join(' ') : null, provenance: {
    canonicalId: article.canonicalId, analysisId: decision.id, evidenceRecordIds: decision.evidenceRecordIds,
    claims: decision.claims, imageRights: content.image_url ? image : null,
    sourcePublishedAt: policy.date.sourcePublishedAt ?? null,
    firstSeenAt: policy.date.firstSeenAt,
    dateBasis: policy.date.basis,
    trustedSourceIds: policy.trustedSourceIds,
  } };
}

/** Publishes a caller-provided projection from either the shared ledger or the
 * isolated repair/backfill root. It never chooses candidates implicitly when
 * `canonicalIds` is supplied by the hourly orchestrator. */
export async function runAppNewsStage(root: string, options: {
  env?: NodeJS.ProcessEnv;
  service?: NewsService;
  notify?: typeof notifyNews;
  canonicalIds?: string[];
  notifyMode?: 'all' | 'published_only' | 'none';
} = {}) {
  const env = options.env ?? process.env;
  if (env.CREDDY_NEWS_ENABLED !== 'true') return {
    disabled: true, published: 0, publishedNew: 0, publishedChanged: 0, publishedReconciled: 0,
    publishedUnchanged: 0,
    notPublished: 0, deleted: 0, publishedIds: [], withheld: [], failures: [],
  };
  const service = options.service ?? configuredNewsService(env);
  const result = {
    disabled: false,
    published: 0,
    publishedNew: 0,
    publishedChanged: 0,
    publishedReconciled: 0,
    publishedUnchanged: 0,
    notPublished: 0,
    deleted: 0,
    publishedIds: [] as string[],
    withheld: [] as Array<{ id: string; headline: string; reason: string }>,
    failures: [] as Array<{ id: string; reason: string }>,
  };
  const canonicals = new Map<string, CanonicalNewsRecord>();
  for (const path of await listJsonFiles(safeDataPath(root, '03-canonical-news', 'approved'))) {
    const item = await readJson<CanonicalNewsRecord>(path);
    if (item.canonicalId && item.canonicalUrl) canonicals.set(item.canonicalId, item);
  }
  const raw = new Map<string, RawArticleRecord>();
  const firstSeen = new Map<string, string>();
  for (const path of await listJsonFiles(safeDataPath(root, '05-editorial-ledger', 'items'))) {
    const item = await readJson<{ canonicalId?: string; firstSeenAt?: string }>(path);
    if (item.canonicalId && item.firstSeenAt) firstSeen.set(item.canonicalId, item.firstSeenAt);
  }
  const images = env.CREDDY_NEWS_IMAGE_RIGHTS_REGISTRY_PATH
    ? await readJson<Record<string, ApprovedNewsImage>>(env.CREDDY_NEWS_IMAGE_RIGHTS_REGISTRY_PATH) : {};
  for (const path of await listJsonFiles(safeDataPath(root, '01-raw'))) {
    const item = await readJson<RawArticleRecord>(path); raw.set(item.id, item);
  }
  for (const path of await listJsonFiles(safeDataPath(root, '04-analysis-queue', 'completed'))) {
    const decision = await readJson<AnalysisDecisionRecord>(path);
    if (options.canonicalIds && !options.canonicalIds.includes(decision.canonicalId)) continue;
    const article = canonicals.get(decision.canonicalId);
    if (!article) continue;
    try {
      const sourceKey = newsSourceKey(article.canonicalUrl);
      const id = `news-${createHash('sha256').update(article.canonicalId).digest('hex').slice(0, 32)}`;
      const prepared = prepareAppNews(
        decision,
        article,
        decision.evidenceRecordIds.flatMap(id => raw.has(id) ? [raw.get(id)!] : []),
        Date.now(),
        images[sourceKey],
        firstSeen.get(decision.canonicalId),
      );
      if (!Number.isFinite(prepared.content.published_at)) prepared.content.published_at = 0;
      const previous = await service.findByIdentity(id, sourceKey);
      const item = await service.ingest({ id, sourceKey, ...prepared });
      let unchangedPublished = false;
      if (item.status === 'published') {
        result.published++;
        result.publishedIds.push(decision.canonicalId);
        if (!previous) result.publishedNew++;
        else if (item.revision !== previous.revision) result.publishedChanged++;
        else { unchangedPublished = true; result.publishedUnchanged++; }
      }
      else if (item.status === 'deleted') result.deleted++;
      else {
        result.notPublished++;
        result.withheld.push({ id: decision.canonicalId, headline: item.content.headline, reason: item.validation_error ?? 'Did not pass final News eligibility.' });
      }
      const notifyMode = options.notifyMode ?? 'all';
      const notificationPending = item.slack_revision < item.revision;
      let reconciledNotification = false;
      if (notificationPending &&
          (notifyMode === 'all' || (notifyMode === 'published_only' && item.status === 'published'))) {
        await (options.notify ?? notifyNews)(service, item.id, env);
        reconciledNotification = unchangedPublished;
      }
      if (unchangedPublished) {
        if (reconciledNotification) {
          result.publishedUnchanged--;
          result.publishedReconciled++;
        }
      }
    } catch (error) { result.failures.push({ id: decision.canonicalId, reason: (error as Error).message }); }
  }
  await writeJsonAtomic(safeDataPath(root, 'reports', 'latest', 'app-news.json'), result);
  return result;
}
