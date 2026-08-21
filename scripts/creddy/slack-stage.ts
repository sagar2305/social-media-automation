import { CREDDY_CAMPAIGN_SLUG } from './config.js';
import {
  createRunId,
  listJsonFiles,
  pathExists,
  readJson,
  safeDataPath,
  withStageLock,
  writeJsonAtomic,
  writeRunManifest,
} from './pipeline-store.js';
import {
  CREDDY_PIPELINE_VERSION,
  type AnalysisDecisionRecord,
  type PipelineRunManifest,
} from './pipeline-types.js';

export interface SlackApi {
  postReview(decision: AnalysisDecisionRecord, dashboardUrl: string): Promise<{ ts: string; channel: string }>;
}

export class SlackClient implements SlackApi {
  constructor(private readonly token: string, private readonly channel: string) {}

  async postReview(decision: AnalysisDecisionRecord, dashboardUrl: string) {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: this.channel,
        text: `Rare Creddy review required: ${decision.headline}`,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: 'Creddy: material conflict needs review' } },
          { type: 'section', text: { type: 'mrkdwn', text: `*${decision.headline}*\n${decision.summary}` } },
          { type: 'section', fields: [
            { type: 'mrkdwn', text: `*Importance*\n${decision.importanceScore}/100` },
            { type: 'mrkdwn', text: `*Confidence*\n${decision.confidenceScore}/100` },
          ] },
          { type: 'section', text: { type: 'mrkdwn', text: `*Conflict*\n${decision.claims.filter((claim) => claim.conflict).map((claim) => claim.conflict).join('\n') || 'Material source conflict'}` } },
          { type: 'actions', elements: [
            { type: 'button', style: 'primary', text: { type: 'plain_text', text: 'Process' }, action_id: 'creddy_process', value: decision.id },
            { type: 'button', style: 'danger', text: { type: 'plain_text', text: 'Skip' }, action_id: 'creddy_skip', value: decision.id },
            { type: 'button', text: { type: 'plain_text', text: 'Hold' }, action_id: 'creddy_hold', value: decision.id },
            { type: 'button', text: { type: 'plain_text', text: 'Open dashboard' }, url: `${dashboardUrl.replace(/\/$/, '')}/creddy/content-bank` },
          ] },
        ],
      }),
    });
    const payload = await response.json() as { ok?: boolean; error?: string; ts?: string; channel?: string };
    if (!response.ok || !payload.ok || !payload.ts || !payload.channel) {
      throw new Error(`Slack post failed: ${payload.error ?? response.status}`);
    }
    return { ts: payload.ts, channel: payload.channel };
  }
}

export async function runSlackReviewStage(
  root: string,
  client: SlackApi,
  dashboardUrl: string,
  now = new Date(),
): Promise<PipelineRunManifest> {
  return withStageLock(root, 'slack_review', async () => {
    const runId = createRunId(now);
    const manifest: PipelineRunManifest = {
      version: CREDDY_PIPELINE_VERSION,
      runId,
      campaignSlug: CREDDY_CAMPAIGN_SLUG,
      stage: 'analysis',
      status: 'running',
      startedAt: now.toISOString(),
      inputCount: 0,
      outputCount: 0,
      skippedCount: 0,
      failedCount: 0,
      errors: [],
    };
    await writeRunManifest(root, manifest);
    const paths = (await listJsonFiles(safeDataPath(root, '03-canonical-news', 'slack-review')))
      .filter((path) => !path.includes('/sent/') && !path.includes('/resolutions/'));
    for (const path of paths) {
      manifest.inputCount += 1;
      try {
        const decision = await readJson<AnalysisDecisionRecord>(path);
        const receiptPath = safeDataPath(root, '03-canonical-news', 'slack-review', 'sent', `${decision.id}.json`);
        if (await pathExists(receiptPath)) {
          manifest.skippedCount += 1;
          continue;
        }
        const posted = await client.postReview(decision, dashboardUrl);
        await writeJsonAtomic(receiptPath, { decisionId: decision.id, sentAt: now.toISOString(), ...posted });
        manifest.outputCount += 1;
      } catch (error) {
        manifest.failedCount += 1;
        manifest.errors.push(`${path}: ${(error as Error).message}`);
      }
    }
    manifest.completedAt = new Date().toISOString();
    manifest.status = manifest.failedCount === 0 ? 'completed' : 'partially_completed';
    await writeRunManifest(root, manifest);
    return manifest;
  });
}
