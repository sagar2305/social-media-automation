import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { listJsonFiles, readJson, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import type { CreddyArticleVisualAsset, VisualPlanRecord } from './pipeline-types.js';

export interface ArticleImageApi {
  generate(asset: CreddyArticleVisualAsset): Promise<{ bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg'; provenance: string }>;
}

export type ArticleImageGenerationResult = {
  plans: number;
  requested: number;
  generated: number;
  skipped: number;
  failures: Array<{ visualPlanId: string; assetId: string; error: string }>;
  outputPaths: string[];
};

function safeAssetId(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{1,99}$/.test(value)) throw new Error('Article visual ID must be a safe slug');
  return value;
}

function verifyImage(bytes: Uint8Array, mimeType: string): void {
  if (bytes.byteLength < 10_000 || bytes.byteLength > 20 * 1024 * 1024) {
    throw new Error('Generated article image must be between 10 KB and 20 MB');
  }
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if ((mimeType === 'image/png' && !png) || (mimeType === 'image/jpeg' && !jpeg)) {
    throw new Error('Image response does not match its declared MIME type');
  }
}

export class GeminiArticleImageClient implements ArticleImageApi {
  constructor(private readonly apiKey: string) {
    if (!apiKey.trim()) throw new Error('GEMINI_API_KEY is required for generated article visuals');
  }

  async generate(asset: CreddyArticleVisualAsset): Promise<{ bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg'; provenance: string }> {
    if (asset.generationMode !== 'generate' || !asset.prompt || !asset.negativePrompt) {
      throw new Error('Gemini receives only validated generated article assets');
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const prompt = `Series-wide art direction (keep identical across every image in this article): ${asset.seriesStyle}\n\nSection-specific composition: ${asset.prompt}\n\nComposition: ${asset.aspectRatio} ${asset.usage} image for a premium consumer-finance editorial article. Keep the important subject inside the central 78% safe area for the approved Creddy website frame. Generate only the clean image artwork: do not add the cream gallery mat, coin cluster, travel route, card outline, starburst, words, badges, or typography because the website renderer adds that presentation automatically.\n\nAvoid: ${asset.negativePrompt}`;
    let lastError = 'Image generation failed';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
        }),
      });
      if (response.status === 429 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
        continue;
      }
      if (!response.ok) {
        lastError = `Gemini image generation returned HTTP ${response.status}`;
        if (attempt < 3 && response.status >= 500) continue;
        throw new Error(lastError);
      }
      const body = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>;
      };
      const inline = body.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
      if (!inline?.data) throw new Error('Gemini returned no image data');
      const mimeType = inline.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
      return {
        bytes: Buffer.from(inline.data, 'base64'),
        mimeType,
        provenance: `Generated with gemini-2.5-flash-image from approved Agent 05 prompt at ${new Date().toISOString()}`,
      };
    }
    throw new Error(lastError);
  }
}

export async function generatePendingArticleImages(
  root: string,
  client: ArticleImageApi,
): Promise<ArticleImageGenerationResult> {
  const result: ArticleImageGenerationResult = {
    plans: 0, requested: 0, generated: 0, skipped: 0, failures: [], outputPaths: [],
  };
  for (const path of await listJsonFiles(safeDataPath(root, '06-visual-plans'))) {
    const plan = await readJson<VisualPlanRecord>(path);
    if (!plan.articleVisuals) continue;
    result.plans += 1;
    let changed = false;
    for (const asset of plan.articleVisuals.assets) {
      if (asset.generationMode !== 'generate' || asset.assetPath) {
        result.skipped += 1;
        continue;
      }
      result.requested += 1;
      try {
        const generated = await client.generate(asset);
        verifyImage(generated.bytes, generated.mimeType);
        const extension = generated.mimeType === 'image/jpeg' ? 'jpg' : 'png';
        const output = safeDataPath(
          root,
          '06-content-packages',
          'images',
          'articles',
          safeAssetId(plan.id),
          `${safeAssetId(asset.id)}.${extension}`,
        );
        await mkdir(dirname(output), { recursive: true });
        await writeFile(output, generated.bytes, { flag: 'wx' });
        asset.assetPath = output;
        asset.provenance = generated.provenance;
        result.generated += 1;
        result.outputPaths.push(output);
        changed = true;
      } catch (error) {
        result.failures.push({ visualPlanId: plan.id, assetId: asset.id, error: (error as Error).message });
      }
    }
    if (changed) await writeJsonAtomic(path, plan);
  }
  return result;
}
