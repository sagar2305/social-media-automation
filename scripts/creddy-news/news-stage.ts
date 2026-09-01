import { createHash } from 'node:crypto';
import { configuredNewsService, type NewsService } from '../../shared/creddy-news/creddy-news-service.js';
import { validateNewsContent, publicHttps, type NewsContent, type NewsCategory } from '../../shared/creddy-news/creddy-news-types.js';
import { notifyNews } from '../../shared/creddy-news/creddy-news-slack.js';
import { listJsonFiles, readJson, safeDataPath, writeJsonAtomic } from '../creddy/pipeline-store.js';
import { validateAnalysisDecision } from '../creddy/analysis-stage.js';
import type { AnalysisDecisionRecord, CanonicalNewsRecord, RawArticleRecord } from '../creddy/pipeline-types.js';

export function newsSourceKey(value: string): string {
  const url = new URL(value); url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort(); url.pathname = url.pathname.replace(/\/$/, '') || '/';
  return url.toString();
}
export type ApprovedNewsImage = { url: string; rights: 'licensed' | 'owned' | 'publisher_permission'; attribution: string };
export function prepareAppNews(decision: AnalysisDecisionRecord, article: CanonicalNewsRecord, evidence: RawArticleRecord[], now = Date.now(), approvedImage?: ApprovedNewsImage) {
  const categories: Record<string, NewsCategory> = { card_offer: 'Credit cards', loyalty_news: 'Loyalty', redemption: 'Points & miles', travel_development: 'Travel rewards', evergreen_education: 'Credit cards' };
  const sourceDate = article.publishedAt ?? article.providerMetadata?.['article:published_time'] ?? article.providerMetadata?.datePublished;
  const content: NewsContent = { headline: decision.headline,
    summary: decision.summary,
    category: categories[decision.portfolioCategory ?? ''] ?? 'Credit cards',
    publisher: article.sourceName, source_url: article.canonicalUrl,
    image_url: null, published_at: typeof sourceDate === 'string' ? Date.parse(sourceDate) : NaN };
  const errors: string[] = [];
  try { validateAnalysisDecision(decision); } catch { errors.push('Analysis did not pass the current evidence/routing contract.'); }
  const currentGate = decision as AnalysisDecisionRecord & { analysisBatchId?: string; verificationGate?: { official: { status: string } } };
  if (currentGate.verificationGate?.official.status === 'conflicting'
    || (currentGate.analysisBatchId && currentGate.verificationGate?.official.status !== 'verified')) {
    errors.push('Current batched news requires completed official verification without conflict.');
  }
  if (decision.canonicalId !== article.canonicalId) errors.push('Source identity mismatch.');
  if (!['auto_process', 'evergreen_queue'].includes(decision.route) || decision.verificationState !== 'ready'
    || decision.rubricVersion !== 'creddy-ranking-v3' || decision.materialConflict || decision.confidenceScore < 80) errors.push('Verified, conflict-free news is required.');
  const ids = new Set(evidence.map(item => item.id));
  if (!decision.claims.length || decision.claims.some(claim => claim.conflict || claim.confidence < 80
    || !claim.sourceRecordIds.length || claim.sourceRecordIds.some(id => !ids.has(id)))) errors.push('Every claim needs attached high-confidence evidence.');
  if (decision.claims.some(claim => !evidence.some(item => item.factualUse === 'discovery_and_confirmation'
    && claim.sourceRecordIds.includes(item.id)))) errors.push('Community/creator leads need confirmation evidence for every claim.');
  if (!Number.isFinite(content.published_at) || content.published_at < now - 72 * 3_600_000) errors.push('Source publication must be within the last 72 hours.');
  if (decision.expiry && (!Number.isFinite(Date.parse(decision.expiry)) || Date.parse(decision.expiry) <= now)) errors.push('Story has expired or has an invalid deadline.');
  try { validateNewsContent(content, now); } catch (error) { errors.push((error as Error).message); }
  // Only an operator-maintained rights registry may authorize an image. Scraped metadata cannot.
  const image = approvedImage;
  if (image && ['licensed', 'owned', 'publisher_permission'].includes(image.rights ?? '') && image.attribution?.trim() && publicHttps(image.url)) content.image_url = image.url;
  return { content, error: errors.length ? errors.join(' ') : null, provenance: {
    canonicalId: article.canonicalId, analysisId: decision.id, evidenceRecordIds: decision.evidenceRecordIds,
    claims: decision.claims, imageRights: content.image_url ? image : null } };
}

/** Publishes only from the standalone News Agent data root. */
export async function runAppNewsStage(root: string, options: { env?: NodeJS.ProcessEnv; service?: NewsService; notify?: typeof notifyNews; canonicalIds?: string[] } = {}) {
  const env = options.env ?? process.env;
  if (env.CREDDY_NEWS_ENABLED !== 'true') return { disabled: true, published: 0, notPublished: 0, deleted: 0, failures: [] };
  const service = options.service ?? configuredNewsService(env);
  const result = { disabled: false, published: 0, notPublished: 0, deleted: 0, failures: [] as Array<{ id: string; reason: string }> };
  const canonicals = new Map<string, CanonicalNewsRecord>();
  for (const path of await listJsonFiles(safeDataPath(root, '03-canonical-news', 'approved'))) {
    const item = await readJson<CanonicalNewsRecord>(path);
    if (item.canonicalId && item.canonicalUrl) canonicals.set(item.canonicalId, item);
  }
  const raw = new Map<string, RawArticleRecord>();
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
      const prepared = prepareAppNews(decision, article, decision.evidenceRecordIds.flatMap(id => raw.has(id) ? [raw.get(id)!] : []), Date.now(), images[sourceKey]);
      if (!Number.isFinite(prepared.content.published_at)) prepared.content.published_at = 0;
      const item = await service.ingest({ id, sourceKey, ...prepared });
      if (item.status === 'published') result.published++;
      else if (item.status === 'deleted') result.deleted++;
      else result.notPublished++;
      await (options.notify ?? notifyNews)(service, item.id, env);
    } catch (error) { result.failures.push({ id: decision.canonicalId, reason: (error as Error).message }); }
  }
  await writeJsonAtomic(safeDataPath(root, 'reports', 'latest', 'app-news.json'), result);
  return result;
}
