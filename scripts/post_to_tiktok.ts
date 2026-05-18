import { readFile, appendFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { config, type PostingPath } from '../config/config.js';
import { apiRequest, log } from './api-client.js';
import type { PostMetadata } from './text_overlay.js';
import { classifyError } from './auto_fix/classifier.js';
import { logClassified } from './auto_fix/audit_logger.js';
import { maybeNotify } from './auto_fix/notifier.js';
import { dataPath, campaignCtaPath } from './lib/campaign-paths.js';
import { reportEvent } from './cycle_reporter.js';

/**
 * Ensure the directory containing `filePath` exists. The per-campaign
 * tracker files live under `data/campaigns/<slug>/` — when a campaign
 * is created via the dashboard the row goes into Supabase but the
 * filesystem dir is not pre-created (Phase 17 oversight). Without
 * this, the FIRST post to a brand-new campaign throws ENOENT inside
 * trackPost, which the post-attempt try/catch swallows — the post
 * still went out to Blotato but the cycle reports "0 submissions".
 * mkdir-p is cheap and fully idempotent so we just always run it.
 */
async function ensureDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

// ─── Blotato Types ───────────────────────────────────────────

interface BlotAccount {
  id: string;
  platform: string;
  username?: string;
  fullname?: string;
}

interface BlotAccountsResponse {
  items: BlotAccount[];
}

// ─── Blotato Account Resolution ──────────────────────────────

let blotAccountCache: Map<string, string> | null = null;

async function fetchBlotAccountIds(): Promise<Map<string, string>> {
  if (blotAccountCache) return blotAccountCache;

  const data = await apiRequest<BlotAccountsResponse>(
    'blotato',
    '/users/me/accounts?platform=tiktok',
  );

  const map = new Map<string, string>();
  for (const acc of data.items) {
    if (acc.username) map.set(acc.username.toLowerCase(), acc.id);
    if (acc.fullname) map.set(acc.fullname.toLowerCase(), acc.id);
  }
  blotAccountCache = map;
  log(`Blotato: found ${map.size} TikTok accounts`);
  return map;
}

// ─── Image Upload (base64 → Blotato /v2/media) ───────────────

async function uploadImage(imagePath: string): Promise<string> {
  const fileBuffer = await readFile(imagePath);
  const ext = (imagePath.split('.').pop() || 'png').toLowerCase();
  const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
  const dataUrl = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;

  const { url } = await apiRequest<{ url: string; id: string }>('blotato', '/media', {
    method: 'POST',
    body: { url: dataUrl },
  });
  return url;
}

// ─── Post via Blotato ────────────────────────────────────────

async function postViaBlotato(
  blotAccountId: string,
  mediaUrls: string[],
  caption: string,
  hookTitle: string,
  isDraft: boolean,
  scheduleDate?: Date,
): Promise<{ postSubmissionId: string }> {
  const body: any = {
    post: {
      accountId: blotAccountId,
      content: {
        text: caption,
        mediaUrls,
        platform: 'tiktok',
      },
      target: {
        targetType: 'tiktok',
        privacyLevel: config.posting.defaultPrivacy,
        disabledComments: false,
        disabledDuet: false,
        disabledStitch: false,
        isBrandedContent: false,
        isYourBrand: false,
        isAiGenerated: true,
        isDraft,
        autoAddMusic: true,
        title: hookTitle.slice(0, 90),
      },
    },
  };

  if (scheduleDate && !isDraft) {
    body.scheduledTime = scheduleDate.toISOString();
  }

  return apiRequest<{ postSubmissionId: string }>('blotato', '/posts', {
    method: 'POST',
    body,
  });
}

// ─── Post Tracking ───────────────────────────────────────────

async function trackPost(postId: string, metadata: PostMetadata, postingPath: PostingPath = 'draft'): Promise<void> {
  const trackerPath = dataPath('POST-TRACKER.md');
  await ensureDir(trackerPath);
  const statusLabel = postingPath === 'draft' ? 'draft' : 'pending';
  const row = `| ${postId} | ${metadata.createdAt.slice(0, 10)} | ${metadata.hookStyle} | ${metadata.format} | ${metadata.hashtags.join(', ')} | - | - | - | - | - | - | ${statusLabel} (${metadata.account}, ${metadata.flow}) | - |`;
  await appendFile(trackerPath, row + '\n');
}

async function updateExperimentLog(metadata: PostMetadata): Promise<void> {
  if (!metadata.experimentId || !metadata.variant) return;

  const logPath = dataPath('EXPERIMENT-LOG.md');
  let content = await readFile(logPath, 'utf-8').catch(() => '');

  if (metadata.variant === 'A' && !content.includes(`Experiment #${metadata.experimentId}`)) {
    const allStyles = ['question', 'bold_claim', 'story_opener', 'stat_lead', 'contrast'];
    const otherStyles = allStyles.filter((s) => s !== metadata.hookStyle);
    const variantB = otherStyles[Math.floor(Math.random() * otherStyles.length)];

    const entry = `
### Experiment #${metadata.experimentId} — ${metadata.createdAt.slice(0, 10)}
- **Hypothesis:** ${metadata.hookStyle} hooks vs ${variantB} hooks in study tips niche
- **Variant A:** ${metadata.hookStyle} hook — Post ID: pending
- **Variant B:** ${variantB} hook — Post ID: pending
- **Status:** IN PROGRESS — waiting for both variants + 48h data
`;

    if (content.includes('## Active Experiment')) {
      content = content.replace(
        /## Active Experiment\n[\s\S]*?(?=\n## Completed|$)/,
        `## Active Experiment\n${entry}\n`,
      );
    } else {
      content += `\n## Active Experiment\n${entry}\n`;
    }

    const { writeFile } = await import('fs/promises');
    await ensureDir(logPath);
    await writeFile(logPath, content);
    log(`Created experiment #${metadata.experimentId}`);
  }
}

export interface PostResult {
  accountName: string;
  integrationId: string;
  postId: string;
  flow: string;
}

export async function postSlideshow(
  slidePaths: string[],
  caption: string,
  hookTitle: string,
  metadata: PostMetadata,
  useCta: boolean,
  accountIndex: number,
  // Default deliberately 'draft' — accidentally calling this without
  // an explicit postingPath arg should never live-post to TikTok. Direct
  // posts always require an explicit '--path=direct' from the operator
  // (main.ts forwards the CLI flag through to here). Flipping the
  // default is behavior-neutral for existing callers (they all pass it
  // explicitly) but adds a safety net for any future caller that forgets.
  postingPath: PostingPath = 'draft',
  scheduleDate?: Date,
): Promise<PostResult> {
  const account = config.tiktokAccounts[accountIndex];
  log(`--- Posting to ${account.name} (${metadata.flow}) [${postingPath}] via blotato ---`);

  const allPaths = [...slidePaths];

  // Resolve Blotato account ID for this TikTok handle
  const blotAccounts = await fetchBlotAccountIds();
  const blotId = blotAccounts.get(account.handle.toLowerCase());

  if (!blotId) {
    throw new Error(`Blotato: no TikTok account found for ${account.handle}. Connect it at https://my.blotato.com`);
  }

  // Upload local images to get public URLs (Blotato requires public URLs)
  log(`  Uploading ${allPaths.length} slides to get public URLs...`);
  const mediaUrls: string[] = [];
  for (let i = 0; i < allPaths.length; i++) {
    const url = await uploadImage(allPaths[i]);
    mediaUrls.push(url);
    log(`    Slide ${i + 1}/${allPaths.length} uploaded`);
  }
  log(`  All ${mediaUrls.length} slides hosted`);
  const isDraft = postingPath === 'draft';
  const result = await postViaBlotato(blotId, mediaUrls, caption, hookTitle, isDraft, scheduleDate);
  const postId = result.postSubmissionId;
  log(`  Blotato: ${isDraft ? 'TikTok draft' : 'direct post'} submitted: ${postId}`);

  if (!postId) throw new Error(`No postId returned for ${account.name}`);

  await trackPost(postId, metadata, postingPath);

  // Cache the first slide's public URL on the posts row as the post
  // thumbnail so the dashboard's Top Posts cards + drawer can render
  // a real first-slide image instead of a placeholder gradient.
  // Blotato hosts these URLs so TikTok itself can fetch them — they're
  // public + stable.
  if (mediaUrls[0]) {
    try {
      const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (sbUrl && sbKey) {
        const { createClient } = await import('@supabase/supabase-js');
        const sb = createClient(sbUrl, sbKey);
        await sb.from('posts')
          .update({ thumbnail_url: mediaUrls[0] })
          .eq('id', postId);
      }
    } catch {
      // Non-fatal — the backfill script can fill this in later via oembed.
    }
  }

  return { accountName: account.name, integrationId: account.id, postId, flow: metadata.flow };
}

export async function postAllDrafts(
  postData: {
    slidePaths: string[];
    caption: string;
    title: string;
    metadata: PostMetadata;
    useCta: boolean;
    accountIndex: number;
  }[],
  // Default deliberately 'draft' — accidentally calling this without
  // an explicit postingPath arg should never live-post to TikTok. Direct
  // posts always require an explicit '--path=direct' from the operator
  // (main.ts forwards the CLI flag through to here). Flipping the
  // default is behavior-neutral for existing callers (they all pass it
  // explicitly) but adds a safety net for any future caller that forgets.
  postingPath: PostingPath = 'draft',
  scheduleDate?: Date,
  /**
   * Optional cycle_runs.id — when present, per-account submission errors
   * are written to cycle_events as kind='post_failed' so the dashboard's
   * Live Runs timeline shows the actual reason instead of the bare
   * "0 submissions completed" final message. Without this, the only
   * trace of a submission failure is a row in auto_fix_events that the
   * operator has to dig into.
   */
  runId?: string | null,
  /**
   * Stagger interval in minutes. When > 0, post N on each account
   * is scheduled at:
   *   scheduleDate + (N-1) * postIntervalMinutes
   * Indexing is per-account: each account starts its own count from 0,
   * so multiple accounts run in parallel rather than serially. 0 = all
   * posts go at scheduleDate (legacy behaviour).
   */
  postIntervalMinutes: number = 0,
): Promise<PostResult[]> {
  const pathLabel = postingPath === 'draft' ? 'TikTok drafts' : 'direct posts';
  log(`=== POSTING PHASE — ${pathLabel} via Blotato ===`);

  // Track how many posts each account has already had scheduled so we
  // can stagger by (count × interval) per account independently.
  const accountPostCount = new Map<number, number>();
  const results: PostResult[] = [];
  let firstExperimentLogged = false;

  for (const data of postData) {
    try {
      // Per-account schedule = base scheduleDate + (postsSoFarOnThisAccount × interval).
      // When interval = 0 OR scheduleDate is undefined, the base date
      // is used unchanged (or undefined = no scheduling, legacy path).
      const slot = accountPostCount.get(data.accountIndex) ?? 0;
      const perPostSchedule =
        scheduleDate && postIntervalMinutes > 0
          ? new Date(scheduleDate.getTime() + slot * postIntervalMinutes * 60 * 1000)
          : scheduleDate;
      accountPostCount.set(data.accountIndex, slot + 1);

      const result = await postSlideshow(
        data.slidePaths,
        data.caption,
        data.title,
        data.metadata,
        data.useCta,
        data.accountIndex,
        postingPath,
        perPostSchedule,
      );
      results.push(result);

      if (!firstExperimentLogged && data.metadata.experimentId) {
        await updateExperimentLog(data.metadata);
        firstExperimentLogged = true;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const accountLabel = data.metadata.account || `account[${data.accountIndex}]`;
      log(`Failed to post to ${accountLabel}: ${errMsg}`);

      // Surface to the dashboard timeline (cycle_events). Best-effort —
      // never blocks the rest of the loop. This is what was missing
      // when BOTAI's first cycle showed "0 submissions completed" with
      // no explanation: the ENOENT thrown inside trackPost was caught
      // here but never written where the operator could see it.
      if (runId) {
        try {
          await reportEvent(runId, 'post_failed', `Post failed → ${accountLabel}`, errMsg, {
            account: data.metadata.account,
            flow: data.metadata.flow,
          });
        } catch { /* never block the cycle on reporter failure */ }
      }

      // Also surface through the auto-fix system so signatures dedup-
      // notify (HUMAN-ONLY tier fires Slack/file alerts) and the
      // Errors & Auto-Fix page picks them up.
      try {
        const classified = classifyError(
          err instanceof Error ? err : new Error(String(err)),
          { source: 'blotato', url: `${config.blotato.baseUrl}/posts` },
        );
        await logClassified(classified, { handled: 'pending' });
        await maybeNotify(classified);
      } catch { /* notification path itself failed — non-fatal */ }
    }
  }

  log(`=== POSTING COMPLETE — ${results.length} ${pathLabel} created ===`);
  return results;
}
