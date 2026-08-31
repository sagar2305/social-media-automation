# Agent 07 — Content Bank and website release

You own only the handoff from the unified completed content package—website
article, completed video pair, and/or fully validated six-slide slideshow—into
the Creddy Content Bank.

Article-only packages enter the same Content Bank with `mediaType=article` and
an independent article review state. They never require rendered videos or a
slideshow manifest. Asset completeness remains mandatory before the automatic
website release.

1. Run `npm run creddy:pipeline -- agent-7-bank`.
2. Reconcile each content package only when the same revision has both a completed `text_music` video and a completed `narrated` video.
3. For slideshow items, accept only a deterministic render with exactly six
   readable 1080×1440 PNGs, a passing manifest, five distinct approved
   expressions across slides 1–5, and approved real phone proof on slide 6.
4. Create one idempotent `pending_review` record per complete video pair or valid
   slideshow. Never create both twice for the same stable content/revision ID.
5. Refresh the observable reports and state how many items are pending, awaiting changes, approved, scheduled, rejected, and published.
6. Keep slideshow/social approval human-controlled. For an asset-complete website article, immediately invoke Agent 8 and durably record published or publish-failed state.
7. For every newly created slideshow review record, send exactly one Agent 7
   review message to the configured Slack channel. Attach all six slides and
   include Approve, Reject, and View full review actions. Persist the Slack
   receipt so reruns never duplicate the message. Approval and rejection remain
   explicit human actions; Agent 7 never decides for the reviewer.
8. Keep the website article on the same Content Bank record as its social assets.
   Show its themed desktop/mobile preview, article blocks, planned assets,
   sources, claims, referral registry IDs, advertiser disclosure, subscription
   consent text, and app-download URLs. Article auto-publishing is independent of
   Instagram/TikTok approval, but both retain the same stable content identity.
   Send one separate idempotent Slack article review with only a self-contained
   HTML preview whose approved 16:9 images are embedded. Do not upload those
   images separately or allow source media unfurls. Use the
   `creddy_website_delete` action after publication or `creddy_website_repost`
   after deletion/failure; never reuse social approval for a website action.
9. An article with missing assets remains `needs_assets`. Agent 7 may present it
   for feedback but may not mark it publish-ready. Agent 8 starts automatically
   only after every article asset and validation is complete.
10. Show the official-verification status, attempted official URLs, unresolved
    claims, and failure reasons in the private portal and Slack review. Never add
    those warnings to public slide copy. Blog release may continue for unavailable
    or inconclusive verification. Social approval must use the distinct audited
    `Facts verified and approve` action until the gate is satisfied. A known official
    conflict blocks both release paths.
  - If official evidence conflicts, retain the item in review. To correct it,
    create an audited request with `decisionId`, `reopenedBy`, and a 10–2000
    character `reason`, run `reopen-official-conflict <file>`, then rerun Agent 03
    analysis and official verification followed by Agents 04–07. The stable IDs
    are regenerated only when the corrected claims and gate differ. Never use the
    factual-confirmation button to override a known official contradiction.

The reviewer must be able to inspect both videos, scripts, platform captions, CTA, factual claims, and source URLs in the dashboard before deciding.
