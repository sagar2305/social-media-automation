import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { generatePendingArticleImages, type ArticleImageApi } from './article-image-stage.js';
import { initializeCreddyDataRoot, readJson, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import { CREDDY_PIPELINE_VERSION, type VisualPlanRecord } from './pipeline-types.js';

test('Agent 6 generates each missing approved article image once and records provenance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-article-images-'));
  await initializeCreddyDataRoot(root);
  const plan: VisualPlanRecord = {
    version: CREDDY_PIPELINE_VERSION,
    id: 'visual-copy-analysis-1',
    contentDraftId: 'copy-analysis-1',
    analysisId: 'analysis-1',
    canonicalId: 'canonical-1',
    createdAt: '2026-08-25T00:00:00.000Z',
    format: '3:4', theme: 'editorial', characterPack: 'credit-card-rewards/creddy', phoneTemplateId: 'app_store_dark',
    cover: { headline: 'A useful hook', subheadline: 'Useful support' },
    scenes: [], visualBrief: 'Test', safetyOverlays: [], sourceUrls: ['https://example.com'], factualClaims: [],
    articleVisuals: {
      version: 'creddy-article-visuals-v1', designVersion: 'creddy-guides-v1', imageBlockStyle: 'creddy-abstract-editorial-v1',
      assets: [{
        id: 'hero-benefit', usage: 'hero', articleBlockId: 'hero', assetType: 'editorial_illustration', aspectRatio: '16:9', generationMode: 'generate',
        seriesStyle: 'Premium tactile editorial still-life series with warm cream surfaces, restrained brushed gold accents, soft left-side window light, natural 50mm perspective, subtle grain, and realistic imperfections.',
        prompt: 'Premium editorial still life with warm cream paper, restrained gold accents, believable window light, tactile details, subtle depth, and generous negative space.',
        negativePrompt: 'No text, no logos, no watermarks, no people.', altText: 'Warm editorial planning surface', caption: 'Benefit planning visual.', claimFields: [],
      }],
    },
  };
  const path = safeDataPath(root, '06-visual-plans', `${plan.id}.json`);
  await writeJsonAtomic(path, plan);
  let calls = 0;
  const client: ArticleImageApi = {
    async generate() {
      calls += 1;
      const bytes = new Uint8Array(12_000);
      bytes.set([0x89, 0x50, 0x4e, 0x47]);
      return { bytes, mimeType: 'image/png', provenance: 'test approved generator' };
    },
  };

  const first = await generatePendingArticleImages(root, client);
  assert.equal(first.generated, 1);
  assert.equal(calls, 1);
  const updated = await readJson<VisualPlanRecord>(path);
  const output = updated.articleVisuals!.assets[0]!.assetPath!;
  assert.equal((await readFile(output)).byteLength, 12_000);
  assert.equal(updated.articleVisuals!.assets[0]!.provenance, 'test approved generator');

  const second = await generatePendingArticleImages(root, client);
  assert.equal(second.generated, 0);
  assert.equal(calls, 1);
});
