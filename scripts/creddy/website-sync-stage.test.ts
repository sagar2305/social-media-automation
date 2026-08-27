import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CREDDY_ARTICLE_IMAGE_BLOCK, CREDDY_ARTICLE_THEME } from './article-content.js';
import { initializeCreddyDataRoot, readJson, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import { CREDDY_PIPELINE_VERSION, type ContentBankRecord } from './pipeline-types.js';
import {
  prepareApprovedWebsitePullRequest,
  runWebsiteCommand,
  syncApprovedWebsiteExport,
  type CommandRunner,
} from './website-sync-stage.js';
import {
  CREDDY_WEBSITE_EXPORT_VERSION,
  creddyWebsiteAssetPath,
  type CreddyWebsiteExportPayload,
} from './website-stage.js';

function pngFixture(width: number, height: number): Uint8Array {
  const bytes = Buffer.alloc(12_000);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

async function fakeWebsiteRepository(root: string): Promise<void> {
  const content = join(root, 'website', 'src', 'content', 'blogs');
  await mkdir(content, { recursive: true });
  await writeFile(join(root, 'website', 'package.json'), '{"name":"website"}\n');
  await writeFile(join(content, 'index.ts'), 'export const BLOG_EXPORTS = [];\n');
  await writeFile(join(content, 'registry.json'), '[]\n');
}

async function approvedFixture(): Promise<{
  root: string;
  repository: string;
  exportPath: string;
  payload: CreddyWebsiteExportPayload;
}> {
  const root = await mkdtemp(join(tmpdir(), 'creddy-website-sync-data-'));
  await initializeCreddyDataRoot(root);
  const repository = await mkdtemp(join(tmpdir(), 'creddy-website-sync-repo-'));
  await fakeWebsiteRepository(repository);
  const sourceAssetPaths = ['hero', 'detail', 'summary'].map((id) => join(root, `${id}.png`));
  const previewPath = join(root, 'preview.html');
  await Promise.all(sourceAssetPaths.map((path) => writeFile(path, pngFixture(1600, 900))));
  await writeFile(previewPath, '<!doctype html><title>Approved preview</title>');
  const slug = 'test-article';
  const payload: CreddyWebsiteExportPayload = {
    version: CREDDY_WEBSITE_EXPORT_VERSION,
    contentBankId: 'bank-1',
    approvedBy: 'boss-reviewer',
    approvedAt: '2026-08-26T08:00:00.000Z',
    route: `/blog/${slug}`,
    design: {
      version: 'creddy-guides-v1',
      tokens: CREDDY_ARTICLE_THEME,
      articleImageBlock: CREDDY_ARTICLE_IMAGE_BLOCK,
    },
    article: {
      version: 'creddy-article-v1',
      designVersion: 'creddy-guides-v1',
      id: 'article-1',
      slug,
      category: 'guides',
      title: 'A verified test article',
      dek: 'A useful explanation.',
      excerpt: 'A useful explanation.',
      seoTitle: 'A verified test article',
      seoDescription: 'A useful explanation for cardholders.',
      authorName: 'Creddy Editorial',
      createdAt: '2026-08-26T07:00:00.000Z',
      updatedAt: '2026-08-26T07:00:00.000Z',
      readingMinutes: 4,
      heroVisualId: 'hero',
      blocks: [
        { id: 'hero-block', type: 'visual', visualId: 'hero', caption: 'Approved hero visual.' },
        { id: 'detail-block', type: 'visual', visualId: 'detail', caption: 'Approved detail visual.' },
        { id: 'summary-block', type: 'visual', visualId: 'summary', caption: 'Approved summary visual.' },
        { id: 'body', type: 'paragraph', text: 'Verified article body.', claimFields: [] },
      ],
      sourceUrls: ['https://example.com/source'],
      referralDisclosure: 'Creddy may earn a commission from approved links.',
    },
    visuals: {
      version: 'creddy-article-visuals-v1',
      designVersion: 'creddy-guides-v1',
      imageBlockStyle: 'creddy-abstract-editorial-v1',
      assets: ['hero', 'detail', 'summary'].map((id, index) => ({
        id,
        usage: index === 0 ? 'hero' as const : 'inline' as const,
        articleBlockId: `${id}-block`,
        assetType: 'editorial_illustration' as const,
        aspectRatio: '16:9' as const,
        generationMode: 'generate' as const,
        altText: `Abstract editorial card visual ${index + 1}`,
        caption: `Approved visual ${index + 1}.`,
        claimFields: [],
        sourceAssetPath: sourceAssetPaths[index]!,
        assetPath: creddyWebsiteAssetPath(slug, id, sourceAssetPaths[index]!),
      })),
    },
    referrals: [],
    previewPath,
    publishState: 'ready_for_getcreddy_integration',
  };
  const bank: ContentBankRecord = {
    version: CREDDY_PIPELINE_VERSION,
    id: payload.contentBankId,
    contentPackageId: 'package-1',
    createdAt: payload.approvedAt,
    status: 'pending_review',
    revision: 1,
    articleReview: {
      status: 'approved',
      approvedBy: payload.approvedBy,
      approvedAt: payload.approvedAt,
    },
  };
  await writeJsonAtomic(safeDataPath(root, '09-pending-approval', `${bank.id}.json`), bank);
  const exportPath = safeDataPath(root, '14-website-ready', `${slug}.json`);
  await writeJsonAtomic(exportPath, payload);
  return { root, repository, exportPath, payload };
}

test('Agent 8 sync copies only approved website JSON and exact 16:9 assets idempotently', async () => {
  const fixture = await approvedFixture();
  const first = await syncApprovedWebsiteExport(fixture.root, fixture.exportPath, fixture.repository);
  assert.equal(first.synced, 1);
  assert.equal(first.validatedAssets, 3);
  const registryPath = join(fixture.repository, 'website', 'src', 'content', 'blogs', 'registry.json');
  const registry = await readJson<Array<Record<string, unknown>>>(registryPath);
  assert.equal(registry.length, 1);
  const serialized = JSON.stringify(registry);
  assert.doesNotMatch(serialized, /sourceAssetPath|previewPath/);
  const target = first.outputPaths.find((path) => path.endsWith('.png'))!;
  assert.equal((await readFile(target)).byteLength, 12_000);

  const second = await syncApprovedWebsiteExport(fixture.root, fixture.exportPath, fixture.repository);
  assert.equal(second.synced, 0);
  assert.equal(second.skipped, 1);
  assert.deepEqual(second.changedPaths, []);
});

test('Agent 8 sync fails closed when Agent 7 approval no longer matches', async () => {
  const fixture = await approvedFixture();
  const bankPath = safeDataPath(fixture.root, '09-pending-approval', `${fixture.payload.contentBankId}.json`);
  const bank = await readJson<ContentBankRecord>(bankPath);
  bank.articleReview = { status: 'changes_requested' };
  await writeJsonAtomic(bankPath, bank);
  await assert.rejects(
    syncApprovedWebsiteExport(fixture.root, fixture.exportPath, fixture.repository),
    /Agent 7 approval no longer matches/,
  );
});

test('Agent 8 PR preparation uses an isolated development worktree and never deploys', async () => {
  const fixture = await approvedFixture();
  await runWebsiteCommand('git', ['init', '-b', 'development'], { cwd: fixture.repository });
  await runWebsiteCommand('git', ['config', 'user.name', 'Creddy Test'], { cwd: fixture.repository });
  await runWebsiteCommand('git', ['config', 'user.email', 'creddy-test@example.com'], { cwd: fixture.repository });
  await runWebsiteCommand('git', ['add', 'website'], { cwd: fixture.repository });
  await runWebsiteCommand('git', ['commit', '-m', 'Website blogs foundation'], { cwd: fixture.repository });
  const calls: string[] = [];
  const runner: CommandRunner = async (command, args, options) => {
    calls.push([command, ...args].join(' '));
    if (command === 'npm') return '';
    if (command === 'gh') return 'https://github.com/example/creddy/pull/1';
    if (command === 'git' && args.includes('push')) return '';
    return runWebsiteCommand(command, args, options);
  };

  const result = await prepareApprovedWebsitePullRequest(
    fixture.root,
    fixture.exportPath,
    fixture.repository,
    { allowExternalPullRequest: true, baseRef: 'development', runner },
  );
  assert.equal(result.baseBranch, 'development');
  assert.equal(result.pullRequestUrl, 'https://github.com/example/creddy/pull/1');
  assert.equal(result.deploymentAttempted, false);
  assert(calls.some((call) => call.includes('worktree add -b creddy/blog-test-article-bank-1')));
  assert(calls.includes('npm ci'));
  assert(calls.includes('npm test'));
  assert(calls.includes('npm run lint'));
  assert(calls.includes('npm run build'));
  assert(calls.some((call) => call.startsWith('gh pr create --base development')));
  assert.equal(
    calls.some((call) => call.startsWith('vercel ') || call.startsWith('gh pr merge')),
    false,
  );
});

test('Agent 8 PR preparation requires an explicit external-write gate', async () => {
  const fixture = await approvedFixture();
  await assert.rejects(
    prepareApprovedWebsitePullRequest(
      fixture.root,
      fixture.exportPath,
      fixture.repository,
      { allowExternalPullRequest: false },
    ),
    /CREDDY_WEBSITE_PR_ENABLED=true/,
  );
});
