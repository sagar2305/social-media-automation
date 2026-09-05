import { computeArticleApprovalFingerprint } from './article-approval-integrity.js';
import { listJsonFiles, readJson, safeDataPath } from './pipeline-store.js';
import type { ContentBankRecord, ContentPackageRecord } from './pipeline-types.js';

export type DeliveryState = 'unknown' | 'pending' | 'published' | 'deleted' | 'sent_to_slack' | 'failed';
export type DeliveryStatus = Record<'news' | 'blog' | 'social', DeliveryState>;
type CurrentAnalysis = { canonicalId: string; analysisInputHash: string; decisionHash: string };

async function optionalJson<T>(path: string): Promise<T | undefined> {
  try { return await readJson<T>(path); } catch { return undefined; }
}

/** A reporting projection only: lane authorization is never evidence of delivery.
 * Unreadable or legacy evidence without a current analysis binding stays unknown. */
export async function readDeliveryStatuses(root: string, records: CurrentAnalysis[]): Promise<Map<string, DeliveryStatus>> {
  const statuses = new Map(records.map(record => [record.canonicalId, { news: 'unknown', blog: 'unknown', social: 'unknown' } as DeliveryStatus]));
  const current = new Map(records.map(record => [record.canonicalId, record]));
  for (const record of records) {
    const receipt = await optionalJson<{ canonicalId: string; analysisInputHash: string; decisionHash: string; status: string; revision: number }>(
      safeDataPath(root, 'reports', 'news-delivery', `${record.canonicalId}.json`),
    );
    if (receipt?.canonicalId === record.canonicalId && receipt.analysisInputHash === record.analysisInputHash &&
      receipt.decisionHash === record.decisionHash) {
      if (receipt.status === 'failed') statuses.get(record.canonicalId)!.news = 'failed';
      else if (receipt.revision > 0 && ['published', 'deleted', 'not_published'].includes(receipt.status)) {
        statuses.get(record.canonicalId)!.news = receipt.status === 'not_published' ? 'pending' : receipt.status as DeliveryState;
      }
    }
  }
  const packages = new Map<string, ContentPackageRecord>();
  for (const path of await listJsonFiles(safeDataPath(root, '06-content-packages'))) {
    const item = await optionalJson<ContentPackageRecord>(path);
    if (item?.id && item.canonicalId) packages.set(item.id, item);
  }
  const banks = new Map<string, ContentBankRecord>();
  // Later copies win ties; a fresh pending revision still supersedes old publication.
  for (const folder of ['09-pending-approval', '10-approved', '11-scheduled', '12-published']) {
    for (const path of await listJsonFiles(safeDataPath(root, folder))) {
      const bank = await optionalJson<ContentBankRecord>(path);
      if (!bank?.id || !Number.isInteger(bank.revision)) continue;
      const prior = banks.get(bank.id);
      if (!prior || bank.revision > prior.revision || (bank.revision === prior.revision &&
        (bank.updatedAt ?? bank.createdAt) >= (prior.updatedAt ?? prior.createdAt))) banks.set(bank.id, bank);
    }
  }
  const merge = (old: DeliveryState, next: DeliveryState): DeliveryState => {
    const priority: DeliveryState[] = ['unknown', 'pending', 'failed', 'sent_to_slack', 'published', 'deleted'];
    return priority.indexOf(next) > priority.indexOf(old) ? next : old;
  };
  for (const bank of banks.values()) {
    const content = packages.get(bank.contentPackageId);
    const record = content && current.get(content.canonicalId);
    const authorization = content?.productionAuthorization;
    if (!record || !authorization || authorization.analysisInputHash !== record.analysisInputHash || authorization.decisionHash !== record.decisionHash) continue;
    const status = statuses.get(record.canonicalId)!;
    const destinations = bank.destinations?.filter(item => item.platform !== 'creddy_website') ?? [];
    let social: DeliveryState = 'pending';
    if (destinations.length && destinations.every(item => item.status === 'published' && item.publishedAt && item.submissionId)) social = 'published';
    else if (destinations.some(item => item.status === 'failed')) social = 'failed';
    else {
      const slack = await optionalJson<{ id: string; revision: number; sentAt?: string; channel?: string; messageTs?: string; sent?: boolean }>(
        safeDataPath(root, 'reports', 'slack-content-ready', `${bank.id}-revision-${bank.revision}.json`),
      );
      if (slack?.id === bank.id && slack.revision === bank.revision && slack.sent !== false && slack.sentAt && slack.channel && slack.messageTs) social = 'sent_to_slack';
    }
    if (bank.mediaType !== 'article') status.social = merge(status.social, social);
    if (!bank.articleReview) continue;
    let blog: DeliveryState = bank.articleReview.status === 'publish_failed' ? 'failed' : 'pending';
    const draft = bank.contentDraftId ? await optionalJson<{ article?: { slug: string } }>(
      safeDataPath(root, '06-content-drafts', `${bank.contentDraftId}.json`),
    ) : undefined;
    const slug = bank.contentDraftId ? draft?.article?.slug : content?.article?.slug;
    if (slug && bank.articleReview.status !== 'unpublished') {
      const receipt = await optionalJson<{ approvedAt?: string; contentSha256?: string; publishedAt?: string }>(
        safeDataPath(root, 'reports', 'website-cms-published', `${slug}.json`),
      );
      if (receipt?.approvedAt && receipt.approvedAt === bank.articleReview.approvedAt && receipt.contentSha256 && receipt.publishedAt && bank.articleReview.approvedContentSha256) {
        try {
          if (await computeArticleApprovalFingerprint(root, bank) === bank.articleReview.approvedContentSha256) blog = 'published';
        } catch { /* Missing content cannot establish current delivery. */ }
      }
    }
    status.blog = merge(status.blog, blog);
  }
  return statuses;
}
