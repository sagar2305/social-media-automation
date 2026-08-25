import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  acceptHookTrendSnapshot,
  refreshHookTrendResearch,
  validateDraftTrendReference,
  type HookTrendSnapshot,
} from './hook-trend-stage.js';
import { initializeCreddyDataRoot } from './pipeline-store.js';

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'creddy-hook-trends-'));
  await initializeCreddyDataRoot(value);
  return value;
}

test('Agent 4 queues at most one paid weekly Orbit and stores no copied captions', async () => {
  const dataRoot = await root();
  let posts = 0;
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts += 1;
      return new Response(JSON.stringify({ data: { orbit_id: 'orbit-1' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { status: 'completed' } }), { status: 200 });
  }) as typeof fetch;
  const env = { VIRLO_API_KEY: 'private-test-key' };
  const queued = await refreshHookTrendResearch(dataRoot, new Date('2026-08-25T00:00:00Z'), env, fetchImpl);
  assert.equal(queued.status, 'queued');
  assert.equal(posts, 1);

  const fetchVideos = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      posts += 1;
      return new Response(JSON.stringify({ data: { orbit_id: 'orbit-2' } }), { status: 200 });
    }
    if (url.includes('/videos?')) {
      return new Response(JSON.stringify({ data: { videos: [{
        url: 'https://www.tiktok.com/@creator/video/1', platform: 'tiktok', publish_date: '2026-08-24T00:00:00Z',
        views: 100000, likes: 5000, comments: 100, description: 'Copied hook must not be stored',
        author: { username: 'creator', followers: 10000 },
      }] } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { status: 'completed' } }), { status: 200 });
  }) as typeof fetch;
  const ready = await refreshHookTrendResearch(dataRoot, new Date('2026-08-25T00:01:00Z'), env, fetchVideos);
  assert.equal(ready.status, 'ready_for_review');
  assert.equal(posts, 1, 'polling and result collection must not queue another paid Orbit');
  assert.equal(ready.examples.length, 1);
  assert.equal('description' in ready.examples[0]!, false);
  assert.equal('username' in ready.examples[0]!, false);
});

test('Agent 4 accepts only bounded abstract hook patterns and one trend candidate', async () => {
  const dataRoot = await root();
  const env = { VIRLO_API_KEY: 'private-test-key' };
  let phase = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return new Response(JSON.stringify({ data: { orbit_id: 'orbit-1' } }), { status: 200 });
    }
    if (String(input).includes('/videos?')) {
      return new Response(JSON.stringify({ data: { videos: [{
        url: 'https://www.instagram.com/reel/example', platform: 'instagram',
        views: 80000, likes: 4000, comments: 80, author: { followers: 5000 },
      }] } }), { status: 200 });
    }
    phase += 1;
    return new Response(JSON.stringify({ data: { status: 'completed' } }), { status: 200 });
  }) as typeof fetch;
  await refreshHookTrendResearch(dataRoot, new Date('2026-08-25T00:00:00Z'), env, fetchImpl);
  const ready = await refreshHookTrendResearch(dataRoot, new Date('2026-08-25T00:01:00Z'), env, fetchImpl);
  assert.equal(phase, 1);
  const snapshot: HookTrendSnapshot = {
    version: 1,
    id: 'hook-patterns-2026-08-25',
    researchRunId: ready.id,
    createdAt: '2026-08-25T00:02:00Z',
    expiresAt: '2026-09-15T00:02:00Z',
    patterns: [{
      id: 'specific-cost-consequence',
      label: 'Specific cost consequence',
      structure: 'Name the concrete cost, then resolve what changes for the viewer.',
      rationale: 'A precise consequence creates useful curiosity without hype.',
      suitableFor: ['act_now', 'decide_or_discuss'],
      exampleIds: [ready.examples[0]!.id],
    }],
  };
  await acceptHookTrendSnapshot(dataRoot, snapshot, new Date('2026-08-25T00:02:00Z'));
  await assert.doesNotReject(() => validateDraftTrendReference(
    dataRoot, snapshot.id, ['specific-cost-consequence', undefined, undefined, undefined],
    'act_now',
    new Date('2026-08-26T00:00:00Z'),
  ));
  await assert.rejects(() => validateDraftTrendReference(
    dataRoot, snapshot.id, ['specific-cost-consequence', 'specific-cost-consequence'],
    'act_now',
    new Date('2026-08-26T00:00:00Z'),
  ), /At most one/);
  await assert.rejects(() => validateDraftTrendReference(
    dataRoot, snapshot.id, ['specific-cost-consequence', undefined, undefined, undefined],
    'understand',
    new Date('2026-08-26T00:00:00Z'),
  ), /not approved for its content slot/);
});

test('Agent 4 rejects copied or attributed wording in hook-pattern snapshots', async () => {
  const dataRoot = await root();
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'POST') return new Response(JSON.stringify({ data: { orbit_id: 'orbit-1' } }), { status: 200 });
    if (String(input).includes('/videos?')) {
      return new Response(JSON.stringify({ data: { videos: [{
        url: 'https://www.youtube.com/shorts/example', platform: 'youtube', views: 50000, likes: 1000, comments: 20,
      }] } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { status: 'completed' } }), { status: 200 });
  }) as typeof fetch;
  const env = { VIRLO_API_KEY: 'private-test-key' };
  await refreshHookTrendResearch(dataRoot, new Date('2026-08-25T00:00:00Z'), env, fetchImpl);
  const ready = await refreshHookTrendResearch(dataRoot, new Date('2026-08-25T00:01:00Z'), env, fetchImpl);
  const invalid: HookTrendSnapshot = {
    version: 1, id: 'hook-patterns-2026-08-25', researchRunId: ready.id,
    createdAt: '2026-08-25T00:02:00Z', expiresAt: '2026-09-01T00:02:00Z',
    patterns: [{
      id: 'copied-hook', label: 'Copied hook', structure: 'Use "You need to see this" from @creator.',
      rationale: 'Copied wording', suitableFor: ['understand'], exampleIds: [ready.examples[0]!.id],
    }],
  };
  await assert.rejects(
    () => acceptHookTrendSnapshot(dataRoot, invalid, new Date('2026-08-25T00:02:00Z')),
    /abstract pattern/,
  );
});
