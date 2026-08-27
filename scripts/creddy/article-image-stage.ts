import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';

import { listJsonFiles, readJson, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import type { CreddyArticleVisualAsset, VisualPlanRecord } from './pipeline-types.js';

export const CODEX_ARTICLE_IMAGE_REQUEST_VERSION = 'creddy-codex-image-request-v1' as const;
export const CODEX_ARTICLE_IMAGE_RESULT_VERSION = 'creddy-codex-image-result-v1' as const;

export type CodexArticleImageRequestAsset = {
  assetId: string;
  promptFingerprint: string;
  prompt: string;
};

export type CodexArticleImageRequest = {
  version: typeof CODEX_ARTICLE_IMAGE_REQUEST_VERSION;
  provider: 'codex-imagegen';
  visualPlanId: string;
  stagingDirectory: string;
  assets: CodexArticleImageRequestAsset[];
};

export type CodexArticleImageResultManifest = {
  version: typeof CODEX_ARTICLE_IMAGE_RESULT_VERSION;
  provider: 'codex-imagegen';
  visualPlanId: string;
  asset: {
    assetId: string;
    promptFingerprint: string;
    sourcePath: string;
  };
};

export type CodexArticleImageRequestResult = {
  plans: number;
  requested: number;
  skipped: number;
  outputPaths: string[];
};

export type CodexArticleImageImportResult = {
  visualPlanId: string;
  assetId: string;
  accepted: number;
  skipped: number;
  outputPaths: string[];
};

function safeAssetId(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{1,99}$/.test(value)) throw new Error('Article visual ID must be a safe slug');
  return value;
}

export function inspectCreddyArticleImage(bytes: Uint8Array): {
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
} {
  if (bytes.byteLength < 10_000 || bytes.byteLength > 20 * 1024 * 1024) {
    throw new Error('Generated article image must be between 10 KB and 20 MB');
  }
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const png = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  if (png) {
    if (buffer.byteLength < 24 || buffer.toString('ascii', 12, 16) !== 'IHDR') {
      throw new Error('Generated PNG is missing a valid IHDR header');
    }
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (!width || !height) throw new Error('Generated PNG has invalid dimensions');
    return { mimeType: 'image/png', width, height };
  }

  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (jpeg) {
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 8 < buffer.byteLength) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (buffer[offset] === 0xff) offset += 1;
      const marker = buffer[offset++];
      if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > buffer.byteLength) break;
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.byteLength) break;
      if (startOfFrame.has(marker)) {
        if (length < 7) break;
        const height = buffer.readUInt16BE(offset + 3);
        const width = buffer.readUInt16BE(offset + 5);
        if (!width || !height) throw new Error('Generated JPEG has invalid dimensions');
        return { mimeType: 'image/jpeg', width, height };
      }
      offset += length;
    }
    throw new Error('Generated JPEG is missing readable dimensions');
  }
  throw new Error('Generated article image must be a real PNG or JPEG file');
}

export function codexArticleImagePrompt(asset: CreddyArticleVisualAsset): string {
  if (asset.generationMode !== 'generate' || !asset.prompt || !asset.negativePrompt || !asset.seriesStyle) {
    throw new Error('Codex receives only validated generated article assets');
  }
  return [
    'Use case: stylized-concept',
    'Asset type: responsive 16:9 image for a premium consumer-finance editorial article',
    `Primary request: ${asset.prompt}`,
    `Style/medium: ${asset.seriesStyle}`,
    `Composition/framing: ${asset.aspectRatio} ${asset.usage} composition; keep the important subject inside the central 78% safe area`,
    'Text: none',
    'Constraints: generate only clean standalone artwork; preserve the approved series style; no website frame or presentation chrome',
    `Avoid: ${asset.negativePrompt}; cream gallery mat; coin cluster; travel route; card outline; starburst; words; badges; typography; watermarks`,
  ].join('\n');
}

export function codexArticleImageFingerprint(visualPlanId: string, asset: CreddyArticleVisualAsset): string {
  return createHash('sha256').update(JSON.stringify({
    version: CODEX_ARTICLE_IMAGE_REQUEST_VERSION,
    visualPlanId,
    assetId: asset.id,
    usage: asset.usage,
    articleBlockId: asset.articleBlockId,
    assetType: asset.assetType,
    aspectRatio: asset.aspectRatio,
    seriesStyle: asset.seriesStyle,
    prompt: asset.prompt,
    negativePrompt: asset.negativePrompt,
  })).digest('hex');
}

function assertCodexEligibleAsset(asset: CreddyArticleVisualAsset): void {
  safeAssetId(asset.id);
  if (asset.generationMode !== 'generate') throw new Error(`Visual ${asset.id} is not approved for generation`);
  if (asset.aspectRatio !== '16:9') throw new Error(`Generated visual ${asset.id} must use the approved 16:9 contract`);
  codexArticleImagePrompt(asset);
}

export async function prepareCodexArticleImageRequests(root: string): Promise<CodexArticleImageRequestResult> {
  const result: CodexArticleImageRequestResult = { plans: 0, requested: 0, skipped: 0, outputPaths: [] };
  for (const path of await listJsonFiles(safeDataPath(root, '06-visual-plans'))) {
    const plan = await readJson<VisualPlanRecord>(path);
    if (!plan.articleVisuals) continue;
    const generated = plan.articleVisuals.assets.filter((asset) => asset.generationMode === 'generate');
    if (!generated.length) continue;
    result.plans += 1;
    if (plan.articleVisuals.imageBlockStyle !== 'creddy-abstract-editorial-v1') {
      throw new Error(`Visual plan ${plan.id} must use creddy-abstract-editorial-v1 before Codex image generation`);
    }
    const pending = generated.filter((asset) => !asset.assetPath);
    result.skipped += generated.length - pending.length;
    if (!pending.length) continue;
    for (const asset of pending) assertCodexEligibleAsset(asset);
    const request: CodexArticleImageRequest = {
      version: CODEX_ARTICLE_IMAGE_REQUEST_VERSION,
      provider: 'codex-imagegen',
      visualPlanId: plan.id,
      stagingDirectory: safeDataPath(root, '06-content-packages', 'images', 'codex-staging', safeAssetId(plan.id)),
      assets: pending.map((asset) => ({
        assetId: asset.id,
        promptFingerprint: codexArticleImageFingerprint(plan.id, asset),
        prompt: codexArticleImagePrompt(asset),
      })),
    };
    const output = safeDataPath(root, '06-visual-plans', 'codex-image-requests', `${safeAssetId(plan.id)}.json`);
    await writeJsonAtomic(output, request);
    result.requested += request.assets.length;
    result.outputPaths.push(output);
  }
  return result;
}

export async function importCodexArticleImage(
  root: string,
  manifest: CodexArticleImageResultManifest,
): Promise<CodexArticleImageImportResult> {
  if (manifest.version !== CODEX_ARTICLE_IMAGE_RESULT_VERSION || manifest.provider !== 'codex-imagegen') {
    throw new Error('Invalid Codex article image result manifest');
  }
  const visualPlanId = safeAssetId(manifest.visualPlanId);
  const assetId = safeAssetId(manifest.asset?.assetId ?? '');
  const planPath = safeDataPath(root, '06-visual-plans', `${visualPlanId}.json`);
  const plan = await readJson<VisualPlanRecord>(planPath);
  const asset = plan.articleVisuals?.assets.find((candidate) => candidate.id === assetId);
  if (!asset) throw new Error(`Codex result references unknown visual ${assetId}`);
  assertCodexEligibleAsset(asset);
  const expectedFingerprint = codexArticleImageFingerprint(plan.id, asset);
  if (manifest.asset.promptFingerprint !== expectedFingerprint) {
    throw new Error(`Codex result prompt fingerprint does not match approved visual ${assetId}`);
  }
  if (asset.assetPath) {
    return { visualPlanId, assetId, accepted: 0, skipped: 1, outputPaths: [asset.assetPath] };
  }
  if (!isAbsolute(manifest.asset.sourcePath)) throw new Error('Codex result sourcePath must be absolute');
  const bytes = await readFile(manifest.asset.sourcePath);
  const metadata = inspectCreddyArticleImage(bytes);
  if (metadata.width * 9 !== metadata.height * 16) {
    throw new Error(`Codex image ${assetId} must be exact 16:9; received ${metadata.width}x${metadata.height}`);
  }
  const extension = metadata.mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const output = safeDataPath(
    root,
    '06-content-packages',
    'images',
    'articles',
    visualPlanId,
    `${assetId}.${extension}`,
  );
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes, { flag: 'wx' });
  asset.assetPath = output;
  asset.provenance = `Generated with signed-in Codex imagegen from approved Agent 05 prompt ${expectedFingerprint.slice(0, 16)} at ${new Date().toISOString()}`;
  await writeJsonAtomic(planPath, plan);
  return { visualPlanId, assetId, accepted: 1, skipped: 0, outputPaths: [output] };
}
