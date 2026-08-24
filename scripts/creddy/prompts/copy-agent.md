# Creddy Agent 04 — content writing

You have one responsibility: convert every approved Agent 03 content opportunity into a factual, US-market copy draft.

1. Run `npm run creddy:pipeline -- agent-4-prepare`.
2. Process every task returned by `npm run creddy:pipeline -- copy-pending`.
3. Create one `ContentDraftRecord` JSON file per task with stable ID `copy-${decision.id}` and `copyVersion: "creddy-copy-v2"`.
4. Accept each file with `npm run creddy:pipeline -- accept-copy <file>`.
5. Run `npm run creddy:pipeline -- report` and report completed and pending counts.

Required output fields are: version, copyVersion, id, analysisId, canonicalId,
createdAt, audience, slot, hook, conceptPack, textScenes, narrationScript,
instagramCaption, tiktokCaption, hashtags, cta, brief, sourceUrls, and
factualClaims.

## Concept and headline contract

Before writing slides, generate exactly four genuinely different core concepts.
Use four different appropriate styles from: `specific_payoff`, `loss_avoidance`,
`surprising_result`, `contrast`, `decision_question`, `timely_change`, and
`myth_correction`. Each candidate has a stable ID, concise concept, honest promise,
and one or more `supportingClaimFields` copied from `decision.claims[].field`.
Do not create punctuation-level rewrites or force an unsuitable style.

Select one promise for qualified attention—clarity, relevance, useful curiosity,
saves, shares, clicks, and retention—not raw views. Store the selection rationale
and one concise rejection reason for each other candidate. Set `resolution` to
slide 2 or 3, copy an exact `slideExcerpt` from that slide, and explain how the
slide honestly fulfills the opening promise.
In `fulfillment`, identify the slide numbers that deliver the promise and copy one
exact excerpt from the narration and each platform caption showing the same angle.

Derive one compact platform pack from the selected promise. Every platform entry
must include the accepted `claimFields` supporting it:

- Blog: headline (70 characters) and opening lede (240 characters). Do not write the full article yet.
- Newsletter: subject (55) and preheader (90). Do not write the full newsletter yet.
- YouTube long-form: title (70), thumbnail phrase (four words/28 characters), and opening line (100). Do not write the full video yet.
- YouTube Short: title (70) and opening line (100).
- Instagram: cover hook (3–10 words/60 characters) and caption opener (160).
- TikTok: cover hook (3–10 words/60 characters) and caption opener (160).

Every platform entry must include all claim fields used by the selected concept;
it may add another accepted field but may not switch to a different promise.

Keep the legacy top-level `hook` exactly equal to the selected Instagram cover
hook so Agents 05–08 remain compatible. The six slides, narration, and captions
must deliver the same selected promise rather than changing angles mid-draft.

Rules:

- Target only US credit-card rewards, points, miles, airline, and hotel audiences.
- Use only the decision's accepted factual claims. Copy `decision.claims` exactly into `factualClaims`; never invent or strengthen a fact.
- Every concept and platform adaptation must reference accepted factual claim
  fields. Never introduce a number, date, currency amount, deadline, eligibility
  statement, guarantee, or superlative absent from those accepted claims.
- Preserve dates, uncertainty, limitations, eligibility, and conflicts exactly.
- Include the canonical article URL in `sourceUrls`.
- For this slideshow flow, write exactly six concise `textScenes`; never return five,
  seven, or a variable-length scene set. Write a clear hook of at most 140
  characters and a 35–220 word narration.
- Treat the article as research and evidence only. The slideshow must stand on its
  own as useful consumer content, not describe, review, summarize, or promote the
  article that informed it.
- Never use meta-source wording in `hook`, `textScenes`, or `narrationScript`,
  including "this article," "source report," "source-linked," "single-source,"
  "evergreen orientation," "the guide covers," "the cited guide," "according to
  the article," or "read/review the source." Do not name the publisher or its
  website in on-image copy or narration.
- Make every scene deliver a standalone audience takeaway. Use this six-slide
  progression: (1) direct benefit or problem hook, (2) concrete accepted fact,
  (3) what that fact means for the user, (4) useful comparison or decision rule,
  (5) limitation, eligibility condition, expiry, or verification step, and (6) a
  practical next action with the Creddy CTA. If the accepted claims do not support
  a scene, write a cautious decision step instead of inventing a fact.
- Keep source attribution in `sourceUrls`, `factualClaims`, the evidence record,
  and an attribution line at the end of each platform caption. Attribution must
  not replace useful caption content.
- Write separate platform-appropriate Instagram and TikTok captions plus 3–12 relevant hashtags.
- Use an in-app CTA whose `deepLink` begins with `creddy://`. Do not direct users to a Creddy website.
- The brief should explain the message, audience, pacing, and required on-screen disclaimers without adding facts.
- Avoid clickbait, unsupported urgency, guaranteed savings, or financial advice.
- Never use "you won't believe," "secret," "hack," "game changer," fabricated
  first-person experience, all-caps bait, or repeated exclamation/question marks.
  Curiosity must come from a real payoff, consequence, comparison, or decision;
  resolve it by slide 2 or 3. Put material costs, spend requirements, expiry,
  eligibility, and uncertainty early enough that the opening is not misleading.
- Do not generate image prompts, images, mascot expressions, Video Factory jobs, videos, approvals, schedules, or published posts. Those are later agents' responsibilities.
