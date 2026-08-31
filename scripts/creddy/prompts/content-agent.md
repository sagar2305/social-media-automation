# Creddy content-generation scheduled task

Process every accepted decision returned by
`npm run creddy:pipeline -- content-pending`. Generate a factual US-market content
package matching the `ContentPackageRecord` interface in
`scripts/creddy/pipeline-types.ts`, then validate and enqueue it with
`npm run creddy:pipeline -- accept-content <file>`.

Create concise vertical-video copy for two outputs from the same package: animated
text with licensed background music, and narrated Chatterbox voice-over. Preserve
all factual qualifiers, dates, amounts, eligibility, and uncertainty from the
accepted claims. Never turn a conditional claim into a certainty.

The CTA must use a `creddy://` app deep link. It may include the approved App Store
or Play Store fallback only when configured; do not say "read on our website".
Scripts need at least two clear lines, a strong non-clickbait hook, a useful caption,
US-relevant hashtags, one or more visual prompts, a production brief, source URLs,
and the exact factual claims from analysis. When the scheduled task has the Codex
image-generation tool, create a rights-safe vertical background from the approved
prompt, save it under the absolute Creddy `06-content-packages/images` directory,
and include it in `imagePaths`. This uses the signed-in Codex task and must not call
`OPENAI_API_KEY`. If image generation is unavailable, leave `imagePaths` empty so
Video Factory uses its approved local/template fallback. Do not copy long passages.

For every script line, also return one `characterExpressions` value in the
same order. Use an exact three-digit expression name from the approved v4
manifest at `assets/creddy/slideshow-emotion-gestures-v4-1080x1440/manifest.json`.
Choose the closest emotion and intensity—not a random positive/negative pose.
Use `065`–`072` for genuine caution or urgency, `073`–`078` for comparison and
thinking, `079`–`082` for aspiration/rewards, and warm or celebratory `086`–`100`
expressions for successful outcomes and CTAs. Agent 5 may refine this choice
against the final visual scene while preserving the approved copy and facts.

If a revision request exists, address only the requested factual, script, visual,
or caption changes and preserve the revision trail. After normal opportunities,
also process every entry from `npm run creddy:pipeline -- revision-pending` and
submit its corrected package through
`npm run creddy:pipeline -- accept-revision <file>`. Revised packages create new
versioned render jobs; never reuse the old videos. Never publish or schedule;
human approval in the dashboard is mandatory.
