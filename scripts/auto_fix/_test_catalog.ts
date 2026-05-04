/**
 * Smoke test — feeds historical errors into the catalog and verifies the
 * correct entry fires for each. Run: npx tsx scripts/auto_fix/_test_catalog.ts
 * Delete after verification.
 */

import { lookupCatalogEntry, signatureFor } from './error_catalog.js';

const cases = [
  {
    name: 'Gemini spending cap',
    input: {
      message:
        'Gemini API 429: { "error": { "code": 429, "message": "Your project has exceeded its monthly spending cap. Please go to AI Studio...", "status": "RESOURCE_EXHAUSTED" } }',
      source: 'gemini' as const,
      status: 429,
    },
    expectId: 'gemini/monthly-spending-cap',
  },
  {
    name: 'Gemini transient 429 (no spending-cap phrasing)',
    input: {
      message: 'Gemini API 429: { "error": { "status": "RESOURCE_EXHAUSTED" } }',
      source: 'gemini' as const,
      status: 429,
    },
    expectId: 'gemini/resource-exhausted-transient',
  },
  {
    name: 'Gemini fetch failed',
    input: { message: 'TypeError: fetch failed', source: 'gemini' as const },
    expectId: 'gemini/fetch-failed',
  },
  {
    name: 'Blotato 3-accounts cap',
    input: {
      message:
        'You have reached the maximum number of 3 unique accounts for the last 24 hours',
      source: 'blotato' as const,
    },
    expectId: 'blotato/tiktok-3-account-cap',
  },
  {
    name: 'Blotato media conversion failed',
    input: { message: 'Media conversion failed', source: 'blotato' as const },
    expectId: 'blotato/media-conversion-failed',
  },
  {
    name: 'Blotato internal TypeError',
    input: {
      message:
        "Internal error: TypeError: Cannot read properties of undefined (reading 'status')",
      source: 'blotato' as const,
    },
    expectId: 'blotato/internal-typeerror-status',
  },
  {
    name: 'Blotato rate limit',
    input: { message: 'Rate limit exceeded, retry in 49 seconds', source: 'blotato' as const, status: 429 },
    expectId: 'blotato/rate-limit-generic',
  },
  {
    name: 'ScrapeCreators out of credits',
    input: {
      message: "Looks like you're out of credits :( You'll need to buy more",
      source: 'scrapeCreators' as const,
      status: 402,
    },
    expectId: 'scrapeCreators/out-of-credits',
  },
  {
    name: 'tmpfiles 502',
    input: { message: 'tmpfiles upload failed: 502', source: 'tmpfiles' as const },
    expectId: 'tmpfiles/5xx',
  },
  {
    name: 'catbox empty',
    input: { message: 'catbox returned non-URL:', source: 'catbox' as const },
    expectId: 'catbox/empty-response',
  },
  {
    name: 'Unknown error — still produces a signature',
    input: { message: 'Some novel failure mode we have never seen' },
    expectId: null,
  },
];

let pass = 0;
let fail = 0;

for (const c of cases) {
  const entry = lookupCatalogEntry(c.input);
  const sig = signatureFor(entry, c.input.message);
  const actualId = entry?.id ?? null;
  const ok = actualId === c.expectId;
  if (ok) pass++;
  else fail++;
  console.log(
    `${ok ? '✓' : '✗'}  ${c.name}`,
    '\n    expected:',
    c.expectId,
    '\n    got:     ',
    actualId,
    '\n    tier:    ',
    entry?.tier ?? '(unknown)',
    '\n    sig:     ',
    sig,
  );
}

console.log(`\n${pass}/${pass + fail} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
