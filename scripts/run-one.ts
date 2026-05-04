import { log } from './api-client.js';
import { generateContent, resetUsedTemplates } from './text_overlay.js';
import { generateSlidesForPost } from './generate_images.js';
import { readFile } from 'fs/promises';
import { config } from '../config/config.js';
import { apiRequest } from './api-client.js';
import { unlink } from 'fs/promises';

interface BlotAccountsResponse {
  items: { id: string; platform: string; username?: string }[];
}

async function resolveBlotAccountId(handle: string): Promise<string> {
  const data = await apiRequest<BlotAccountsResponse>(
    'blotato',
    '/users/me/accounts?platform=tiktok',
  );
  const match = data.items.find((a) => a.username?.toLowerCase() === handle.toLowerCase());
  if (!match) throw new Error(`No Blotato TikTok account found for ${handle}`);
  return match.id;
}

async function run() {
  log('=== SINGLE FLOW 3 (EMOJI OVERLAY) POST ===');
  resetUsedTemplates();

  const content = await generateContent('emoji_overlay', 0);
  const slidePaths = await generateSlidesForPost(content);

  const account = config.tiktokAccounts[0]; // @yournotetaker
  const blotId = await resolveBlotAccountId(account.handle);

  // Post as draft via Blotato
  log(`Posting ${slidePaths.length} slides as TikTok draft via Blotato...`);

  const res = await apiRequest<{ postSubmissionId: string }>('blotato', '/posts', {
    method: 'POST',
    body: {
      post: {
        accountId: blotId,
        content: {
          text: content.caption,
          mediaUrls: slidePaths,
          platform: 'tiktok',
        },
        target: {
          targetType: 'tiktok',
          privacyLevel: 'PUBLIC_TO_EVERYONE',
          disabledComments: false,
          disabledDuet: false,
          disabledStitch: false,
          isBrandedContent: false,
          isYourBrand: false,
          isAiGenerated: true,
          isDraft: true,
          autoAddMusic: true,
          title: content.title.slice(0, 90),
        },
      },
    },
  });

  log(`\n=== POST SUBMITTED ===`);
  log(`Flow: emoji_overlay (Flow 3)`);
  log(`Account: ${account.name}`);
  log(`Blotato ID: ${res.postSubmissionId}`);
  log(`Template: "${content.title}"`);
  log(`Slides: ${slidePaths.length}`);

  // Cleanup temp slides
  for (const p of slidePaths) await unlink(p).catch(() => {});
  log('Temp files cleaned up');
}

run().catch((err) => {
  log(`FAILED: ${err}`);
  process.exit(1);
});
