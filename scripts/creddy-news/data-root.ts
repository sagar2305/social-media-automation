import { isAbsolute, resolve } from 'node:path';

import { DEFAULT_CREDDY_DATA_ROOT, resolveCreddyDataRoot } from '../creddy/pipeline-store.js';

/**
 * News has its own durable workspace. It must never read from or write to the
 * blog/slideshow/social pipeline root, even when both agents use the same Mac.
 */
export function resolveCreddyNewsDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.CREDDY_NEWS_DATA_ROOT?.trim();
  const root = explicit
    ? explicit
    : resolve(env.CREDDY_DATA_ROOT?.trim() || DEFAULT_CREDDY_DATA_ROOT, 'creddy-news');
  if (!isAbsolute(root)) throw new Error('CREDDY_NEWS_DATA_ROOT must be an absolute path');
  const normalized = resolve(root);
  if (normalized === resolveCreddyDataRoot(env)) {
    throw new Error('News data root must be different from the existing Creddy content pipeline root');
  }
  return normalized;
}
