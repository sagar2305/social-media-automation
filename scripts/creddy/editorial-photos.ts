import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { safeDataPath } from './pipeline-store.js';

export interface EditorialPhotoCredit {
  creator: string;
  sourceUrl: string;
  license: 'CC0-1.0' | 'CC-BY-4.0' | 'CC-BY-SA-4.0';
  licenseUrl: string;
  modifications: string;
}

export interface EditorialPhotoEntry {
  id: string;
  file: string;
  sha256: string;
  subject: string;
  /** Editorial context only, never a keyword-based automatic selection rule. */
  usageNotes: string;
  credit: EditorialPhotoCredit;
  /** Normalized point after EXIF orientation, preserved within the 16:9 crop. */
  focalPoint: { x: number; y: number };
}

const registryPath = fileURLToPath(new URL('../../assets/creddy/editorial-photos/registry.json', import.meta.url));
const licenses = {
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC-BY-SA-4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
} as const;

export function validatePhotoCredit(credit: EditorialPhotoCredit): void {
  if (!credit || !credit.creator?.trim() || !credit.modifications?.trim()
      || licenses[credit.license] !== credit.licenseUrl || !credit.licenseUrl) {
    throw new Error('Photo requires verified creator, license and modification disclosure');
  }
  const source = new URL(credit.sourceUrl);
  if (source.protocol !== 'https:' || source.username || source.password) throw new Error('Photo source must be public HTTPS');
}

/** Separate from the brand registry: a brand mention never selects a property photograph. */
export async function editorialPhotoRegistry(): Promise<EditorialPhotoEntry[]> {
  const data = JSON.parse(await readFile(registryPath, 'utf8')) as { photos: EditorialPhotoEntry[] };
  if (!Array.isArray(data.photos) || new Set(data.photos.map(photo => photo.id)).size !== data.photos.length) {
    throw new Error('Invalid editorial photo registry');
  }
  return data.photos;
}

export async function resolveEditorialPhoto(id: string, registry = editorialPhotoRegistry()) {
  const entry = (await registry).find(photo => photo.id === id);
  if (!entry || !/^[a-z0-9-]+\.(jpg|jpeg|png|webp)$/.test(entry.file)) throw new Error('Unknown or unsafe editorial photo');
  validatePhotoCredit(entry.credit);
  if (!entry.subject?.trim() || entry.subject.length > 170 || !entry.usageNotes?.trim()
      || ![entry.focalPoint?.x, entry.focalPoint?.y].every(point => Number.isFinite(point) && point >= 0 && point <= 1)) {
    throw new Error('Photo requires exact subject, usage context and valid focal point');
  }
  const assetPath = resolve(dirname(registryPath), entry.file);
  const info = await stat(assetPath);
  if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error('Photo exceeds the local image size limit');
  const bytes = await readFile(assetPath);
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('Editorial photo integrity check failed');
  return { entry, bytes };
}

/** A single reviewed photograph, without generated logos, text overlays, or decorative tiles. */
export async function composeEditorialPhoto(input: { root: string; photoId: string; usage: 'hero' | 'inline' | 'comparison' }) {
  if (input.usage !== 'hero') throw new Error('Photo-first rollout is restricted to explicitly selected heroes');
  const { entry, bytes } = await resolveEditorialPhoto(input.photoId);
  const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw new Error('Photo must be a static raster');
  const normalized = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().toBuffer({ resolveWithObject: true });
  const { width, height } = normalized.info;
  const cropWidth = Math.min(width, Math.floor(height * 16 / 9));
  const cropHeight = Math.floor(cropWidth * 9 / 16);
  if (cropWidth < 1600 || cropHeight < 900) throw new Error('Photo requires enough detail for a 1600x900 crop');
  const left = Math.max(0, Math.min(width - cropWidth, Math.round(entry.focalPoint.x * width - cropWidth / 2)));
  const top = Math.max(0, Math.min(height - cropHeight, Math.round(entry.focalPoint.y * height - cropHeight / 2)));
  const fingerprint = createHash('sha256').update(JSON.stringify({ version: 'photo-editorial-v1', entry, left, top, cropWidth, cropHeight })).digest('hex');
  const assetPath = safeDataPath(input.root, '06-visual-assets', 'photo-editorial-v1', `${fingerprint}.png`);
  const output = await sharp(normalized.data).extract({ left, top, width: cropWidth, height: cropHeight })
    .resize(1600, 900).png().toBuffer();
  await mkdir(dirname(assetPath), { recursive: true });
  await writeFile(assetPath, output);
  return { assetPath, fingerprint, altText: entry.subject, caption: `${entry.subject}. Illustrative photograph.`,
    photoCredit: entry.credit,
    provenanceText: `${entry.credit.creator}. Source: ${entry.credit.sourceUrl} License: ${entry.credit.license} ${entry.credit.licenseUrl} ${entry.credit.modifications} Context: ${entry.usageNotes}` };
}
