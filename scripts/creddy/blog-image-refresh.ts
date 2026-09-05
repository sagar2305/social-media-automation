import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SupabaseClient } from '@supabase/supabase-js';

import { safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import type { CreddyBlogCmsRow } from './website-cms-stage.js';
import type { WebsiteRegistryPayload } from './website-sync-stage.js';
import { composeEditorialPhoto, resolveEditorialPhoto, validatePhotoCredit, type EditorialPhotoCredit } from './editorial-photos.js';

export type BlogVisualReplacement = {
  id: string;
  assetPath: string;
  altText: string;
  caption: string;
  provenance: string;
  photoAssetId?: string;
  photoCredit?: EditorialPhotoCredit;
};

/** Run before upload: a reviewed plan cannot change photo bytes, identity or credit. */
export async function validatePhotoRefreshPreview(image: Omit<BlogVisualReplacement, 'assetPath'> & { path: string; sha256: string }, root: string): Promise<void> {
  if (!image.photoAssetId) throw new Error('Reviewed photo ID is required');
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const photo = await composeEditorialPhoto({ root, photoId: image.photoAssetId, usage: 'hero' });
  if (hash(await readFile(image.path)) !== image.sha256 || hash(await readFile(photo.assetPath)) !== image.sha256
      || image.altText !== photo.altText || image.caption !== photo.caption || image.provenance !== photo.provenanceText
      || JSON.stringify(image.photoCredit) !== JSON.stringify(photo.photoCredit)) {
    throw new Error('Photo plan no longer matches the reviewed registry composition');
  }
}

/** Replace image metadata only; retain all article copy, dates and design fields. */
export function replaceBlogVisuals(
  content: WebsiteRegistryPayload,
  replacements: readonly BlogVisualReplacement[],
): WebsiteRegistryPayload {
  const ids = new Set(content.visuals.assets.map((asset) => asset.id));
  const heroOnly = replacements.length === 1 && !!replacements[0]?.photoAssetId;
  if (replacements.some(item => item.photoAssetId) && !heroOnly) throw new Error('Photo refresh changes only one hero');
  if (content.visuals.assets.length !== 3 || ids.size !== 3 || (!heroOnly && replacements.length !== 3)) {
    throw new Error('Blog image refresh requires exactly three existing and replacement images');
  }
  const byId = new Map<string, BlogVisualReplacement>();
  for (const replacement of replacements) {
    if (!ids.has(replacement.id) || byId.has(replacement.id)) {
      throw new Error('Blog image replacements must cover each existing image ID exactly once');
    }
    if (replacement.photoAssetId) {
      const asset = content.visuals.assets.find(asset => asset.id === replacement.id)!;
      if (asset.id !== content.article.heroVisualId || asset.usage !== 'hero'
          || !content.article.blocks.some(block => block.type === 'visual' && block.visualId === asset.id)) {
        throw new Error('Photo refresh requires the rendered article hero');
      }
      validatePhotoCredit(replacement.photoCredit!);
    } else if (replacement.photoCredit) {
      throw new Error('Photo credit requires a reviewed photo ID');
    }
    let url: URL;
    try { url = new URL(replacement.assetPath); } catch { throw new Error('Blog image replacement requires a public HTTPS asset URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('Blog image replacement requires a public HTTPS asset URL without credentials or query parameters');
    }
    if (![replacement.altText, replacement.caption, replacement.provenance].every((value) => typeof value === 'string' && value.trim())) {
      throw new Error('Blog image replacement requires alt text, caption and provenance');
    }
    byId.set(replacement.id, replacement);
  }
  const updated = structuredClone(content);
  updated.visuals.assets = updated.visuals.assets.map((asset) => {
    const replacement = byId.get(asset.id);
    if (!replacement) return asset;
    return {
      ...asset,
      generationMode: 'compose',
      assetType: replacement.photoAssetId ? 'licensed_photo' : 'editorial_illustration',
      photoAssetId: replacement.photoAssetId,
      photoCredit: replacement.photoCredit,
      brandAssetIds: undefined,
      prompt: undefined,
      negativePrompt: undefined,
      seriesStyle: undefined,
      assetPath: replacement.assetPath,
      altText: replacement.altText,
      caption: replacement.caption,
      provenance: replacement.provenance,
    };
  });
  updated.article.blocks = updated.article.blocks.map((block) => block.type === 'visual' && byId.has(block.visualId)
    ? { ...block, caption: byId.get(block.visualId)!.caption }
    : block);
  return updated;
}

export type BlogImageRefreshResult = {
  slug: string;
  status: 'updated' | 'retry' | 'noop';
  reason?: 'read_failed' | 'not_published' | 'content_changed' | 'update_failed';
  contentSha256?: string;
  preimagePath?: string;
  manifestPath?: string;
};

/** The caller owns asset upload and cache revalidation. Old assets are never deleted. */
export async function refreshPublishedBlogImages(input: {
  client: SupabaseClient;
  slug: string;
  expectedHash: string;
  replacements: readonly BlogVisualReplacement[];
  root: string;
}): Promise<BlogImageRefreshResult> {
  const { client, slug, expectedHash, replacements, root } = input;
  for (const replacement of replacements) {
    if (!replacement.photoAssetId) continue;
    const { entry } = await resolveEditorialPhoto(replacement.photoAssetId);
    if (JSON.stringify(replacement.photoCredit) !== JSON.stringify(entry.credit)) {
      throw new Error('Photo credit must match the reviewed registry');
    }
  }
  if (!/^[a-z0-9][a-z0-9-]{1,99}$/.test(slug)) throw new Error('Blog image refresh requires a safe slug');
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('Blog image refresh requires the expected content SHA-256');
  let row: CreddyBlogCmsRow;
  try {
    const result = await client.from('creddy_blog_articles').select('*')
      .eq('slug', slug).eq('publish_state', 'published').maybeSingle();
    if (result.error) return { slug, status: 'retry', reason: 'read_failed' };
    if (!result.data) return { slug, status: 'retry', reason: 'not_published' };
    row = result.data as CreddyBlogCmsRow;
  } catch {
    return { slug, status: 'retry', reason: 'read_failed' };
  }
  if (row.slug !== slug || row.publish_state !== 'published') return { slug, status: 'retry', reason: 'not_published' };
  const content = replaceBlogVisuals(row.content, replacements);
  if (JSON.stringify(content) === JSON.stringify(row.content)) {
    return { slug, status: 'noop', contentSha256: row.content_sha256 };
  }
  if (row.content_sha256 !== expectedHash) return { slug, status: 'retry', reason: 'content_changed' };
  const contentSha256 = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  const reports = safeDataPath(root, 'reports', 'blog-image-refresh');
  await mkdir(reports, { recursive: true });
  const directory = await mkdtemp(join(reports, `${slug}-`));
  const preimagePath = join(directory, 'preimage.json');
  const manifestPath = join(directory, 'manifest.json');
  const manifest = {
    version: 1,
    slug,
    createdAt: new Date().toISOString(),
    expectedHash,
    contentSha256,
    preimagePath,
    replacements,
    retainedAssetPaths: row.content.visuals.assets.map((asset) => asset.assetPath),
    updatedColumns: ['content', 'content_sha256'],
  };
  // A durable preimage and prepared manifest must exist before any remote mutation.
  await writeJsonAtomic(preimagePath, row);
  await writeJsonAtomic(manifestPath, { ...manifest, status: 'prepared' });
  let result: BlogImageRefreshResult;
  try {
    const updated = await client.from('creddy_blog_articles').update({ content, content_sha256: contentSha256 })
      .eq('slug', slug).eq('content_sha256', expectedHash).eq('publish_state', 'published')
      .select('slug,content_sha256').maybeSingle();
    result = updated.error
      ? { slug, status: 'retry', reason: 'update_failed' }
      : updated.data?.slug === slug && updated.data.content_sha256 === contentSha256
        ? { slug, status: 'updated', contentSha256 }
        : { slug, status: 'retry', reason: 'content_changed' };
  } catch {
    result = { slug, status: 'retry', reason: 'update_failed' };
  }
  await writeJsonAtomic(manifestPath, { ...manifest, ...result, completedAt: new Date().toISOString() });
  return { ...result, preimagePath, manifestPath };
}
