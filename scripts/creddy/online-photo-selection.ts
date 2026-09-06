import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { safeDataPath, pathExists, writeJsonAtomic } from './pipeline-store.js';
import type { EditorialPhotoEntry, EditorialPhotoCredit } from './editorial-photos.js';

export type OnlinePhotoSelection = {
  storyId: string; sourcePageUrl: string; subject: string; usageNotes: string;
};
const maxBytes = 20 * 1024 * 1024;
const licenseMap: Record<string, Pick<EditorialPhotoCredit, 'license' | 'licenseUrl'>> = {
  CC0: { license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  'CC BY 4.0': { license: 'CC-BY-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' },
  'CC BY-SA 4.0': { license: 'CC-BY-SA-4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' },
};

export function canonicalPhotoSource(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'commons.wikimedia.org' || url.port || url.username || url.password
      || !url.pathname.startsWith('/wiki/File:')) throw new Error('Use an HTTPS Commons file description page');
  const title = decodeURIComponent(url.pathname.slice('/wiki/'.length)).replaceAll('_', ' ');
  if (title.includes('|') || title.includes('\n')) throw new Error('Invalid file title');
  return `https://commons.wikimedia.org/wiki/${encodeURIComponent(title).replaceAll('%3A', ':')}`;
}

async function boundedBytes(response: Response, limit: number): Promise<Buffer> {
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit) throw new Error('Photo download unavailable or oversized');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Photo download oversized');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

const plainText = (value: string) => value.replace(/<[^>]*>/g, '').replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"').replaceAll('&#39;', "'").trim();

/** Import just one reviewed online choice. Receipts are never a future-candidate catalog. */
export async function importOnlinePhoto(root: string, selection: OnlinePhotoSelection, fetcher: typeof fetch = fetch) {
  if (!/^[a-z0-9-]{2,120}$/.test(selection.storyId) || !selection.subject?.trim() || selection.subject.length > 170
      || !selection.usageNotes?.trim()) throw new Error('Photo requires story identity, exact subject and editorial context');
  const sourceUrl = canonicalPhotoSource(selection.sourcePageUrl);
  const api = new URL('https://commons.wikimedia.org/w/api.php');
  api.search = new URLSearchParams({ action: 'query', format: 'json', prop: 'imageinfo',
    titles: decodeURIComponent(new URL(sourceUrl).pathname.slice('/wiki/'.length)),
    iiprop: 'url|size|mime|extmetadata|sha1', iiextmetadatalanguage: 'en' }).toString();
  const request = { redirect: 'error' as const, signal: AbortSignal.timeout(30_000) };
  const metadata = JSON.parse((await boundedBytes(await fetcher(api, request), 1024 * 1024)).toString('utf8'));
  const pages = Object.values(metadata.query?.pages ?? {}) as Array<{ imageinfo?: Array<Record<string, any>> }>;
  if (pages.length !== 1 || !pages[0]?.imageinfo?.[0]) throw new Error('Online photo metadata unavailable');
  const info = pages[0].imageinfo[0];
  const license = licenseMap[info.extmetadata?.LicenseShortName?.value];
  if (!license) throw new Error('Photo lacks supported explicit free-reuse license');
  const declaredLicense = new URL(info.extmetadata?.LicenseUrl?.value);
  const expectedLicense = new URL(license.licenseUrl);
  const licensePath = (path: string) => path.replace(/\/deed\.en$/, '/').replace(/\/$/, '');
  if (!['http:', 'https:'].includes(declaredLicense.protocol) || declaredLicense.hostname !== expectedLicense.hostname
      || declaredLicense.port || declaredLicense.username || declaredLicense.password
      || licensePath(declaredLicense.pathname) !== licensePath(expectedLicense.pathname)) {
    throw new Error('License metadata does not match');
  }
  const creator = plainText(info.extmetadata?.Artist?.value ?? '');
  if (!creator || creator.length > 500 || info.extmetadata?.Restrictions?.value) throw new Error('Photo attribution or restrictions require review');
  const imageUrl = new URL(info.url);
  if (imageUrl.protocol !== 'https:' || imageUrl.hostname !== 'upload.wikimedia.org' || imageUrl.port
      || imageUrl.username || imageUrl.password || !imageUrl.pathname.startsWith('/wikipedia/commons/')) {
    throw new Error('Unapproved photo download host');
  }
  imageUrl.search = ''; imageUrl.hash = '';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(info.mime) || info.size > maxBytes
      || info.width < 1600 || info.height < 900 || info.width * info.height > 40_000_000) throw new Error('Unsupported photo format or dimensions');
  const bytes = await boundedBytes(await fetcher(imageUrl, request), maxBytes);
  const dimensions = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
  if (!['jpeg', 'png', 'webp'].includes(dimensions.format ?? '') || (dimensions.pages ?? 1) !== 1
      || dimensions.width !== info.width || dimensions.height !== info.height
      || bytes.length !== info.size || createHash('sha1').update(bytes).digest('hex') !== info.sha1) throw new Error('Photo bytes do not match reviewed metadata');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const credit = { creator, sourceUrl, ...license, modifications: 'Cropped to 16:9 and resized; no subject alteration.' };
  const identity = { storyId: selection.storyId, sha256, sourceUrl, subject: selection.subject, usageNotes: selection.usageNotes, credit };
  const id = `online-${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
  const directory = safeDataPath(root, '06-visual-assets', 'online-selections', id);
  const file = `photo.${dimensions.format === 'jpeg' ? 'jpg' : dimensions.format}`;
  const entry: EditorialPhotoEntry = { id, file, sha256, subject: selection.subject, usageNotes: selection.usageNotes,
    credit, focalPoint: { x: 0.5, y: 0.5 } };
  const receiptPath = safeDataPath(directory, 'selection.json');
  if (!await pathExists(receiptPath)) {
    await mkdir(directory, { recursive: true });
    try { await writeFile(safeDataPath(directory, file), bytes, { flag: 'wx' }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST'
          || !bytes.equals(await readFile(safeDataPath(directory, file)))) throw new Error('Existing photo bytes changed');
    }
    await writeJsonAtomic(receiptPath, { version: 1, ...identity, selectedAt: new Date().toISOString(), downloadUrl: imageUrl.href,
      metadata: info, entry });
  } else {
    const previous = JSON.parse(await readFile(receiptPath, 'utf8'));
    if (JSON.stringify(previous.entry) !== JSON.stringify(entry)) throw new Error('Existing selection receipt changed');
  }
  return { photoAssetId: id, sourceUrl, sha256, photoCredit: credit, subject: entry.subject,
    receiptPath, assetPath: safeDataPath(directory, file) };
}
