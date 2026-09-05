import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import sharp from 'sharp';

export interface ApprovedBrandVisualAsset {
  id: string;
  label: string;
  assetPath: string;
  sourceUrl: string;
  provenance: string;
}

export interface BrandVisualInput {
  brands: ApprovedBrandVisualAsset[];
  title: string;
  usage: 'hero' | 'inline' | 'comparison';
  outputPath: string;
}

export interface BrandVisualResult {
  assetPath: string;
  altText: string;
  caption: string;
  provenance: ApprovedBrandVisualAsset[];
}

const WIDTH = 1600;
const HEIGHT = 900;
const MAX_BYTES = 20 * 1024 * 1024;
const RASTER_FORMATS = new Set(['png', 'jpeg', 'webp']);

function contextArtwork(title: string): string {
  // Decorative symbols communicate a subject, never a rate, benefit, or product UI.
  if (/hotel|hilton|hyatt|marriott|stay|ihg/i.test(title)) {
    return '<path d="M110 210V80h150v130M145 210v-45h80v45M130 110h25m45 0h25m-95 25h25m45 0h25M85 210h205"/>';
  }
  if (/card|credit|cashback|cash back|bank/i.test(title)) {
    return '<path d="M90 205h210M110 185V100m50 85V100m50 85V100m50 85V100M85 80l110-55 110 55z"/>';
  }
  return '<circle cx="190" cy="135" r="95"/><ellipse cx="190" cy="135" rx="45" ry="95"/><path d="M95 135h190M112 82h156M112 188h156"/>';
}

function layoutSvg(title: string, usage: BrandVisualInput['usage'], tiles: { left: number; top: number; width: number; height: number }[]): Buffer {
  const tileMarkup = tiles.map(({ left, top, width, height }) =>
    `<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="24" fill="#fff" stroke="#dce2e5" stroke-width="2"/>`).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 1600 900">
    <rect width="1600" height="900" fill="#FBFAF7"/>
    <path d="M0 694C280 624 440 840 762 744s508-110 838-5v161H0z" fill="#e7eeed"/>
    <path d="M0 747c320-123 500 143 843 13s519-24 757 12" fill="none" stroke="#a3b8b8" stroke-width="2"/>
    <circle cx="1430" cy="100" r="190" fill="#FBF2DD"/>
    <path d="M94 112h88" stroke="#FF605D" stroke-width="10" stroke-linecap="round"/>
    <path d="M206 112h130" stroke="#183544" stroke-width="3" stroke-linecap="round"/>
    <g transform="${usage === 'inline' && tiles.length === 1 ? 'translate(1010 265) scale(1.25)' : 'translate(1280 720) scale(.55)'}" fill="none" stroke="#183544" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${contextArtwork(title)}</g>
    ${tileMarkup}
    ${tiles.length ? '' : `<g transform="${usage === 'inline' ? 'translate(230 200) scale(1.8)' : usage === 'comparison' ? 'translate(560 160) scale(1.9)' : 'translate(430 165) scale(2)'}" fill="none" stroke="#183544" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${contextArtwork(title)}</g>`}
  </svg>`);
}

/** Render approved local raster assets without recoloring, cropping, or inventing brand marks. */
export async function renderBrandVisual(input: BrandVisualInput): Promise<BrandVisualResult> {
  if (!isAbsolute(input.outputPath)) throw new Error('Brand visual output must be an absolute local path.');
  if (input.brands.length > 4) throw new Error('Brand visuals support at most four approved assets per composition.');
  if (new Set(input.brands.map((brand) => brand.id)).size !== input.brands.length) {
    throw new Error('Brand visual asset IDs must be unique.');
  }
  const count = input.brands.length;
  const columns = count > 1 ? 2 : 1;
  const rows = count > 2 ? 2 : 1;
  const tileWidth = columns === 1 ? input.usage === 'inline' ? 840 : 1120 : 624;
  const tileHeight = rows === 1 ? 520 : 270;
  const tiles = input.brands.map((_, index) => ({
    left: columns === 1 ? input.usage === 'inline' ? 128 : 240 : 152 + (index % columns) * (tileWidth + 48),
    top: rows === 1 ? input.usage === 'comparison' ? 210 : 170 : 154 + Math.floor(index / columns) * (tileHeight + 32),
    width: tileWidth,
    height: tileHeight,
  }));
  const overlays: Parameters<ReturnType<typeof sharp>['composite']>[0] = [];
  for (const [index, brand] of input.brands.entries()) {
    if (!brand.id.trim() || !brand.label.trim() || !brand.provenance.trim()) {
      throw new Error('Brand assets require an ID, label, and approval provenance.');
    }
    const source = new URL(brand.sourceUrl);
    if (source.protocol !== 'https:' || source.username || source.password) {
      throw new Error('Brand source attribution requires a public HTTPS URL.');
    }
    if (!isAbsolute(brand.assetPath)) throw new Error('Brand assets must be absolute local raster paths.');
    const file = await stat(brand.assetPath);
    if (!file.isFile() || file.size > MAX_BYTES) throw new Error('Brand asset is not a supported local image.');
    const bytes = await readFile(brand.assetPath);
    const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.format || !RASTER_FORMATS.has(metadata.format) || (metadata.pages ?? 1) > 1) {
      throw new Error('Brand assets must be static PNG, JPEG, or WebP images.');
    }
    const contrast = await sharp(bytes).flatten({ background: '#ffffff' }).resize(64, 64, { fit: 'inside' }).removeAlpha().toColourspace('srgb').raw().toBuffer();
    let visiblePixels = 0;
    for (let pixel = 0; pixel < contrast.length; pixel += 3) {
      if (Math.min(contrast[pixel]!, contrast[pixel + 1]!, contrast[pixel + 2]!) < 200) visiblePixels++;
    }
    if (visiblePixels < contrast.length / 3 * 0.01) throw new Error('Brand asset has insufficient contrast on the editorial white tile; choose an original full-color asset.');
    const tile = tiles[index]!;
    const logo = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(tile.width - 112, tile.height - 100, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    if (logo.info.width < 120 && logo.info.height < 80) throw new Error('Brand asset is too small for a readable editorial image.');
    overlays.push({ input: logo.data, left: tile.left + Math.round((tile.width - logo.info.width) / 2), top: tile.top + Math.round((tile.height - logo.info.height) / 2) });
  }
  const output = await sharp(layoutSvg(input.title, input.usage, tiles)).composite(overlays).png({ compressionLevel: 6 }).toBuffer();
  if (output.length < 10_000 || output.length > MAX_BYTES) throw new Error('Rendered brand visual falls outside image delivery size limits.');
  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, output);
  const names = input.brands.map((brand) => brand.label).join(' and ');
  return {
    assetPath: input.outputPath,
    altText: names ? `${names} brand imagery in a clean editorial composition.` : 'Flat editorial illustration for travel and rewards coverage.',
    caption: names ? `Brand imagery: ${names}. Editorial illustration.` : 'Editorial illustration.',
    provenance: input.brands.map((brand) => ({ ...brand })),
  };
}
