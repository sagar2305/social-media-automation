import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { promisify } from 'node:util';

import { inspectCreddyArticleImage } from './article-image-stage.js';
import { pathExists, readJson, safeDataPath } from './pipeline-store.js';
import type { ContentBankRecord } from './pipeline-types.js';
import {
  CREDDY_WEBSITE_EXPORT_VERSION,
  creddyWebsiteArticleRoute,
  creddyWebsiteAssetPath,
  type CreddyWebsiteExportPayload,
} from './website-stage.js';

export type WebsiteRegistryPayload = Omit<CreddyWebsiteExportPayload, 'previewPath' | 'visuals'> & {
  visuals: Omit<CreddyWebsiteExportPayload['visuals'], 'assets'> & {
    assets: Array<Omit<CreddyWebsiteExportPayload['visuals']['assets'][number], 'sourceAssetPath'>>;
  };
};

export type CreddyWebsiteSyncResult = {
  slug: string;
  synced: number;
  skipped: number;
  validatedAssets: number;
  outputPaths: string[];
  changedPaths: string[];
  policy: 'local_files_only';
};

export type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string },
) => Promise<string>;

export type CreddyWebsitePullRequestResult = {
  slug: string;
  branch: string;
  baseBranch: string;
  pullRequestUrl: string;
  validationCommands: string[];
  changedPaths: string[];
  deploymentAttempted: false;
};

const execFileAsync = promisify(execFile);

export const runWebsiteCommand: CommandRunner = async (command, args, options) => {
  const { stdout } = await execFileAsync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
};

function safeSlug(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{1,99}$/.test(value)) throw new Error('Website article slug must be a safe slug');
  return value;
}

function resolveWebsiteRepository(path: string): { repository: string; website: string; registry: string } {
  if (!path.trim() || !isAbsolute(path)) throw new Error('CREDDY_WEBSITE_REPOSITORY_PATH must be absolute');
  const repository = resolve(path);
  const website = join(repository, 'website');
  const registry = join(website, 'src', 'content', 'blogs', 'registry.json');
  return { repository, website, registry };
}

async function assertWebsiteRepository(path: string): Promise<ReturnType<typeof resolveWebsiteRepository>> {
  const resolved = resolveWebsiteRepository(path);
  await access(join(resolved.website, 'package.json'));
  await access(join(resolved.website, 'src', 'content', 'blogs', 'index.ts'));
  await access(resolved.registry);
  return resolved;
}

function assertPathInside(parent: string, target: string): void {
  const rel = relative(resolve(parent), resolve(target));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Website sync target escapes its approved directory');
}

export function assertWebsiteExportShape(payload: CreddyWebsiteExportPayload): void {
  if (payload.version !== CREDDY_WEBSITE_EXPORT_VERSION) throw new Error('Website sync requires creddy-website-export-v2');
  if (payload.publishState !== 'ready_for_getcreddy_integration') throw new Error('Website export is not ready for integration');
  if (!payload.contentBankId?.trim() || !payload.approvedBy?.trim() || !payload.approvedAt?.trim()) {
    throw new Error('Website export is missing Agent 7 approval provenance');
  }
  const slug = safeSlug(payload.article?.slug ?? '');
  if (payload.route !== creddyWebsiteArticleRoute(slug)) throw new Error('Website export route does not match its blog slug');
  if (
    payload.design?.articleImageBlock?.version !== 'creddy-abstract-editorial-v1' ||
    payload.design.articleImageBlock.aspectRatio !== '16:9' ||
    payload.visuals?.imageBlockStyle !== 'creddy-abstract-editorial-v1'
  ) {
    throw new Error('Website export does not use the approved abstract editorial image contract');
  }
  if (!Array.isArray(payload.visuals.assets) || payload.visuals.assets.length !== 3) {
    throw new Error('Website export requires exactly three approved visual assets');
  }
}

export async function readApprovedWebsiteExport(
  root: string,
  exportPath: string,
): Promise<CreddyWebsiteExportPayload> {
  if (!isAbsolute(exportPath)) throw new Error('Website export path must be absolute');
  const payload = await readJson<CreddyWebsiteExportPayload>(exportPath);
  assertWebsiteExportShape(payload);
  const expected = safeDataPath(root, '14-website-ready', `${safeSlug(payload.article.slug)}.json`);
  if (resolve(exportPath) !== expected) throw new Error('Website sync accepts only canonical Agent 8 exports');
  if (!isAbsolute(payload.previewPath) || !(await pathExists(payload.previewPath))) {
    throw new Error('Approved article preview is missing during website sync');
  }
  const bank = await readJson<ContentBankRecord>(
    safeDataPath(root, '09-pending-approval', `${payload.contentBankId}.json`),
  );
  const review = bank.articleReview;
  if (
    !review ||
    !['approved', 'publishing'].includes(review.status) ||
    review.approvedBy !== payload.approvedBy ||
    review.approvedAt !== payload.approvedAt
  ) {
    throw new Error('Agent 7 approval no longer matches the website export');
  }
  return payload;
}

export function cleanWebsiteExport(payload: CreddyWebsiteExportPayload): WebsiteRegistryPayload {
  const { previewPath: _previewPath, visuals, ...approved } = payload;
  return {
    ...approved,
    visuals: {
      ...visuals,
      assets: visuals.assets.map(({ sourceAssetPath: _sourceAssetPath, ...asset }) => asset),
    },
  };
}

async function writeAtomic(path: string, value: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, { flag: 'wx' });
  await rename(temporary, path);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function prepareValidatedAsset(
  website: string,
  slug: string,
  asset: CreddyWebsiteExportPayload['visuals']['assets'][number],
): Promise<{ target: string; bytes: Buffer; changed: boolean }> {
  if (!isAbsolute(asset.sourceAssetPath)) throw new Error(`Website visual ${asset.id} has no absolute source path`);
  const expectedPublicPath = creddyWebsiteAssetPath(slug, asset.id, asset.sourceAssetPath);
  if (asset.assetPath !== expectedPublicPath) throw new Error(`Website visual ${asset.id} has a mismatched public path`);
  const filename = decodeURIComponent(basename(asset.assetPath));
  if (!filename || filename.includes('/') || filename.includes('\\')) throw new Error(`Website visual ${asset.id} has an unsafe filename`);
  const targetDirectory = join(website, 'public', 'blogs', slug);
  const target = join(targetDirectory, filename);
  assertPathInside(targetDirectory, target);
  const bytes = await readFile(asset.sourceAssetPath);
  const metadata = inspectCreddyArticleImage(bytes);
  if (metadata.width * 9 !== metadata.height * 16 || asset.aspectRatio !== '16:9') {
    throw new Error(`Website visual ${asset.id} must be exact 16:9`);
  }
  const extension = extname(filename).toLowerCase();
  if (
    (metadata.mimeType === 'image/png' && extension !== '.png') ||
    (metadata.mimeType === 'image/jpeg' && extension !== '.jpg' && extension !== '.jpeg')
  ) {
    throw new Error(`Website visual ${asset.id} extension does not match its image container`);
  }
  if (await pathExists(target)) {
    const current = await readFile(target);
    if (!current.equals(bytes)) throw new Error(`Website visual target already exists with different bytes: ${target}`);
    return { target, bytes, changed: false };
  }
  return { target, bytes, changed: true };
}

export async function syncApprovedWebsiteExport(
  root: string,
  exportPath: string,
  websiteRepositoryPath: string,
): Promise<CreddyWebsiteSyncResult> {
  const locations = await assertWebsiteRepository(websiteRepositoryPath);
  const payload = await readApprovedWebsiteExport(root, exportPath);
  const slug = safeSlug(payload.article.slug);
  const publicPaths = new Set<string>();
  const preparedAssets: Array<{ target: string; bytes: Buffer; changed: boolean }> = [];
  for (const asset of payload.visuals.assets) {
    if (publicPaths.has(asset.assetPath)) throw new Error(`Duplicate website visual path: ${asset.assetPath}`);
    publicPaths.add(asset.assetPath);
    preparedAssets.push(await prepareValidatedAsset(locations.website, slug, asset));
  }

  const current = await readJson<WebsiteRegistryPayload[]>(locations.registry);
  if (!Array.isArray(current)) throw new Error('Website blog registry must be a JSON array');
  const clean = cleanWebsiteExport(payload);
  const index = current.findIndex((entry) => entry.article?.slug === slug);
  const unchanged = index >= 0 && json(current[index]) === json(clean);
  if (index >= 0) current[index] = clean;
  else current.push(clean);
  current.sort((a, b) => a.article.slug.localeCompare(b.article.slug));
  const outputPaths = preparedAssets.map((asset) => asset.target);
  const changedPaths: string[] = [];
  for (const asset of preparedAssets) {
    if (!asset.changed) continue;
    await writeAtomic(asset.target, asset.bytes);
    changedPaths.push(asset.target);
  }
  if (!unchanged) {
    await writeAtomic(locations.registry, json(current));
    changedPaths.push(locations.registry);
  }
  outputPaths.push(locations.registry);
  return {
    slug,
    synced: changedPaths.length ? 1 : 0,
    skipped: changedPaths.length ? 0 : 1,
    validatedAssets: payload.visuals.assets.length,
    outputPaths,
    changedPaths,
    policy: 'local_files_only',
  };
}

function branchFor(payload: CreddyWebsiteExportPayload): string {
  const id = payload.contentBankId.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 12);
  return `creddy/blog-${safeSlug(payload.article.slug)}-${id || 'approved'}`;
}

export async function prepareApprovedWebsitePullRequest(
  root: string,
  exportPath: string,
  websiteRepositoryPath: string,
  options: {
    allowExternalPullRequest: boolean;
    baseBranch?: string;
    baseRef?: string;
    runner?: CommandRunner;
  },
): Promise<CreddyWebsitePullRequestResult> {
  if (!options.allowExternalPullRequest) throw new Error('Website PR preparation requires explicit CREDDY_WEBSITE_PR_ENABLED=true');
  const repository = resolveWebsiteRepository(websiteRepositoryPath).repository;
  const payload = await readApprovedWebsiteExport(root, exportPath);
  const baseBranch = options.baseBranch ?? 'development';
  if (baseBranch !== 'development') throw new Error('Creddy website pull requests must target development');
  const runner = options.runner ?? runWebsiteCommand;
  await runner('git', ['-C', repository, 'rev-parse', '--is-inside-work-tree'], { cwd: repository });
  const baseRef = options.baseRef ?? 'origin/development';
  if (baseRef === 'origin/development') {
    await runner('git', ['-C', repository, 'fetch', 'origin', 'development'], { cwd: repository });
  }
  await runner('git', ['-C', repository, 'cat-file', '-e', `${baseRef}:website/src/content/blogs/registry.json`], { cwd: repository });
  const branch = branchFor(payload);
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'creddy-website-pr-'));
  const worktree = join(temporaryRoot, 'worktree');
  await runner('git', ['-C', repository, 'worktree', 'add', '-b', branch, worktree, baseRef], { cwd: repository });

  let synchronized: CreddyWebsiteSyncResult;
  try {
    synchronized = await syncApprovedWebsiteExport(root, exportPath, worktree);
    if (!synchronized.changedPaths.length) throw new Error(`Blog ${synchronized.slug} is already synchronized`);
    const website = join(worktree, 'website');
    await runner('npm', ['ci'], { cwd: website });
    await runner('npm', ['test'], { cwd: website });
    await runner('npm', ['run', 'lint'], { cwd: website });
    await runner('npm', ['run', 'build'], { cwd: website });
    const relativeRegistry = relative(worktree, join(website, 'src', 'content', 'blogs', 'registry.json'));
    const relativeAssets = relative(worktree, join(website, 'public', 'blogs', synchronized.slug));
    await runner('git', ['-C', worktree, 'add', '--', relativeRegistry, relativeAssets], { cwd: worktree });
    await runner('git', ['-C', worktree, 'commit', '-m', `Add Creddy blog: ${synchronized.slug}`], { cwd: worktree });
    await runner('git', ['-C', worktree, 'push', '-u', 'origin', branch], { cwd: worktree });
    const pullRequestUrl = await runner('gh', [
      'pr',
      'create',
      '--base',
      baseBranch,
      '--head',
      branch,
      '--title',
      `Add Creddy blog: ${payload.article.title}`,
      '--body',
      `Agent 7 approved Content Bank item ${payload.contentBankId}. Website tests, lint, and production build passed before this PR was opened. Production deployment still requires review and merge.`,
    ], { cwd: worktree });
    const changedPaths = synchronized.changedPaths.map((path) => relative(worktree, path));
    await runner('git', ['-C', repository, 'worktree', 'remove', worktree], { cwd: repository });
    return {
      slug: synchronized.slug,
      branch,
      baseBranch,
      pullRequestUrl,
      validationCommands: ['npm ci', 'npm test', 'npm run lint', 'npm run build'],
      changedPaths,
      deploymentAttempted: false,
    };
  } catch (error) {
    throw new Error(`${(error as Error).message}. Review the retained worktree at ${worktree}`);
  }
}
