/**
 * Campaign-aware path resolution.
 *
 * Every script that reads/writes data/<file>.md goes through this helper
 * so the pipeline can run multiple campaigns side-by-side without their
 * state files clobbering each other.
 *
 * The split between per-campaign and pipeline-level files matches the
 * filesystem layout established in Phase 1:
 *
 *   data/
 *   ├── campaigns/<slug>/  ← per-campaign state (managed by this helper)
 *   │   ├── POST-TRACKER.md
 *   │   ├── FORMAT-WINNERS.md
 *   │   └── …
 *   └── <file>             ← pipeline-level state (auto-fix, refresh log, …)
 *
 * Slug resolution priority:
 *   1. --campaign=<slug> CLI arg
 *   2. CAMPAIGN_SLUG env var (main.ts sets this when spawning child scripts)
 *   3. 'minutewise' default (back-compat for existing tooling that hasn't
 *      been updated to pass --campaign yet)
 */

import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..', '..');
export const DEFAULT_CAMPAIGN_SLUG = 'minutewise';

/**
 * Files that live INSIDE the campaign directory. Anything not in this set
 * resolves to the data/ root (pipeline-level).
 */
const PER_CAMPAIGN_FILES = new Set<string>([
  'POST-TRACKER.md',
  'FORMAT-WINNERS.md',
  'HASHTAG-BANK.md',
  'LESSONS-LEARNED.md',
  'EXPERIMENT-LOG.md',
  'TRENDING-NOW.md',
  'results.tsv',
  'tier-state.json',
  '.last-autoresearch-run',
  'program.md',
]);

let cachedSlug: string | null = null;

/**
 * Resolves the active campaign slug for the current process.
 * Memoised so repeat calls are free.
 */
export function getCampaignSlug(): string {
  if (cachedSlug) return cachedSlug;

  // 1. CLI arg
  const arg = process.argv.find((a) => a.startsWith('--campaign='));
  if (arg) {
    cachedSlug = arg.split('=')[1] || DEFAULT_CAMPAIGN_SLUG;
    return cachedSlug;
  }

  // 2. Env var (inherited from parent process)
  if (process.env.CAMPAIGN_SLUG) {
    cachedSlug = process.env.CAMPAIGN_SLUG;
    return cachedSlug;
  }

  // 3. Default
  cachedSlug = DEFAULT_CAMPAIGN_SLUG;
  return cachedSlug;
}

/** Override the cached slug (used by tests + multi-campaign loops in cron). */
export function setCampaignSlug(slug: string): void {
  cachedSlug = slug;
  process.env.CAMPAIGN_SLUG = slug;
}

/** Reset the slug cache so the next getCampaignSlug() re-reads. */
export function resetCampaignSlug(): void {
  cachedSlug = null;
}

/**
 * Returns the absolute path to a data file, routing per-campaign files
 * to data/campaigns/<slug>/ and pipeline-level files to data/.
 *
 *   dataPath('POST-TRACKER.md')  → data/campaigns/minutewise/POST-TRACKER.md
 *   dataPath('REFRESH-LOG.md')   → data/REFRESH-LOG.md
 *   dataPath('FORMAT-WINNERS.md', 'roastai')
 *                                → data/campaigns/roastai/FORMAT-WINNERS.md
 */
export function dataPath(filename: string, slug?: string): string {
  if (PER_CAMPAIGN_FILES.has(filename)) {
    return join(REPO_ROOT, 'data', 'campaigns', slug ?? getCampaignSlug(), filename);
  }
  return join(REPO_ROOT, 'data', filename);
}

/** Absolute path to the campaign's state directory. */
export function campaignDir(slug?: string): string {
  return join(REPO_ROOT, 'data', 'campaigns', slug ?? getCampaignSlug());
}

/** Absolute path to the campaign's CTA image (used by post_to_tiktok). */
export function campaignCtaPath(slug?: string): string {
  return join(REPO_ROOT, 'posts', 'cta', `${slug ?? getCampaignSlug()}.png`);
}
