import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJsonAtomic, safeDataPath } from './pipeline-store.js';
import { computeArticleApprovalFingerprint } from './article-approval-integrity.js';
import { articleSeoContentSha256 } from './article-seo-review.js';
import type { ContentBankRecord, CreddyArticleDraft, CreddyArticleVisualPlan } from './pipeline-types.js';

import {
  CREDDY_WEBSITE_EXPORT_VERSION,
  creddyWebsiteArticleRoute,
  creddyWebsiteAssetPath,
  articleSource,
} from './website-stage.js';

describe('Creddy website export v2 paths', () => {
  it('routes approved articles to the native blogs surface', () => {
    assert.equal(CREDDY_WEBSITE_EXPORT_VERSION, 'creddy-website-export-v2');
    assert.equal(creddyWebsiteArticleRoute('card-benefit-update'), '/blog/card-benefit-update');
  });

  it('maps local source assets to a deployable blog path', () => {
    assert.equal(
      creddyWebsiteAssetPath('card-benefit-update', 'hero:1', '/private/data/hero image.png'),
      '/blogs/card-benefit-update/hero-1-hero%20image.png',
    );
  });
});

describe('production article release source', () => {
  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'creddy-release-source-'));
    const bank = { contentPackageId: 'production-story', contentDraftId: 'copy-story', visualPlanId: 'visual-story',
      articlePreviewPath: safeDataPath(root, 'preview.json') } as ContentBankRecord;
    const article = { id: 'article-story', blocks: [{ id: 'hero-block', type: 'visual', caption: 'Draft narrative caption.' }] } as CreddyArticleDraft;
    const visuals = { version: 'creddy-article-visuals-v1', designVersion: 'creddy-guides-v1', assets: [] } as CreddyArticleVisualPlan;
    const productionArticle = structuredClone(article);
    productionArticle.blocks[0] = { id: 'hero-block', type: 'visual', visualId: 'hero', caption: 'Authentic brand imagery. Editorial illustration.' };
    const content = { id: bank.contentPackageId, contentDraftId: bank.contentDraftId, visualPlanId: bank.visualPlanId,
      article: productionArticle, articleVisuals: visuals, sourceUrls: [], factualClaims: [] };
    await writeJsonAtomic(bank.articlePreviewPath!, { caption: 'Authentic brand imagery. Editorial illustration.' });
    await writeJsonAtomic(safeDataPath(root, '06-content-drafts', 'copy-story.json'), { article, sourceUrls: [], factualClaims: [] });
    await writeJsonAtomic(safeDataPath(root, '06-visual-plans', 'visual-story.json'), { articleVisuals: visuals });
    return { root, bank, article, visuals, content, packagePath: safeDataPath(root, '06-content-packages', 'production-story.json') };
  }

  it('exports the composed article Agent 07 reviewed, so the prepublish SEO hash matches', async () => {
    const f = await fixture();
    await writeJsonAtomic(f.packagePath, f.content);
    const source = await articleSource(f.root, f.bank);
    assert.deepEqual(source.article, f.content.article);
    assert.equal(articleSeoContentSha256(source.article, source.visuals), articleSeoContentSha256(f.content.article, f.content.articleVisuals));
    assert.notEqual(articleSeoContentSha256(source.article, source.visuals), articleSeoContentSha256(f.article, f.visuals));
    const approved = await computeArticleApprovalFingerprint(f.root, f.bank);
    await writeJsonAtomic(f.packagePath, { ...f.content, article: { ...f.content.article, title: 'Changed production' } });
    assert.notEqual(await computeArticleApprovalFingerprint(f.root, f.bank), approved);
    await writeJsonAtomic(f.packagePath, f.content);
    await writeJsonAtomic(safeDataPath(f.root, '06-content-drafts', 'copy-story.json'), { article: { ...f.article, title: 'Changed draft' } });
    assert.notEqual(await computeArticleApprovalFingerprint(f.root, f.bank), approved, 'draft changes still invalidate approval');
  });

  it('never falls back to an earlier draft for a missing or mismatched production package', async () => {
    const f = await fixture();
    await assert.rejects(articleSource(f.root, f.bank), /ENOENT/);
    await writeJsonAtomic(f.packagePath, { ...f.content, id: 'production-other' });
    await assert.rejects(articleSource(f.root, f.bank), /identity/);
    await writeJsonAtomic(f.packagePath, { ...f.content, contentDraftId: 'copy-other' });
    await assert.rejects(articleSource(f.root, f.bank), /identity/);
    await writeJsonAtomic(f.packagePath, { ...f.content, articleVisuals: undefined });
    await assert.rejects(articleSource(f.root, f.bank), /no website article/);
  });
});
