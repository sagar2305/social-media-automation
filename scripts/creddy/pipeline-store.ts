import { randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import type { PipelineRunManifest } from './pipeline-types.js';

export const DEFAULT_CREDDY_DATA_ROOT =
  '/Users/mohitkourav/Documents/ChatGPT/Social media automation data';

export const CREDDY_DATA_DIRECTORIES = [
  '00-discovery',
  '01-raw',
  '02-filtered',
  '03-canonical-news/approved',
  '03-canonical-news/rejected',
  '03-canonical-news/archived',
  '03-canonical-news/slack-review',
  '03-canonical-news/slack-review/sent',
  '03-canonical-news/slack-review/resolutions',
  '03-canonical-news/reverify',
  '03-canonical-news/deferred',
  '04-analysis-queue',
  '05-content-opportunities',
  '05-content-opportunities/evergreen',
  '06-content-drafts/scripts',
  '06-content-drafts/captions',
  '06-content-drafts/briefs',
  '06-content-drafts/articles',
  '06-visual-plans',
  '06-content-packages/scripts',
  '06-content-packages/captions',
  '06-content-packages/images',
  '06-content-packages/briefs',
  '06-content-packages/articles',
  '07-slideshow-renders',
  '07-video-jobs',
  '08-rendered-videos/text-music',
  '08-rendered-videos/narrated',
  '09-pending-approval',
  '10-approved',
  '11-scheduled',
  '12-published',
  '13-rejected-content',
  '14-website-ready',
  'logs',
  'manifests',
  'reports/latest',
  'feedback/agent-01/records',
  'feedback/agent-01/snapshots',
  'feedback/agent-04/trends/runs',
  'feedback/agent-04/trends/snapshots',
  'locks',
  'indexes',
] as const;

export function resolveCreddyDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CREDDY_DATA_ROOT?.trim() || DEFAULT_CREDDY_DATA_ROOT;
  if (!isAbsolute(configured)) throw new Error('CREDDY_DATA_ROOT must be an absolute path');
  return resolve(configured, 'creddy');
}

export function safeDataPath(root: string, ...segments: string[]): string {
  if (!isAbsolute(root)) throw new Error('Data root must be absolute');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Data path contains an unsafe segment');
  }
  const target = resolve(root, ...segments);
  const rel = relative(resolve(root), target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Data path escapes root');
  return target;
}

export async function initializeCreddyDataRoot(root: string): Promise<void> {
  for (const directory of CREDDY_DATA_DIRECTORIES) {
    await mkdir(safeDataPath(root, ...directory.split('/')), { recursive: true });
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await rename(temporary, path);
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export async function listJsonFiles(root: string): Promise<string[]> {
  if (!(await pathExists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return listJsonFiles(path);
      return entry.isFile() && entry.name.endsWith('.json') ? [path] : [];
    }),
  );
  return nested.flat().sort();
}

export function createRunId(now = new Date()): string {
  return `${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${randomUUID().slice(0, 8)}`;
}

export function runDate(runId: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})T/.exec(runId);
  if (!match) throw new Error(`Invalid run id: ${runId}`);
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export async function writeRunManifest(
  root: string,
  manifest: PipelineRunManifest,
): Promise<void> {
  await writeJsonAtomic(safeDataPath(root, 'manifests', `${manifest.runId}.json`), manifest);
}

export async function withStageLock<T>(
  root: string,
  stage: string,
  action: () => Promise<T>,
  staleAfterMs = 2 * 60 * 60 * 1000,
): Promise<T> {
  if (!/^[a-z][a-z0-9_-]+$/.test(stage)) throw new Error('Invalid lock stage');
  const lockPath = safeDataPath(root, 'locks', `${stage}.lock`);
  await mkdir(dirname(lockPath), { recursive: true });

  try {
    const lockStat = await stat(lockPath);
    if (Date.now() - lockStat.mtimeMs > staleAfterMs) await unlink(lockPath);
  } catch {
    // Missing lock is the normal path.
  }

  let handle;
  try {
    handle = await open(lockPath, 'wx');
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Stage already running: ${stage}`);
    }
    throw error;
  }

  try {
    return await action();
  } finally {
    await handle.close();
    await unlink(lockPath).catch(() => undefined);
  }
}
