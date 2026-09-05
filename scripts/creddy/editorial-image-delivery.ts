import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { composeEditorialImage, editorialBrandRegistry, matchEditorialBrands } from './brand-asset-registry.js';
import { resolveWebsiteCmsCredentials } from './instant-website-publish.js';
import { CREDDY_BLOG_BUCKET } from './website-cms-stage.js';

export function editorialImageObjectPath(label: string, bytes: Buffer): string {
  const hash = createHash('sha256').update(bytes).digest('hex');
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 100);
  // This is the existing public website allowlist, not a new Storage convention.
  return `blogs/editorial-v1/${safeLabel}-${hash}.webp`;
}

/** Content-addressed uploads retain previous images and make retries safe. */
export async function uploadEditorialImage(path: string, label: string, env = process.env) {
  const { url, serviceRoleKey } = resolveWebsiteCmsCredentials(env);
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) } });
  const bytes = await sharp(await readFile(path)).webp({ quality: 88 }).toBuffer();
  const objectPath = editorialImageObjectPath(label, bytes);
  const uploaded = await client.storage.from(CREDDY_BLOG_BUCKET).upload(objectPath, bytes,
    { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
  if (uploaded.error && !['409', 'Duplicate'].includes(String('statusCode' in uploaded.error ? uploaded.error.statusCode : ''))
      && uploaded.error.message !== 'The resource already exists') throw new Error('Editorial image upload failed; retryable.');
  return client.storage.from(CREDDY_BLOG_BUCKET).getPublicUrl(objectPath).data.publicUrl;
}

/** Optional imagery is independent of blog production and never chooses News eligibility. */
export async function prepareNewsBrandImage(root: string, title: string, env = process.env) {
  const brands = matchEditorialBrands(title, await editorialBrandRegistry());
  if (!brands.length) return undefined;
  const image = await composeEditorialImage({ root, title, usage: 'hero', brandIds: brands.map(brand => brand.id) });
  return { url: await uploadEditorialImage(image.assetPath, brands.map(brand => brand.id).join('-'), env),
    rights: 'editorial_reference' as const, attribution: image.provenanceText };
}
