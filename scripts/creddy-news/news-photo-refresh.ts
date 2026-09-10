import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { configuredNewsService, type NewsService, type NewsImageReplacement } from '../../shared/creddy-news/creddy-news-service.js';
import { composeEditorialPhoto } from '../creddy/editorial-photos.js';
import sharp from 'sharp';
import { editorialImageObjectPath, uploadEditorialImage } from '../creddy/editorial-image-delivery.js';
import { resolveWebsiteCmsCredentials } from '../creddy/instant-website-publish.js';
import { pathExists, readJson, resolveCreddyDataRoot, safeDataPath, writeJsonAtomic } from '../creddy/pipeline-store.js';

export type NewsPhotoSelection = { newsId: string; photoAssetId: string; reason: string };
type PhotoPreview = Awaited<ReturnType<typeof composeEditorialPhoto>>;
export type NewsPhotoPlan = { version: 1; projectRef: string; items: Array<NewsPhotoSelection & {
  title: string; expectedRevision: number; preview: PhotoPreview; sha256: string;
}> };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function assertSelection(item: NewsPhotoSelection) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(item.newsId) || !item.photoAssetId || !item.reason?.trim()) {
    throw new Error('An explicit News identity, reviewed photo and editorial reason are required.');
  }
}
function assertNewsLicense(preview: PhotoPreview) {
  if (!['CC0-1.0', 'Pexels'].includes(preview.photoCredit.license)) {
    throw new Error('This photo requires public attribution that the current native News surface cannot display.');
  }
}

export async function planNewsPhotos(root: string, selections: NewsPhotoSelection[], service: NewsService, projectRef: string) {
  if (!Array.isArray(selections) || !selections.length || new Set(selections.map(item => item.newsId)).size !== selections.length) {
    throw new Error('Select each News item exactly once.');
  }
  const plan: NewsPhotoPlan = { version: 1, projectRef, items: [] };
  for (const selection of selections) {
    assertSelection(selection);
    const item = await service.get(selection.newsId);
    if (item.status !== 'published' || item.id !== selection.newsId) throw new Error('Only published News can receive a photo refresh.');
    const preview = await composeEditorialPhoto({ root, photoId: selection.photoAssetId, usage: 'hero' });
    assertNewsLicense(preview);
    plan.items.push({ ...selection, title: item.content.headline, expectedRevision: item.revision, preview,
      sha256: hash(await readFile(preview.assetPath)) });
  }
  const path = safeDataPath(root, 'reports', 'news-photo-refresh', randomUUID(), 'plan.json');
  await writeJsonAtomic(path, plan);
  return { path, plan };
}

export async function applyNewsPhotos(root: string, path: string, options: {
  service: NewsService; projectRef: string; env?: NodeJS.ProcessEnv; upload?: typeof uploadEditorialImage;
}) {
  const plan = await readJson<NewsPhotoPlan>(path);
  if (plan.version !== 1 || plan.projectRef !== options.projectRef || !Array.isArray(plan.items)
      || new Set(plan.items.map(item => item.newsId)).size !== plan.items.length) throw new Error('Photo plan project or identity mismatch.');
  const results: Array<{ newsId: string; status: 'updated' | 'noop' | 'retry'; revision?: number }> = [];
  const resultPath = safeDataPath(dirname(path), `results-${randomUUID()}.json`);
  for (const planned of plan.items) {
    try {
      assertSelection(planned);
      if (!Number.isSafeInteger(planned.expectedRevision) || planned.expectedRevision < 1) throw new Error('Invalid revision.');
      // Check bytes before re-rendering, so rendering cannot erase evidence of a changed preview.
      if (hash(await readFile(planned.preview.assetPath)) !== planned.sha256) throw new Error('Preview changed.');
      const rendered = await composeEditorialPhoto({ root, photoId: planned.photoAssetId, usage: 'hero' });
      assertNewsLicense(rendered);
      if (hash(await readFile(rendered.assetPath)) !== planned.sha256
          || JSON.stringify(rendered) !== JSON.stringify(planned.preview)) throw new Error('Selection changed.');
      const previous = await options.service.get(planned.newsId);
      if (previous.id !== planned.newsId || previous.status !== 'published') throw new Error('News is no longer published.');
      const preimagePath = safeDataPath(dirname(path), `${planned.newsId}-preimage.json`);
      const label = `${planned.newsId}-photo`;
      const webp = await sharp(await readFile(rendered.assetPath)).webp({ quality: 88 }).toBuffer();
      const expectedUrl = `https://${options.projectRef}.supabase.co/storage/v1/object/public/creddy-blog-assets/${editorialImageObjectPath(label, webp)}`;
      const image: NewsImageReplacement = { url: expectedUrl, rights: 'licensed', attribution: rendered.provenanceText };
      const rights = previous.provenance.imageRights as Partial<NewsImageReplacement> | undefined;
      const alreadyApplied = previous.content.image_url === image.url && rights?.url === image.url
        && rights.rights === image.rights && rights.attribution === image.attribution;
      if (!alreadyApplied && previous.revision !== planned.expectedRevision) throw new Error('News changed since planning.');
      if (!alreadyApplied) {
        const uploaded = await (options.upload ?? uploadEditorialImage)(rendered.assetPath, label, options.env);
        if (uploaded !== expectedUrl) throw new Error('Unexpected upload destination.');
      }
      if (!await pathExists(preimagePath)) await writeJsonAtomic(preimagePath, previous);
      const updated = alreadyApplied ? previous : await options.service.setImage(planned.newsId, planned.expectedRevision, image, 'editorial:news-photo-refresh');
      const { image_url: _old, ...oldCopy } = previous.content;
      const { image_url: _new, ...newCopy } = updated.content;
      if (updated.id !== previous.id || updated.status !== 'published' || updated.content.image_url !== image.url
          || JSON.stringify(oldCopy) !== JSON.stringify(newCopy)) throw new Error('Photo-only update was not confirmed.');
      results.push({ newsId: planned.newsId, status: alreadyApplied ? 'noop' : 'updated', revision: updated.revision });
    } catch { results.push({ newsId: planned.newsId, status: 'retry' }); }
    await writeJsonAtomic(resultPath, results);
  }
  return { resultPath, results };
}

async function main() {
  const credentials = resolveWebsiteCmsCredentials();
  const root = resolveCreddyDataRoot();
  const service = configuredNewsService();
  const [command, input] = process.argv.slice(2);
  if (!input) throw new Error('Use plan <selections.json> or apply <plan.json>.');
  if (command === 'plan') {
    const result = await planNewsPhotos(root, await readJson(resolve(input)), service, credentials.projectRef);
    console.log(JSON.stringify({ path: result.path, count: result.plan.items.length,
      previews: result.plan.items.map(item => ({ newsId: item.newsId, title: item.title, path: item.preview.assetPath })) }, null, 2));
  } else if (command === 'apply') {
    console.log(JSON.stringify(await applyNewsPhotos(root, resolve(input), { service, projectRef: credentials.projectRef }), null, 2));
  } else throw new Error('Use plan or apply.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('News photo operation failed. Check the reviewed selection and service configuration.'); process.exitCode = 1; });
}
