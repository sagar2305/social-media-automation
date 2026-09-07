import sharp from 'sharp';
import { boundedBytes, persistOnlinePhoto, validateOnlineSelection, type OnlinePhotoSelection } from './online-photo-selection.js';

const licenseUrl = 'https://www.pexels.com/license/';
const maxBytes = 20 * 1024 * 1024;
type Photo = { id: number; width: number; height: number; url: string; photographer: string;
  photographer_url: string; src: { original: string }; alt: string };

function safeUrl(value: string, host: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password || url.hash) {
    throw new Error('Invalid Pexels URL');
  }
  return url;
}

export function pexelsPhotoId(value: string): number {
  const url = safeUrl(value, 'www.pexels.com');
  const match = /^\/photo\/(?:[a-z0-9-]+-)?([1-9][0-9]*)\/?$/.exec(url.pathname);
  const id = Number(match?.[1]);
  if (!Number.isSafeInteger(id) || id < 1 || url.search) throw new Error('Use a Pexels photo page');
  return id;
}

function validatePhoto(photo: Photo, expectedId?: number): Photo {
  if (!photo || !Number.isSafeInteger(photo.id) || photo.id < 1 || (expectedId !== undefined && photo.id !== expectedId)
      || pexelsPhotoId(photo.url) !== photo.id || !photo.photographer?.trim() || photo.photographer.length > 500
      || !Number.isInteger(photo.width) || !Number.isInteger(photo.height)
      || photo.width < 1600 || photo.height < 900 || photo.width * photo.height > 40_000_000) {
    throw new Error('Pexels photo identity or dimensions invalid');
  }
  const creator = safeUrl(photo.photographer_url, 'www.pexels.com');
  if (!creator.pathname.startsWith('/@')) throw new Error('Pexels photographer invalid');
  const source = safeUrl(photo.src?.original, 'images.pexels.com');
  if (!source.pathname.startsWith(`/photos/${photo.id}/`) || source.search) throw new Error('Pexels original image invalid');
  return photo;
}

async function request(path: string, apiKey: string | undefined, fetcher: typeof fetch) {
  if (!apiKey?.trim()) throw new Error('PEXELS_API_KEY is not configured; use the protected environment');
  try {
    const response = await fetcher(`https://api.pexels.com/v1/${path}`, {
      headers: { Authorization: apiKey }, redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    // Never include response bodies, request headers, or provider exceptions in diagnostics.
    return JSON.parse((await boundedBytes(response, 1024 * 1024)).toString('utf8'));
  } catch { throw new Error('Pexels API request failed; check configuration or retry later'); }
}

/** Six results maximum, no pagination loop and no automatic selection/download. */
export async function searchPexelsPhotos(query: string, apiKey = process.env.PEXELS_API_KEY, fetcher: typeof fetch = fetch) {
  if (typeof query !== 'string' || !query.trim() || query.length > 180) throw new Error('A focused photo query is required');
  const result = await request(`search?${new URLSearchParams({ query: query.trim(), orientation: 'landscape', per_page: '6' })}`, apiKey, fetcher);
  if (!Array.isArray(result.photos)) throw new Error('Pexels search response invalid');
  return { provider: 'Pexels', providerUrl: 'https://www.pexels.com', licenseUrl,
    candidates: result.photos.slice(0, 6).flatMap((item: Photo) => {
      try {
        const photo = validatePhoto(item);
        return [{ id: photo.id, sourcePageUrl: photo.url, photographer: photo.photographer,
          photographerUrl: photo.photographer_url, width: photo.width, height: photo.height,
          description: typeof photo.alt === 'string' ? photo.alt.slice(0, 500) : '' }];
      } catch { return []; }
    }) };
}

/** Re-fetch authoritative metadata for the explicitly reviewed page; supplied credits are never trusted. */
export async function importPexelsPhoto(root: string, selection: OnlinePhotoSelection,
  apiKey = process.env.PEXELS_API_KEY, fetcher: typeof fetch = fetch) {
  validateOnlineSelection(selection);
  const id = pexelsPhotoId(selection.sourcePageUrl);
  const response = await request(`photos/${id}`, apiKey, fetcher);
  let photo: Photo;
  try { photo = validatePhoto(response, id); }
  catch { throw new Error('Pexels returned invalid photo metadata'); }
  let bytes: Buffer;
  try {
    // No Authorization header is sent to the public image CDN.
    bytes = await boundedBytes(await fetcher(photo.src.original, {
      redirect: 'error', signal: AbortSignal.timeout(30_000),
    }), maxBytes);
  } catch { throw new Error('Pexels image download failed or exceeded limits'); }
  let format: string;
  try {
    const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1
        || metadata.width !== photo.width || metadata.height !== photo.height) throw new Error('Invalid raster');
    // Fully decode and check oriented crop detail before accepting a receipt.
    const normalized = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().raw().toBuffer({ resolveWithObject: true });
    if (Math.min(normalized.info.width, Math.floor(normalized.info.height * 16 / 9)) < 1600) throw new Error('Insufficient crop detail');
    format = metadata.format!;
  } catch { throw new Error('Pexels image failed static raster or crop validation'); }
  const credit = { creator: photo.photographer, sourceUrl: photo.url, license: 'Pexels' as const, licenseUrl,
    modifications: 'Cropped to 16:9 and resized; no subject alteration.' };
  return persistOnlinePhoto(root, { ...selection, focalPoint: selection.focalPoint ?? { x: 0.5, y: 0.5 } },
    bytes, format, credit, photo.src.original, {
      provider: 'Pexels', photoId: photo.id, photographerUrl: photo.photographer_url,
      width: photo.width, height: photo.height, licenseUrl,
    });
}
