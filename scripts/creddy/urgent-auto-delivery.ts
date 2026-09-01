import { BlotatoClient } from './blotato-client.js';
import { listJsonFiles, readJson, safeDataPath } from './pipeline-store.js';
import type { ContentBankRecord } from './pipeline-types.js';
import { assertAutoUrgentAuthorizationCurrent } from './publication-policy.js';
import { runPublishStage } from './publish-stage.js';
import { approveContentBankItem } from './video-stage.js';

export async function autoApproveAndSubmitUrgentSocial(input: {
  root: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): Promise<{ approved: number; submitted: number; failures: Array<{ id: string; reason: string }> }> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const result = { approved: 0, submitted: 0, failures: [] as Array<{ id: string; reason: string }> };
  if (env.CREDDY_URGENT_SOCIAL_AUTOPUBLISH_ENABLED?.trim().toLowerCase() !== 'true') return result;
  const instagram = env.CREDDY_URGENT_INSTAGRAM_ACCOUNT?.trim();
  const tiktok = env.CREDDY_URGENT_TIKTOK_ACCOUNT?.trim();
  const key = env.BLOTATO_API_KEY?.trim();
  if (!instagram || !tiktok || !key) throw new Error('Urgent social publishing requires both account mappings and the Blotato credential');
  for (const path of await listJsonFiles(safeDataPath(input.root, '09-pending-approval'))) {
    const bank = await readJson<ContentBankRecord>(path);
    if (bank.status !== 'pending_review' || bank.productionAuthorization?.approvalMode !== 'auto_urgent' ||
        bank.productionAuthorization.distributionMode !== 'article_and_social') continue;
    try {
      await assertAutoUrgentAuthorizationCurrent(input.root, bank, now);
      const scheduledFor = new Date(now.getTime() + 60 * 1000).toISOString();
      await approveContentBankItem(input.root, {
        id: bank.id,
        approvedBy: 'policy:auto_urgent',
        approvalMode: 'auto_urgent',
        destinations: [
          { format: 'narrated', platform: 'instagram', account: instagram, scheduledFor },
          { format: 'narrated', platform: 'tiktok', account: tiktok, scheduledFor },
        ],
      }, now);
      result.approved += 1;
    } catch (error) {
      result.failures.push({ id: bank.id, reason: (error as Error).message });
    }
  }
  if (result.approved > 0) {
    const manifest = await runPublishStage(input.root, new BlotatoClient(key), now, 15);
    result.submitted = manifest.outputCount;
    result.failures.push(...manifest.errors.map((reason) => ({ id: 'publishing', reason })));
  }
  return result;
}
