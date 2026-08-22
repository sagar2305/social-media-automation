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
same order. Use only the real Creddy asset-pack poses: `neutral`, `waving`,
`thinking`, `idea`, `worried`, `surprised`, `sleepy`, `starstruck`, `sad`,
`wink`, `card`, `thumbs-up`, `guide`, `rewards`, or `celebrate`. Match the
mascot pose to the scene; use `surprised` only for genuinely urgent updates,
`worried` for negative changes/devaluations, and `guide` for instructional CTAs.

If a revision request exists, address only the requested factual, script, visual,
or caption changes and preserve the revision trail. After normal opportunities,
also process every entry from `npm run creddy:pipeline -- revision-pending` and
submit its corrected package through
`npm run creddy:pipeline -- accept-revision <file>`. Revised packages create new
versioned render jobs; never reuse the old videos. Never publish or schedule;
human approval in the dashboard is mandatory.
