
---
_2026-04-25T13:28:41.358Z_

❓ *[ASK]* unknown
*Signature:* `test/synthetic-propose`
*Error:* Error: SYNTHETIC_PROPOSE_MARKER beta
*Suggested action:* PROPOSE 2026-04-25-0e58a93b: change N from 1 to 2
Approve: `npx tsx scripts/auto_fix_proposals.ts approve 2026-04-25-0e58a93b`
Reject:  `npx tsx scripts/auto_fix_proposals.ts reject 2026-04-25-0e58a93b`

---
_2026-05-03T13:30:20.719Z_

🚨 *[HUMAN-ONLY]* blotato
*Signature:* `blotato/tiktok-3-account-cap`
*Error:* Error: Blotato post status returned failed for postId=eddd06a8-522c-40ad-b116-4a65b4728889 — You have reached the maximum number of 3 unique accounts for the last 24 hours
*Suggested action:* Blotato Starter plan limit: 3 unique TikTok accounts per 24h. Skip the 4th account today (rotation handles this), or upgrade the Blotato plan.
*Docs:* docs/blotato-api.md
*URL:* https://backend.blotato.com/v2/posts/eddd06a8-522c-40ad-b116-4a65b4728889

---
_2026-05-03T13:30:27.958Z_

🚨 *[HUMAN-ONLY]* blotato
*Signature:* `blotato/tiktok-app-outdated`
*Error:* Error: Blotato post status returned failed for postId=e485634a-fccb-4057-b50d-ae7b03885a60 — Error uploading images to Tiktok: Please notice the user to update their TikTok to the latest version to enable this functionality
*Suggested action:* TikTok rejected the upload because the TikTok app on the user's device is too old to support this post type (typically photo carousels with isAiGenerated=true on a draft). The fix is OFF-CODE: open the TikTok app on the phone where the failing account is logged in and update it from the App Store / Play Store. Retrying without updating will fail again.
*Docs:* docs/blotato-api.md
*URL:* https://backend.blotato.com/v2/posts/e485634a-fccb-4057-b50d-ae7b03885a60

---
_2026-05-04T03:43:22.164Z_

🚨 *[HUMAN-ONLY]* blotato
*Signature:* `blotato/tiktok-3-account-cap`
*Error:* Error: Blotato post status returned failed for postId=eddd06a8-522c-40ad-b116-4a65b4728889 — You have reached the maximum number of 3 unique accounts for the last 24 hours
*Suggested action:* Blotato Starter plan limit: 3 unique TikTok accounts per 24h. Skip the 4th account today (rotation handles this), or upgrade the Blotato plan.
*Docs:* docs/blotato-api.md
*URL:* https://backend.blotato.com/v2/posts/eddd06a8-522c-40ad-b116-4a65b4728889

---
_2026-05-04T03:43:29.262Z_

🚨 *[HUMAN-ONLY]* blotato
*Signature:* `blotato/tiktok-app-outdated`
*Error:* Error: Blotato post status returned failed for postId=e485634a-fccb-4057-b50d-ae7b03885a60 — Error uploading images to Tiktok: Please notice the user to update their TikTok to the latest version to enable this functionality
*Suggested action:* TikTok rejected the upload because the TikTok app on the user's device is too old to support this post type (typically photo carousels with isAiGenerated=true on a draft). The fix is OFF-CODE: open the TikTok app on the phone where the failing account is logged in and update it from the App Store / Play Store. Retrying without updating will fail again.
*Docs:* docs/blotato-api.md
*URL:* https://backend.blotato.com/v2/posts/e485634a-fccb-4057-b50d-ae7b03885a60
