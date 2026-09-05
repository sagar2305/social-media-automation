import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CODEX_ARTICLE_IMAGE_RESULT_VERSION,
  codexArticleImageFingerprint,
  importCodexArticleImage,
  prepareCodexArticleImageRequests,
  type CodexArticleImageRequest,
} from './article-image-stage.js';
import { initializeCreddyDataRoot, readJson, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import { CREDDY_PIPELINE_VERSION, type VisualPlanRecord } from './pipeline-types.js';

function articlePlan(): VisualPlanRecord {
  return {
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
}

function pngFixture(width: number, height: number): Uint8Array {
  const bytes = Buffer.alloc(12_000);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

test('Agent 6 writes durable Codex image requests from approved Agent 5 prompts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-codex-image-requests-'));
  await initializeCreddyDataRoot(root);
  const plan = articlePlan();
  await writeJsonAtomic(safeDataPath(root, '06-visual-plans', `${plan.id}.json`), plan);

  const result = await prepareCodexArticleImageRequests(root);
  assert.equal(result.requested, 1);
  const request = await readJson<CodexArticleImageRequest>(result.outputPaths[0]!);
  assert.equal(request.provider, 'codex-imagegen');
  assert.equal(request.assets[0]!.assetId, 'hero-benefit');
  assert.equal(request.assets[0]!.promptFingerprint, codexArticleImageFingerprint(plan.id, plan.articleVisuals!.assets[0]!));
  assert.match(request.assets[0]!.prompt, /Use case: editorial illustration/);
  assert.match(request.assets[0]!.prompt, /artificial 3D rendering/);
  assert.match(request.assets[0]!.prompt, /Text: none/);
  assert.doesNotMatch(request.assets[0]!.prompt, /Gemini/i);
});

test('Agent 6 accepts each signed-in Codex image once and records validated provenance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-codex-image-import-'));
  await initializeCreddyDataRoot(root);
  const plan = articlePlan();
  const planPath = safeDataPath(root, '06-visual-plans', `${plan.id}.json`);
  await writeJsonAtomic(planPath, plan);
  const sourcePath = join(root, 'codex-hero.png');
  await writeFile(sourcePath, pngFixture(1600, 900));
  const manifest = {
    version: CODEX_ARTICLE_IMAGE_RESULT_VERSION,
    provider: 'codex-imagegen' as const,
    visualPlanId: plan.id,
    asset: {
      assetId: 'hero-benefit',
      promptFingerprint: codexArticleImageFingerprint(plan.id, plan.articleVisuals!.assets[0]!),
      sourcePath,
    },
  };

  const first = await importCodexArticleImage(root, manifest);
  assert.equal(first.accepted, 1);
  const updated = await readJson<VisualPlanRecord>(planPath);
  const output = updated.articleVisuals!.assets[0]!.assetPath!;
  assert.equal((await readFile(output)).byteLength, 12_000);
  assert.match(updated.articleVisuals!.assets[0]!.provenance!, /signed-in Codex imagegen/);

  const second = await importCodexArticleImage(root, manifest);
  assert.equal(second.accepted, 0);
  assert.equal(second.skipped, 1);
});

test('Agent 6 rejects Codex images that are not exact 16:9', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-codex-image-ratio-'));
  await initializeCreddyDataRoot(root);
  const plan = articlePlan();
  await writeJsonAtomic(safeDataPath(root, '06-visual-plans', `${plan.id}.json`), plan);
  const sourcePath = join(root, 'codex-hero.png');
  await writeFile(sourcePath, pngFixture(1200, 900));

  await assert.rejects(
    importCodexArticleImage(root, {
      version: CODEX_ARTICLE_IMAGE_RESULT_VERSION,
      provider: 'codex-imagegen',
      visualPlanId: plan.id,
      asset: {
        assetId: 'hero-benefit',
        promptFingerprint: codexArticleImageFingerprint(plan.id, plan.articleVisuals!.assets[0]!),
        sourcePath,
      },
    }),
    /must be exact 16:9/,
  );
});
