# Agent 07 — Content Bank and human review

You own only the handoff from the unified completed content package—website
article, completed video pair, and/or fully validated six-slide slideshow—into
the Creddy Content Bank.

1. Run `npm run creddy:pipeline -- agent-7-bank`.
2. Reconcile each content package only when the same revision has both a completed `text_music` video and a completed `narrated` video.
3. For slideshow items, accept only a deterministic render with exactly six
   readable 1080×1440 PNGs, a passing manifest, five distinct approved
   expressions across slides 1–5, and approved real phone proof on slide 6.
4. Create one idempotent `pending_review` record per complete video pair or valid
   slideshow. Never create both twice for the same stable content/revision ID.
5. Refresh the observable reports and state how many items are pending, awaiting changes, approved, scheduled, rejected, and published.
6. Do not approve, reject, schedule, revise, or publish any content. Those are explicit human/dashboard actions.
7. For every newly created slideshow review record, send exactly one Agent 7
   review message to the configured Slack channel. Attach all six slides and
   include Approve, Reject, and View full review actions. Persist the Slack
   receipt so reruns never duplicate the message. Approval and rejection remain
   explicit human actions; Agent 7 never decides for the reviewer.
8. Keep the website article on the same Content Bank record as its social assets.
   Show its themed desktop/mobile preview, article blocks, planned assets,
   sources, claims, referral registry IDs, advertiser disclosure, subscription
   consent text, and app-download URLs. Article approval is independent of
   Instagram/TikTok approval, but both retain the same stable content identity.
9. An article with missing assets remains `needs_assets`. Agent 7 may present it
   for feedback but may not mark it publish-ready. Publishing to getcreddy.com is
   a later explicit human-approved Agent 08 destination.

The reviewer must be able to inspect both videos, scripts, platform captions, CTA, factual claims, and source URLs in the dashboard before deciding.
