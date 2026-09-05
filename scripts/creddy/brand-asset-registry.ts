import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { renderBrandVisual, type ApprovedBrandVisualAsset } from './brand-visuals.js';
import { safeDataPath } from './pipeline-store.js';

export interface EditorialBrandEntry {
  id: string;
  label: string;
  aliases: string[];
  file: string;
  sha256: string;
  sourceUrl: string;
  provenance: string;
}

const registryPath = fileURLToPath(new URL('../../assets/creddy/editorial-brands/registry.json', import.meta.url));

/** Checked-in, reviewed source assets only. Never scrape logos from article metadata. */
export async function editorialBrandRegistry(): Promise<EditorialBrandEntry[]> {
  const registry = JSON.parse(await readFile(registryPath, 'utf8')) as { brands: EditorialBrandEntry[] };
  if (!Array.isArray(registry.brands)) throw new Error('Editorial brand registry is invalid');
  return registry.brands;
}

export function matchEditorialBrands(title: string, registry: EditorialBrandEntry[]): EditorialBrandEntry[] {
  // Match explicit names only. Being mentioned together does not assert a partnership.
  const normalized = ` ${title.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  return registry.map(brand => ({ brand, position: Math.min(...brand.aliases.map(alias => {
    const term = alias.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const position = normalized.indexOf(` ${term} `);
    return term.length >= 3 && position >= 0 ? position : Infinity;
  })) })).filter(match => Number.isFinite(match.position))
    .sort((a, b) => a.position - b.position).slice(0, 4).map(match => match.brand);
}

export async function resolveEditorialBrands(ids: string[], registry = editorialBrandRegistry()): Promise<ApprovedBrandVisualAsset[]> {
  const entries = await registry;
  if (ids.length > 4 || new Set(ids).size !== ids.length) throw new Error('Choose up to four distinct editorial brands');
  return Promise.all(ids.map(async id => {
    const entry = entries.find(item => item.id === id);
    if (!entry || !/^[a-z0-9-]+\.(png|jpe?g|webp)$/.test(entry.file)) throw new Error('Unknown or unsafe editorial brand asset');
    const assetPath = resolve(dirname(registryPath), entry.file);
    const bytes = await readFile(assetPath);
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('Editorial brand asset integrity check failed');
    return { id: entry.id, label: entry.label, assetPath, sourceUrl: entry.sourceUrl, provenance: entry.provenance };
  }));
}

export async function composeEditorialImage(input: {
  root: string; title: string; usage: 'hero' | 'inline' | 'comparison'; brandIds: string[];
}) {
  const brands = await resolveEditorialBrands(input.brandIds);
  const fingerprint = createHash('sha256').update(JSON.stringify({ version: 'brand-editorial-v1', title: input.title,
    usage: input.usage, brands: await Promise.all(brands.map(async brand => ({ id: brand.id,
      sha256: createHash('sha256').update(await readFile(brand.assetPath)).digest('hex'), provenance: brand.provenance }))) })).digest('hex');
  const rendered = await renderBrandVisual({ ...input, brands,
    outputPath: safeDataPath(input.root, '06-visual-assets', 'brand-editorial-v1', `${fingerprint}.png`) });
  return { ...rendered, fingerprint, provenanceText: brands.length
    ? brands.map(brand => `${brand.label}: ${brand.provenance} Source: ${brand.sourceUrl}`).join('\n')
    : 'Original Creddy flat editorial illustration; no third-party brand imagery.' };
}
