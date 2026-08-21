import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CREDDY_DATA_DIRECTORIES,
  createRunId,
  initializeCreddyDataRoot,
  listJsonFiles,
  pathExists,
  runDate,
  safeDataPath,
  withStageLock,
  writeJsonAtomic,
} from './pipeline-store.js';

test('initializes every pipeline directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-store-'));
  await initializeCreddyDataRoot(root);
  for (const directory of CREDDY_DATA_DIRECTORIES) {
    assert.equal(await pathExists(join(root, directory)), true);
  }
});

test('safe paths cannot escape the configured root', () => {
  assert.throws(() => safeDataPath('/tmp/creddy', '..', 'private'), /unsafe segment/);
  assert.equal(safeDataPath('/tmp/creddy', '01-raw'), '/tmp/creddy/01-raw');
});

test('atomic JSON writes are readable and discoverable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-store-'));
  const path = safeDataPath(root, '01-raw', 'record.json');
  await writeJsonAtomic(path, { ok: true });
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { ok: true });
  assert.deepEqual(await listJsonFiles(root), [path]);
});

test('stage lock refuses concurrent execution and releases afterward', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-store-'));
  await initializeCreddyDataRoot(root);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = withStageLock(root, 'filtering', async () => held);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await assert.rejects(() => withStageLock(root, 'filtering', async () => undefined), /already running/);
  release();
  await first;
  await withStageLock(root, 'filtering', async () => undefined);
});

test('run ids preserve a stable UTC date partition', () => {
  const id = createRunId(new Date('2026-08-19T12:34:56.000Z'));
  assert.equal(runDate(id), '2026-08-19');
});
