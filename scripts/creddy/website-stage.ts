import { access, readFile } from 'node:fs/promises';

import { CREDDY_ARTICLE_THEME, validateCreddyArticle, validateCreddyArticleVisuals } from './article-content.js';
import { listJsonFiles, pathExists, readJson, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import type {
  ContentBankRecord,
  ContentDraftRecord,
  ContentPackageRecord,
  CreddyArticleDraft,
  CreddyArticleVisualPlan,
} from './pipeline-types.js';

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
    if (bank.articleReview.status !== 'approved') {
      result.skipped += 1;
      continue;
    }
    try {
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
      const payload = {
        version: 'creddy-website-export-v1',
        contentBankId: bank.id,
        approvedBy: bank.articleReview.approvedBy,
        approvedAt: bank.articleReview.approvedAt,
        route: `/guides/${source.article.slug}`,
        design: { version: source.article.designVersion, tokens: CREDDY_ARTICLE_THEME },
        article: source.article,
        visuals: source.visuals,
        referrals: referralIds.map((id) => registry.get(id)),
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
