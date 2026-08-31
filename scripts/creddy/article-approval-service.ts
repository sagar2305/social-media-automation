import { readFile, unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { computeArticleApprovalFingerprint } from './article-approval-integrity.js';
import { pathExists, readJson, safeDataPath, withStageLock, writeJsonAtomic } from './pipeline-store.js';
import type { ContentBankRecord } from './pipeline-types.js';
import { assertArticleVerificationPublishable, assertBankVerificationIntegrity } from './publication-policy.js';

const BANK_DIRECTORIES = ['12-published', '11-scheduled', '10-approved', '09-pending-approval', '13-rejected-content'] as const;
const WEBSITE_BASE_URL = 'https://getcreddy.com';

export type WebsitePublishBatchResult = {
  published: number;
  skipped: number;
  failures: Array<{ exportPath: string; reason: string }>;
};

export type ArticleApprovalPublishResult = {
  id: string;
  slug: string;
  approvalRecorded: boolean;
  publishState: 'published' | 'skipped';
  liveUrl: string;
  publishedAt: string;
};

type ArticleReceipt = {
  version: number;
  slug: string;
  approvedAt: string;
  contentSha256: string;
  publishedAt: string;
  revalidation: 'revalidated' | 'not_configured' | 'failed';
  cmsIdentifier?: string;
  liveUrl?: string;
};

function freshness(record: ContentBankRecord): number {
  return Math.max(0, ...[
    record.updatedAt,
    record.createdAt,
    record.articleReview?.publishedAt,
    record.articleReview?.publishAttemptedAt,
    record.articleReview?.approvedAt,
  ].map((value) => value ? Date.parse(value) : 0).filter(Number.isFinite));
}

async function findRecord(root: string, id: string): Promise<{ path: string; record: ContentBankRecord }> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(id)) throw new Error('Invalid content id');
  const candidates: Array<{ path: string; record: ContentBankRecord }> = [];
  for (const directory of BANK_DIRECTORIES) {
    const path = safeDataPath(root, directory, `${id}.json`);
    if (await pathExists(path)) candidates.push({ path, record: await readJson<ContentBankRecord>(path) });
  }
  candidates.sort((left, right) => freshness(right.record) - freshness(left.record));
  if (!candidates[0]) throw new Error('Creddy content item not found');
  return candidates[0];
}

async function writeReviewRecord(root: string, path: string, record: ContentBankRecord): Promise<void> {
  await writeJsonAtomic(path, record);
  const pendingPath = safeDataPath(root, '09-pending-approval', `${record.id}.json`);
  if (pendingPath !== path) await writeJsonAtomic(pendingPath, record);
}

async function articleSlug(root: string, record: ContentBankRecord): Promise<string> {
  const sourcePath = record.contentDraftId
    ? safeDataPath(root, '06-content-drafts', `${record.contentDraftId}.json`)
    : safeDataPath(root, '06-content-packages', `${record.contentPackageId}.json`);
  const source = await readJson<{ article?: { slug?: string } }>(sourcePath);
  const slug = source.article?.slug?.trim();
  if (!slug || !/^[a-z0-9][a-z0-9-]{1,99}$/.test(slug)) throw new Error('Website article slug is invalid');
  return slug;
}

function safePublishError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/service.role|server credential|SUPABASE_SERVICE_ROLE_KEY/i.test(message)) return 'Website CMS server credential is not configured.';
  if (/project.*match|mismatch/i.test(message)) return 'Website CMS project configuration does not match.';
  if (/disabled|gate/i.test(message)) return 'Website CMS publishing is disabled.';
  if (/already running/i.test(message)) return 'Website publishing is already in progress.';
  return 'Agent 8 could not publish this approved article. Check the server configuration and retry.';
}

async function withApprovalLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    try {
      return await withStageLock(root, 'article_approval_publish', action, 10 * 60 * 1000);
    } catch (error) {
      if (!/Stage already running: article_approval_publish/.test((error as Error).message)) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    }
  }
  throw new Error('Website publishing is already running');
}

function validateArticleReview(root: string, record: ContentBankRecord): void {
  if (!record.articlePreviewPath || !record.articleReview) throw new Error('This item has no website article preview');
  if (!isAbsolute(record.articlePreviewPath)) throw new Error('Article preview path must be absolute');
  const rel = relative(resolve(root), resolve(record.articlePreviewPath));
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Article preview is outside the Creddy data root');
  if (record.articleReview.status === 'needs_assets' || record.articleReview.blockers?.length) {
    throw new Error('Article assets must be completed before website approval');
  }
  if (record.status === 'rejected') throw new Error('Cannot approve a website article from rejected content');
}

async function successfulReceipt(root: string, slug: string, approvedAt: string | undefined): Promise<ArticleReceipt | undefined> {
  if (!approvedAt) return undefined;
  const path = safeDataPath(root, 'reports', 'website-cms-published', `${slug}.json`);
  if (!(await pathExists(path))) return undefined;
  const receipt = await readJson<ArticleReceipt>(path);
  return receipt.approvedAt === approvedAt && receipt.contentSha256 ? receipt : undefined;
}

export async function approveAndPublishWebsiteArticle(input: {
  root: string;
  id: string;
  approvedBy: string;
  publish: () => Promise<WebsitePublishBatchResult>;
  websiteBaseUrl?: string;
  now?: () => Date;
  automaticRelease?: boolean;
}): Promise<ArticleApprovalPublishResult> {
  return withApprovalLock(input.root, async () => {
    const now = input.now ?? (() => new Date());
    let { path, record } = await findRecord(input.root, input.id);
    await assertBankVerificationIntegrity(input.root, record);
    assertArticleVerificationPublishable(record.verificationGate);
    validateArticleReview(input.root, record);
    await readFile(record.articlePreviewPath!);
    const slug = await articleSlug(input.root, record);
    const baseUrl = (input.websiteBaseUrl?.trim() || WEBSITE_BASE_URL).replace(/\/$/, '');
    const liveUrl = `${baseUrl}/blog/${slug}`;
    const receipt = await successfulReceipt(input.root, slug, record.articleReview?.approvedAt);
    if (receipt) {
      const reconciled: ContentBankRecord = {
        ...record,
        updatedAt: now().toISOString(),
        articleReview: {
          ...record.articleReview!,
          status: 'published',
          publishError: undefined,
          cmsIdentifier: receipt.cmsIdentifier || slug,
          publishedAt: receipt.publishedAt,
          publishedUrl: receipt.liveUrl || liveUrl,
        },
      };
      await writeReviewRecord(input.root, path, reconciled);
      return { id: record.id, slug, approvalRecorded: false, publishState: 'skipped', liveUrl, publishedAt: receipt.publishedAt };
    }

    let approvalRecorded = false;
    if (record.articleReview!.status === 'pending_review' || record.articleReview!.status === 'changes_requested') {
      const approvedAt = now().toISOString();
      const approvedContentSha256 = await computeArticleApprovalFingerprint(input.root, record);
      record = {
        ...record,
        updatedAt: approvedAt,
        articleReview: {
          ...record.articleReview!,
          status: 'approved',
          approvedBy: input.approvedBy.trim() || 'human-reviewer',
          approvedAt,
          approvedContentSha256,
          blockers: [],
          requestedBy: undefined,
          requestedAt: undefined,
          changeNotes: undefined,
          publishError: undefined,
        },
      };
      await writeReviewRecord(input.root, path, record);
      approvalRecorded = true;
    } else if (!['approved', 'publish_failed', 'publishing', 'unpublished'].includes(record.articleReview!.status)) {
      throw new Error(`Cannot publish an article in ${record.articleReview!.status} state`);
    }

    if (record.articleReview!.status === 'unpublished') {
      record = {
        ...record,
        articleReview: {
          ...record.articleReview!,
          status: 'approved',
          unpublishedBy: undefined,
          unpublishedAt: undefined,
          publishError: undefined,
        },
      };
      await writeReviewRecord(input.root, path, record);
    }

    const currentFingerprint = await computeArticleApprovalFingerprint(input.root, record);
    if (
      !record.articleReview!.approvedContentSha256 ||
      currentFingerprint !== record.articleReview!.approvedContentSha256
    ) {
      if (input.automaticRelease) {
        const refreshedAt = now().toISOString();
        record = {
          ...record,
          updatedAt: refreshedAt,
          articleReview: {
            ...record.articleReview!,
            status: 'approved',
            approvedBy: input.approvedBy.trim() || 'Agent 7 automatic website release',
            approvedAt: refreshedAt,
            approvedContentSha256: currentFingerprint,
            publishingStartedAt: undefined,
            publishError: undefined,
            requestedBy: undefined,
            requestedAt: undefined,
            changeNotes: undefined,
          },
        };
        await writeReviewRecord(input.root, path, record);
        approvalRecorded = true;
      } else {
      const requestedAt = now().toISOString();
      await writeReviewRecord(input.root, path, {
        ...record,
        updatedAt: requestedAt,
        articleReview: {
          ...record.articleReview!,
          status: 'changes_requested',
          approvedBy: undefined,
          approvedAt: undefined,
          approvedContentSha256: undefined,
          publishingStartedAt: undefined,
          publishError: undefined,
          requestedBy: 'system-integrity-check',
          requestedAt,
          changeNotes: 'Article content changed after approval. Review and approve the updated article before publishing.',
        },
      });
      throw new Error('Article content changed after approval and requires Agent 7 reapproval');
      }
    }

    const attemptedAt = now().toISOString();
    const publishing: ContentBankRecord = {
      ...record,
      updatedAt: attemptedAt,
      articleReview: {
        ...record.articleReview!,
        status: 'publishing',
        publishingStartedAt: attemptedAt,
        publishAttemptedAt: attemptedAt,
        publishAttempts: (record.articleReview!.publishAttempts ?? 0) + 1,
        publishError: undefined,
      },
    };
    await writeReviewRecord(input.root, path, publishing);

    try {
      const result = await input.publish();
      if (result.failures.length) throw new Error('Agent 8 CMS publication failed');
      const publishedReceipt = await successfulReceipt(input.root, slug, publishing.articleReview!.approvedAt);
      if (!publishedReceipt) throw new Error('Agent 8 did not create a matching publication receipt');
      const published: ContentBankRecord = {
        ...publishing,
        updatedAt: publishedReceipt.publishedAt,
        articleReview: {
          ...publishing.articleReview!,
          status: 'published',
          publishError: undefined,
          cmsIdentifier: publishedReceipt.cmsIdentifier || slug,
          publishedAt: publishedReceipt.publishedAt,
          publishedUrl: publishedReceipt.liveUrl || liveUrl,
        },
      };
      await writeReviewRecord(input.root, path, published);
      return { id: record.id, slug, approvalRecorded, publishState: result.published > 0 ? 'published' : 'skipped', liveUrl, publishedAt: publishedReceipt.publishedAt };
    } catch (error) {
      const failedAt = now().toISOString();
      const safeError = safePublishError(error);
      const failed: ContentBankRecord = {
        ...publishing,
        updatedAt: failedAt,
        articleReview: {
          ...publishing.articleReview!,
          status: 'publish_failed',
          publishAttemptedAt: failedAt,
          publishError: safeError,
        },
      };
      await writeReviewRecord(input.root, path, failed);
      await writeJsonAtomic(safeDataPath(input.root, 'reports', 'website-cms-failed', `${slug}.json`), {
        version: 1,
        slug,
        approvedAt: failed.articleReview!.approvedAt,
        failedAt,
        reason: safeError,
      });
      throw new Error(safeError);
    }
  });
}

export async function autoPublishWebsiteArticle(input: {
  root: string;
  id: string;
  publish: () => Promise<WebsitePublishBatchResult>;
  websiteBaseUrl?: string;
  now?: () => Date;
}): Promise<ArticleApprovalPublishResult> {
  return approveAndPublishWebsiteArticle({
    ...input,
    approvedBy: 'Agent 7 automatic website release',
    automaticRelease: true,
  });
}

export async function unpublishWebsiteArticle(input: {
  root: string;
  id: string;
  unpublishedBy: string;
  unpublish: (slug: string) => Promise<{ removedAssets: number; revalidation: 'revalidated' | 'not_configured' | 'failed' }>;
  now?: Date;
}): Promise<{ id: string; slug: string; removedAssets: number }> {
  return withApprovalLock(input.root, async () => {
    const { path, record } = await findRecord(input.root, input.id);
    validateArticleReview(input.root, record);
    if (!['published', 'unpublished'].includes(record.articleReview!.status)) {
      throw new Error(`Cannot delete an article in ${record.articleReview!.status} state`);
    }
    const slug = await articleSlug(input.root, record);
    if (record.articleReview!.status === 'unpublished') return { id: record.id, slug, removedAssets: 0 };
    const result = await input.unpublish(slug);
    const unpublishedAt = (input.now ?? new Date()).toISOString();
    await unlink(safeDataPath(input.root, 'reports', 'website-cms-published', `${slug}.json`)).catch(() => undefined);
    await writeJsonAtomic(safeDataPath(input.root, 'reports', 'website-cms-unpublished', `${slug}.json`), {
      version: 1,
      slug,
      unpublishedAt,
      unpublishedBy: input.unpublishedBy,
      removedAssets: result.removedAssets,
      revalidation: result.revalidation,
    });
    await writeReviewRecord(input.root, path, {
      ...record,
      updatedAt: unpublishedAt,
      articleReview: {
        ...record.articleReview!,
        status: 'unpublished',
        unpublishedBy: input.unpublishedBy,
        unpublishedAt,
        cmsIdentifier: undefined,
        publishedAt: undefined,
        publishedUrl: undefined,
        publishError: undefined,
      },
    });
    return { id: record.id, slug, removedAssets: result.removedAssets };
  });
}

export async function requestWebsiteArticleChanges(input: {
  root: string;
  id: string;
  requestedBy: string;
  notes: string;
  now?: Date;
}): Promise<void> {
  await withApprovalLock(input.root, async () => {
    const { path, record } = await findRecord(input.root, input.id);
    validateArticleReview(input.root, record);
    if (!['pending_review', 'changes_requested', 'approved', 'publish_failed'].includes(record.articleReview!.status)) {
      throw new Error(`Cannot request changes from article state ${record.articleReview!.status}`);
    }
    const notes = input.notes.trim();
    if (notes.length < 5 || notes.length > 2000) throw new Error('Article change notes must be 5-2000 characters');
    const requestedAt = (input.now ?? new Date()).toISOString();
    await writeReviewRecord(input.root, path, {
      ...record,
      updatedAt: requestedAt,
      articleReview: {
        ...record.articleReview!,
        status: 'changes_requested',
        approvedBy: undefined,
        approvedAt: undefined,
        approvedContentSha256: undefined,
        publishingStartedAt: undefined,
        publishError: undefined,
        requestedBy: input.requestedBy,
        requestedAt,
        changeNotes: notes,
      },
    });
  });
}
