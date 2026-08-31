import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import type { VerificationGate } from '../../dashboard/src/lib/creddy-verification-policy.js';

const loaded = await import('../../dashboard/src/lib/creddy-verification-policy.js');
const policy = (((loaded as unknown as { default?: unknown }).default ?? loaded)) as unknown as {
  assertVerificationRecordIntegrity: (bank: { analysisBatchId?: string; verificationGate?: VerificationGate }, source: { analysisBatchId?: string; verificationGate?: VerificationGate }) => void;
  assertSocialVerificationForRevision: (gate: VerificationGate | undefined, revision: number) => void;
  hasPublicCopyChanged: (original: { instagramCaption: string; tiktokCaption: string; hashtags: string[] }, edited: { instagramCaption: string; tiktokCaption: string; hashtags: string[] }) => boolean;
  resetFactsVerificationAfterPublicCopyEdit: (gate?: VerificationGate) => VerificationGate | undefined;
};
const { assertSocialVerificationForRevision, assertVerificationRecordIntegrity, hasPublicCopyChanged, resetFactsVerificationAfterPublicCopyEdit } = policy;

const gate: VerificationGate = {
  portfolioRank: 2,
  selectedAt: '2026-08-31T10:00:00.000Z',
  official: {
    id: 'official-1', checkedAt: '2026-08-31T10:05:00.000Z', status: 'verified',
    attemptedUrls: ['https://delta.com/terms'],
    evidence: [{ url: 'https://delta.com/terms', owner: 'Delta Air Lines', sourceType: 'airline' }],
    claimOutcomes: [{ field: 'offer', status: 'verified', officialUrls: ['https://delta.com/terms'], notes: 'Confirmed.' }],
    remainingRequirements: [], failureReasons: [],
  },
  socialStatus: 'verified',
  factsVerifiedBy: 'editor@example.com',
  factsVerifiedAt: '2026-08-31T10:10:00.000Z',
  factsVerificationRevision: 3,
};

test('any public-copy revision resets prior automatic or manual social confirmation', () => {
  assert.equal(hasPublicCopyChanged(
    { instagramCaption: 'Original', tiktokCaption: 'Original', hashtags: ['Creddy'] },
    { instagramCaption: 'Edited', tiktokCaption: 'Original', hashtags: ['Creddy'] },
  ), true);
  const reset = resetFactsVerificationAfterPublicCopyEdit(gate)!;
  assert.equal(reset.socialStatus, 'manual_confirmation_required');
  assert.equal(reset.factsVerifiedBy, undefined);
  assert.equal(reset.factsVerifiedAt, undefined);
  assert.equal(reset.factsVerificationRevision, undefined);
});

test('new-batch records cannot lose or mismatch their verification boundary', () => {
  assert.throws(() => assertVerificationRecordIntegrity(
    { analysisBatchId: 'batch-1' },
    { analysisBatchId: 'batch-1', verificationGate: gate },
  ), /missing its official-verification gate/);
  assert.throws(() => assertVerificationRecordIntegrity(
    { analysisBatchId: 'batch-1', verificationGate: gate },
    { analysisBatchId: 'batch-2', verificationGate: gate },
  ), /mismatched Agent 03 batch/);
  assert.throws(() => assertVerificationRecordIntegrity(
    { analysisBatchId: 'batch-1', verificationGate: gate },
    { analysisBatchId: 'batch-1', verificationGate: { ...gate, portfolioRank: 4 } },
  ), /verification gates do not match/);
});

test('manual confirmation metadata may differ while immutable official evidence remains bound', () => {
  assert.doesNotThrow(() => assertVerificationRecordIntegrity(
    { analysisBatchId: 'batch-1', verificationGate: { ...gate, socialStatus: 'manual_confirmation_required' } },
    { analysisBatchId: 'batch-1', verificationGate: gate },
  ));
});

test('portal release rejects conflicting, unaudited, and stale social verification', () => {
  assert.throws(() => assertSocialVerificationForRevision({ ...gate, official: { ...gate.official, status: 'conflicting' } }, 3), /conflicts/);
  assert.throws(() => assertSocialVerificationForRevision({
    ...gate, official: { ...gate.official, status: 'unavailable' }, factsVerifiedBy: undefined,
  }, 3), /actor, timestamp, or current revision/);
  assert.throws(() => assertSocialVerificationForRevision({
    ...gate, official: { ...gate.official, status: 'inconclusive' }, factsVerificationRevision: 2,
  }, 3), /actor, timestamp, or current revision/);
});

test('slideshow submit persists caption edits before evaluating the delivery gate', async () => {
  const source = await readFile(new URL('../../dashboard/src/app/(dashboard)/creddy/content-bank/actions.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function submitCreddySlideshowAction');
  const end = source.indexOf('\nexport async function', start + 1);
  const body = source.slice(start, end < 0 ? undefined : end);
  const save = body.indexOf('await saveCreddyReviewDraft');
  const gateCheck = body.indexOf('await assertCreddySocialDeliveryReady');
  assert.ok(save >= 0 && gateCheck > save, 'caption changes must reset verification before any delivery check');
});

test('CLI approval validates bank/source binding before social approval', async () => {
  const source = await readFile(new URL('./video-stage.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function approveContentBankItem');
  const end = source.indexOf('\nexport async function', start + 1);
  const body = source.slice(start, end < 0 ? undefined : end);
  const integrity = body.indexOf('await assertBankVerificationIntegrity');
  const social = body.indexOf('assertSocialVerificationSatisfied');
  assert.ok(integrity >= 0 && social > integrity, 'CLI approval must verify immutable binding before social approval');
});
