import { access, readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { CREDDY_ARTICLE_IMAGE_BLOCK, CREDDY_ARTICLE_THEME, validateCreddyArticle, validateCreddyArticleVisuals } from './article-content.js';
import { listJsonFiles, pathExists, readJson, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import type {
  ContentBankRecord,
  ContentDraftRecord,
  ContentPackageRecord,
  CreddyArticleDraft,
  CreddyArticleVisualAsset,
  CreddyArticleVisualPlan,
} from './pipeline-types.js';
import { computeArticleApprovalFingerprint } from './article-approval-integrity.js';
import { assertArticleVerificationPublishable, assertBankVerificationIntegrity } from './publication-policy.js';

type ReferralRegistry = {
  version: 1;
  links: Array<{ id: string; url: string; active: boolean; disclosure: string }>;
};

export type CreddyWebsiteExportResult = {
  reviewed: number;
  exported: number;
  skipped: number;
  blockers: Array<{ id: string; reason: string }>;
  outputPaths: string[];
};

export const CREDDY_WEBSITE_EXPORT_VERSION = 'creddy-website-export-v2' as const;

export type CreddyWebsiteExportPayload = {
  version: typeof CREDDY_WEBSITE_EXPORT_VERSION;
  contentBankId: string;
  approvedBy: string;
  approvedAt: string;
  route: string;
  design: {
    version: CreddyArticleDraft['designVersion'];
    tokens: typeof CREDDY_ARTICLE_THEME;
    articleImageBlock: typeof CREDDY_ARTICLE_IMAGE_BLOCK;
  };
  article: CreddyArticleDraft;
  visuals: Omit<CreddyArticleVisualPlan, 'assets'> & {
    assets: Array<CreddyArticleVisualAsset & { assetPath: string; sourceAssetPath: string }>;
  };
  referrals: Array<ReferralRegistry['links'][number]>;
  previewPath: string;
  publishState: 'ready_for_getcreddy_integration';
};

export function creddyWebsiteArticleRoute(slug: string): string {
  return `/blog/${slug}`;
}

export function creddyWebsiteAssetPath(slug: string, assetId: string, sourcePath: string): string {
  const safeAssetId = assetId.replace(/[^a-zA-Z0-9_-]+/g, '-');
  return `/blogs/${slug}/${encodeURIComponent(`${safeAssetId}-${basename(sourcePath)}`)}`;
}

async function articleSource(root: string, bank: ContentBankRecord): Promise<{
  article: CreddyArticleDraft;
  visuals: CreddyArticleVisualPlan;
  sourceUrls: string[];
  factualClaims: ContentDraftRecord['factualClaims'];
}> {
  if (bank.contentDraftId) {
    const draft = await readJson<ContentDraftRecord>(
      safeDataPath(root, '06-content-drafts', `${bank.contentDraftId}.json`),
    );
    if (!draft.article || !bank.visualPlanId) throw new Error('Unified draft has no website article or visual plan');
    const visual = await readJson<{ articleVisuals?: CreddyArticleVisualPlan }>(
      safeDataPath(root, '06-visual-plans', `${bank.visualPlanId}.json`),
    );
    if (!visual.articleVisuals) throw new Error('Unified visual plan has no website visuals');
    return { article: draft.article, visuals: visual.articleVisuals, sourceUrls: draft.sourceUrls, factualClaims: draft.factualClaims };
  }
  const content = await readJson<ContentPackageRecord>(
    safeDataPath(root, '06-content-packages', `${bank.contentPackageId}.json`),
  );
  if (!content.article || !content.articleVisuals) throw new Error('Production package has no website article');
  return { article: content.article, visuals: content.articleVisuals, sourceUrls: content.sourceUrls, factualClaims: content.factualClaims };
}

async function referralRegistry(path: string | undefined): Promise<Map<string, ReferralRegistry['links'][number]>> {
  if (!path?.trim()) return new Map();
  const registry = JSON.parse(await readFile(path, 'utf8')) as ReferralRegistry;
  if (registry.version !== 1 || !Array.isArray(registry.links)) throw new Error('Invalid referral registry');
  return new Map(registry.links.filter((link) => link.active).map((link) => [link.id, link]));
}

export async function exportApprovedWebsiteArticles(
  root: string,
  options: { referralRegistryPath?: string } = {},
): Promise<CreddyWebsiteExportResult> {
  const result: CreddyWebsiteExportResult = { reviewed: 0, exported: 0, skipped: 0, blockers: [], outputPaths: [] };
  const registry = await referralRegistry(options.referralRegistryPath);
  const records = await Promise.all(
    (await listJsonFiles(safeDataPath(root, '09-pending-approval'))).map((path) => readJson<ContentBankRecord>(path)),
  );
  for (const bank of records) {
    if (!bank.articleReview) continue;
    result.reviewed += 1;
    if (!['approved', 'publishing'].includes(bank.articleReview.status)) {
      result.skipped += 1;
      continue;
    }
    try {
      await assertBankVerificationIntegrity(root, bank);
      assertArticleVerificationPublishable(bank.verificationGate);
      if (!bank.articleReview.approvedBy?.trim() || !bank.articleReview.approvedAt?.trim()) {
        throw new Error('Approved article is missing Agent 7 approval identity or timestamp');
      }
      if (!bank.articleReview.approvedContentSha256?.trim()) {
        throw new Error('Approved article is missing its content approval fingerprint');
      }
      const currentFingerprint = await computeArticleApprovalFingerprint(root, bank);
      if (currentFingerprint !== bank.articleReview.approvedContentSha256) {
        throw new Error('Article content changed after approval and requires Agent 7 reapproval');
      }
      if (!bank.articlePreviewPath || !(await pathExists(bank.articlePreviewPath))) {
        throw new Error('Approved article preview is missing');
      }
      const source = await articleSource(root, bank);
      validateCreddyArticle(source.article, source.factualClaims, source.sourceUrls);
      validateCreddyArticleVisuals(source.visuals, source.article, source.factualClaims);
      for (const asset of source.visuals.assets) {
        if (!asset.assetPath) throw new Error(`Article visual ${asset.id} has no approved asset file`);
        await access(asset.assetPath);
      }
      const referralIds = source.article.blocks
        .filter((block) => block.type === 'referral_card')
        .map((block) => block.referralId);
      const unresolved = referralIds.filter((id) => !registry.has(id));
      if (unresolved.length) throw new Error(`Referral registry is missing active IDs: ${unresolved.join(', ')}`);
      const payload: CreddyWebsiteExportPayload = {
        version: CREDDY_WEBSITE_EXPORT_VERSION,
        contentBankId: bank.id,
        approvedBy: bank.articleReview.approvedBy,
        approvedAt: bank.articleReview.approvedAt,
        route: creddyWebsiteArticleRoute(source.article.slug),
        design: {
          version: source.article.designVersion,
          tokens: CREDDY_ARTICLE_THEME,
          articleImageBlock: CREDDY_ARTICLE_IMAGE_BLOCK,
        },
        article: source.article,
        visuals: {
          ...source.visuals,
          assets: source.visuals.assets.map((asset) => {
            const sourceAssetPath = asset.assetPath;
            if (!sourceAssetPath) throw new Error(`Article visual ${asset.id} has no approved asset file`);
            return {
              ...asset,
              sourceAssetPath,
              assetPath: creddyWebsiteAssetPath(source.article.slug, asset.id, sourceAssetPath),
            };
          }),
        },
        referrals: referralIds.map((id) => registry.get(id)!),
        previewPath: bank.articlePreviewPath,
        publishState: 'ready_for_getcreddy_integration',
      };
      const output = safeDataPath(root, '14-website-ready', `${source.article.slug}.json`);
      await writeJsonAtomic(output, payload);
      result.exported += 1;
      result.outputPaths.push(output);
    } catch (error) {
      result.blockers.push({ id: bank.id, reason: (error as Error).message });
    }
  }
  return result;
}
