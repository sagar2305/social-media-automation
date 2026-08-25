import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { CREDDY_PRODUCT_REGISTRY } from './product-capabilities.js';
import { pathExists, readJson, safeDataPath, writeJsonAtomic } from './pipeline-store.js';

export type CreddyProductReleaseStatus = {
  version: 1;
  checkedAt: string;
  registryVersion: string;
  ios: { reachable: boolean; publicVersion?: string; releasedAt?: string; changed: boolean };
  android: { reachable: boolean; publicUpdatedAt?: string; changed: boolean };
  reviewDue: boolean;
  requiresReview: boolean;
  warnings: string[];
};

type FetchLike = typeof fetch;

const STATUS_SEGMENTS = ['reports', 'product-capabilities', 'status.json'] as const;

function isoDateFromGooglePlay(html: string): string | undefined {
  const label = /<div[^>]*>Updated on<\/div><div[^>]*>([^<]+)<\/div>/i.exec(html)?.[1]?.trim();
  if (!label) return undefined;
  const parsed = new Date(`${label} 00:00:00 UTC`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

export async function inspectPublicCreddyReleases(
  now = new Date(),
  fetchImpl: FetchLike = fetch,
): Promise<CreddyProductReleaseStatus> {
  const warnings: string[] = [];
  let ios: CreddyProductReleaseStatus['ios'] = { reachable: false, changed: false };
  let android: CreddyProductReleaseStatus['android'] = { reachable: false, changed: false };

  try {
    const response = await fetchImpl(
      `https://itunes.apple.com/lookup?id=${CREDDY_PRODUCT_REGISTRY.ios.appId}&country=us`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as { results?: Array<{ version?: string; currentVersionReleaseDate?: string }> };
    const app = payload.results?.[0];
    if (!app?.version) throw new Error('App Store record missing version');
    ios = {
      reachable: true,
      publicVersion: app.version,
      releasedAt: app.currentVersionReleaseDate,
      changed: app.version !== CREDDY_PRODUCT_REGISTRY.ios.publicVersion,
    };
  } catch (error) {
    warnings.push(`iOS release check unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const response = await fetchImpl(
      `https://play.google.com/store/apps/details?id=${CREDDY_PRODUCT_REGISTRY.android.packageId}&hl=en_US&gl=US`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const publicUpdatedAt = isoDateFromGooglePlay(await response.text());
    if (!publicUpdatedAt) throw new Error('Google Play record missing update date');
    android = {
      reachable: true,
      publicUpdatedAt,
      changed: publicUpdatedAt !== CREDDY_PRODUCT_REGISTRY.android.publicUpdatedAt,
    };
  } catch (error) {
    warnings.push(`Android release check unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  const reviewDue = now.getTime() > Date.parse(CREDDY_PRODUCT_REGISTRY.reviewAfter);
  return {
    version: 1,
    checkedAt: now.toISOString(),
    registryVersion: CREDDY_PRODUCT_REGISTRY.version,
    ios,
    android,
    reviewDue,
    requiresReview: reviewDue || ios.changed || android.changed,
    warnings,
  };
}

export async function refreshCreddyProductReleaseStatus(
  root: string,
  now = new Date(),
  fetchImpl: FetchLike = fetch,
): Promise<CreddyProductReleaseStatus> {
  const status = await inspectPublicCreddyReleases(now, fetchImpl);
  const jsonPath = safeDataPath(root, ...STATUS_SEGMENTS);
  await writeJsonAtomic(jsonPath, status);
  const markdownPath = safeDataPath(root, 'reports', 'latest', '04-product-capabilities.md');
  await mkdir(dirname(markdownPath), { recursive: true });
  const state = status.requiresReview ? 'REVIEW REQUIRED' : 'CURRENT';
  const lines = [
    '# Agent 04 - Creddy product capabilities', '',
    `Registry: ${status.registryVersion} (${state})`,
    `Checked: ${status.checkedAt}`,
    `iOS public version: ${status.ios.publicVersion ?? 'unavailable'}; expected ${CREDDY_PRODUCT_REGISTRY.ios.publicVersion}`,
    `Android public update: ${status.android.publicUpdatedAt ?? 'unavailable'}; expected ${CREDDY_PRODUCT_REGISTRY.android.publicUpdatedAt}`,
    `Next manual capability review: ${CREDDY_PRODUCT_REGISTRY.reviewAfter}`,
    '',
    status.requiresReview
      ? 'New product CTAs are blocked until the released feature registry is reviewed. Engagement CTAs remain available.'
      : 'Approved product CTAs remain tied to verified public features and creddy://home.',
    ...status.warnings.map((warning) => `- ${warning}`),
  ];
  await writeFile(markdownPath, `${lines.join('\n')}\n`, 'utf8');
  return status;
}

export async function assertReleasedCapabilityStatus(
  root: string,
  kind: 'product' | 'engagement',
): Promise<void> {
  if (kind !== 'product') return;
  const path = safeDataPath(root, ...STATUS_SEGMENTS);
  if (!(await pathExists(path))) return;
  const status = await readJson<CreddyProductReleaseStatus>(path);
  if (status.registryVersion !== CREDDY_PRODUCT_REGISTRY.version || status.requiresReview) {
    throw new Error('Public Creddy release changed; review the capability registry before accepting a product CTA');
  }
}
