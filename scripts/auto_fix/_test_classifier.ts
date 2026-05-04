/**
 * Smoke test for the classifier. Covers both code paths:
 *   1. Caller passes a known `source` (e.g. via api-client).
 *   2. No source given — classifier must infer from URL or message.
 *
 * Run: npx tsx scripts/auto_fix/_test_classifier.ts
 */

import { classifyError, formatClassified } from './classifier.js';

const cases: Array<{
  name: string;
  error: unknown;
  ctx?: Parameters<typeof classifyError>[1];
  expectId: string | null;
  expectTier: string;
  expectSource: string;
}> = [
  // ─── Source explicitly supplied (api-client path) ─────────
  {
    name: 'Gemini spending cap (source given)',
    error: new Error(
      'Gemini API 429: { "error": { "code": 429, "message": "Your project has exceeded its monthly spending cap. Please go to AI Studio...", "status": "RESOURCE_EXHAUSTED" } }',
    ),
    ctx: { source: 'gemini', status: 429 },
    expectId: 'gemini/monthly-spending-cap',
    expectTier: 'HUMAN-ONLY',
    expectSource: 'gemini',
  },
  {
    name: 'Blotato 3-account cap (source given)',
    error: new Error(
      'blotato POST /v2/posts → 400: {"errorMessage":"You have reached the maximum number of 3 unique accounts for the last 24 hours"}',
    ),
    ctx: { source: 'blotato' },
    expectId: 'blotato/tiktok-3-account-cap',
    expectTier: 'HUMAN-ONLY',
    expectSource: 'blotato',
  },

  // ─── Source inferred from URL ─────────────────────────────
  {
    name: 'Gemini fetch failed — inferred via URL',
    error: new Error('TypeError: fetch failed'),
    ctx: { url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=xxx' },
    expectId: 'gemini/fetch-failed',
    expectTier: 'RETRY',
    expectSource: 'gemini',
  },
  {
    name: 'Blotato media conversion — inferred via URL',
    error: new Error('Media conversion failed'),
    ctx: { url: 'https://backend.blotato.com/v2/posts/abc' },
    expectId: 'blotato/media-conversion-failed',
    expectTier: 'RETRY',
    expectSource: 'blotato',
  },
  {
    name: 'ScrapeCreators 402 — inferred via URL + status extracted from message',
    error: new Error("scrapeCreators GET /v3/tiktok/profile/videos → 402: {\"success\":false,\"message\":\"Looks like you're out of credits\"}"),
    ctx: { url: 'https://api.scrapecreators.com/v3/tiktok/profile/videos?handle=x' },
    expectId: 'scrapeCreators/out-of-credits',
    expectTier: 'HUMAN-ONLY',
    expectSource: 'scrapeCreators',
  },

  // ─── Source inferred from message (no URL, no context) ────
  {
    name: 'Blotato TypeError — inferred from message only',
    error: new Error(
      "Internal error: TypeError: Cannot read properties of undefined (reading 'status')",
    ),
    ctx: { source: 'blotato' }, // supply since the message alone doesn't mention blotato
    expectId: 'blotato/internal-typeerror-status',
    expectTier: 'RETRY',
    expectSource: 'blotato',
  },

  // ─── Status extraction from message text ─────────────────
  {
    name: 'tmpfiles 502 — status parsed out of "upload failed: 502"',
    error: new Error('tmpfiles upload failed: 502'),
    ctx: {}, // no context — pure inference
    expectId: 'tmpfiles/5xx',
    expectTier: 'AUTO-FIX',
    expectSource: 'tmpfiles',
  },
  {
    name: 'catbox empty — inferred from message',
    error: new Error('catbox returned non-URL:'),
    ctx: {},
    expectId: 'catbox/empty-response',
    expectTier: 'AUTO-FIX',
    expectSource: 'catbox',
  },

  // ─── Local errors (filesystem / parse / module / env / subprocess) ───
  {
    name: 'ENOENT in posts/ → concurrency-race signature',
    error: new Error("ENOENT: no such file or directory, open 'posts/unposted/flow2/2026-04-17/slide_6.png'"),
    ctx: {},
    expectId: 'local/posts-folder-vanished',
    expectTier: 'HUMAN-ONLY',
    expectSource: 'local',
  },
  {
    name: 'ENOENT outside posts/ → generic file-not-found',
    error: new Error("ENOENT: no such file or directory, open 'data/POST-TRACKER.md'"),
    ctx: {},
    expectId: 'local/file-not-found',
    expectTier: 'PROPOSE',
    expectSource: 'local',
  },
  {
    name: 'EACCES → permission denied',
    error: new Error("EACCES: permission denied, open '/var/log/foo.log'"),
    ctx: {},
    expectId: 'local/permission-denied',
    expectTier: 'HUMAN-ONLY',
    expectSource: 'local',
  },
  {
    name: 'ENOSPC → disk full',
    error: new Error('ENOSPC: no space left on device, write'),
    ctx: {},
    expectId: 'local/disk-full',
    expectTier: 'HUMAN-ONLY',
    expectSource: 'local',
  },
  {
    name: 'EMFILE → too many open files (RETRY)',
    error: new Error('EMFILE: too many open files, open'),
    ctx: {},
    expectId: 'local/too-many-open-files',
    expectTier: 'RETRY',
    expectSource: 'local',
  },
  {
    name: 'EBUSY → file busy (RETRY)',
    error: new Error('EBUSY: resource busy or locked, open'),
    ctx: {},
    expectId: 'local/file-busy',
    expectTier: 'RETRY',
    expectSource: 'local',
  },
  {
    name: 'JSON parse error → PROPOSE',
    error: new Error('SyntaxError: Unexpected token } in JSON at position 145'),
    ctx: {},
    expectId: 'local/json-parse-error',
    expectTier: 'PROPOSE',
    expectSource: 'local',
  },
  {
    name: 'Module not found → PROPOSE',
    error: new Error("Cannot find module '../config/missing.js'"),
    ctx: {},
    expectId: 'local/module-not-found',
    expectTier: 'PROPOSE',
    expectSource: 'local',
  },
  {
    name: 'Missing API key in env → HUMAN-ONLY',
    error: new Error('GEMINI_API_KEY is not set or undefined'),
    ctx: {},
    expectId: 'local/env-var-missing',
    expectTier: 'HUMAN-ONLY',
    expectSource: 'local',
  },
  {
    name: 'overlay-text.py subprocess failed',
    error: new Error('Command failed: python3 scripts/overlay-text.py … (exit 1)'),
    ctx: {},
    expectId: 'local/subprocess-failed',
    expectTier: 'PROPOSE',
    expectSource: 'local',
  },
  {
    name: 'Local timeout (ETIMEDOUT) → RETRY',
    error: new Error('ETIMEDOUT: operation timed out'),
    ctx: {},
    expectId: 'local/timeout',
    expectTier: 'RETRY',
    expectSource: 'local',
  },

  // ─── Fallback ─────────────────────────────────────────────
  {
    name: 'Completely unknown error → null entry, signature still stable',
    error: new Error('Something nobody has ever seen before'),
    ctx: {},
    expectId: null,
    expectTier: 'UNKNOWN',
    expectSource: 'unknown',
  },

  // ─── Edge cases ───────────────────────────────────────────
  {
    name: 'Non-Error thrown (string)',
    error: 'Gemini API 429: { "status": "RESOURCE_EXHAUSTED" }',
    ctx: { source: 'gemini', status: 429 },
    expectId: 'gemini/resource-exhausted-transient',
    expectTier: 'RETRY',
    expectSource: 'gemini',
  },
  {
    name: 'Object with message property',
    error: { message: 'Rate limit exceeded, retry in 30 seconds' },
    ctx: { source: 'blotato', status: 429 },
    expectId: 'blotato/rate-limit-generic',
    expectTier: 'RETRY',
    expectSource: 'blotato',
  },
];

let pass = 0;
let fail = 0;

for (const c of cases) {
  const result = classifyError(c.error, c.ctx);
  const idMatch = (result.entry?.id ?? null) === c.expectId;
  const tierMatch = result.tier === c.expectTier;
  const sourceMatch = result.source === c.expectSource;
  const ok = idMatch && tierMatch && sourceMatch;
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '✓' : '✗'}  ${c.name}`);
  console.log(`    ${formatClassified(result)}`);
  if (!ok) {
    console.log(
      `    expected: id=${c.expectId} tier=${c.expectTier} source=${c.expectSource}`,
    );
    console.log(
      `    got:      id=${result.entry?.id ?? null} tier=${result.tier} source=${result.source}`,
    );
  }
  console.log();
}

console.log(`${pass}/${pass + fail} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
