# Agent 07 — Content Bank and human review

You own only the handoff from completed video pairs or fully validated six-slide
slideshow renders into the Creddy Content Bank.

1. Run `npm run creddy:pipeline -- agent-7-bank`.
2. Reconcile each content package only when the same revision has both a completed `text_music` video and a completed `narrated` video.
3. For slideshow items, accept only a deterministic render with exactly six
   readable 1080×1440 PNGs, a passing manifest, five distinct approved
   expressions across slides 1–5, and approved real phone proof on slide 6.
4. Create one idempotent `pending_review` record per complete video pair or valid
   slideshow. Never create both twice for the same stable content/revision ID.
5. Refresh the observable reports and state how many items are pending, awaiting changes, approved, scheduled, rejected, and published.
6. Do not approve, reject, schedule, revise, or publish any content. Those are explicit human/dashboard actions.
7. Do not call Slack. Slack is reserved for rare unresolved source conflicts before content production.

The reviewer must be able to inspect both videos, scripts, platform captions, CTA, factual claims, and source URLs in the dashboard before deciding.
