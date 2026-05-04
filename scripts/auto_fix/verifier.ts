/**
 * Verifier — gating step for any auto-fix that modifies files.
 *
 * Two checks today:
 *   1. TypeScript compiles (`tsc --noEmit --skipLibCheck`)
 *   2. Optional caller-supplied canary (a tiny no-op test of the affected
 *      surface — e.g. "GET /v1/profile?handle=X returns 200")
 *
 * Returns a structured result; the caller (AUTO-FIX / PROPOSE executor) is
 * expected to roll back if `ok === false`.
 *
 * Pre-existing TypeScript errors in unrelated files (e.g. sync-to-supabase.ts)
 * are filtered out — the verifier should only block on errors *introduced* by
 * the auto-fix, not legacy issues we already know about.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileP = promisify(execFile);

// Errors in these files are pre-existing and not our concern. Add to this list
// only if you've manually confirmed the error existed before any auto-fix.
const KNOWN_PRE_EXISTING_ERRORS: RegExp[] = [
  /scripts\/sync-to-supabase\.ts/,
];

export interface VerifyResult {
  ok: boolean;
  /** Compiler / canary errors that block the change. */
  errors: string[];
  /** Errors filtered out as pre-existing (informational). */
  preExisting: string[];
  durationMs: number;
}

// ─── TypeScript check ────────────────────────────────────────

export async function runTypeCheck(): Promise<VerifyResult> {
  const start = Date.now();
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    const result = await execFileP(
      'npx',
      ['tsc', '--noEmit', '--skipLibCheck'],
      { cwd: process.cwd(), maxBuffer: 8 * 1024 * 1024 },
    );
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err: any) {
    exitCode = err.code ?? 1;
    stdout = err.stdout ?? '';
    stderr = err.stderr ?? '';
  }

  const lines = (stdout + '\n' + stderr).split('\n').filter((l) => l.trim());
  const errors: string[] = [];
  const preExisting: string[] = [];

  for (const line of lines) {
    if (!line.includes('error TS')) continue;
    if (KNOWN_PRE_EXISTING_ERRORS.some((re) => re.test(line))) {
      preExisting.push(line);
    } else {
      errors.push(line);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    preExisting,
    durationMs: Date.now() - start,
  };
}

// ─── Combined verify entry point ─────────────────────────────

/**
 * Run all configured checks. Pass an optional `canary` function for
 * surface-specific validation (e.g. ping the API with a known-good request
 * after a doc/code change to confirm it actually works).
 *
 * The canary is run AFTER tsc passes — no point burning network calls if
 * the code doesn't even compile.
 */
export async function verify(opts: {
  canary?: () => Promise<void>;
} = {}): Promise<VerifyResult> {
  const tscResult = await runTypeCheck();
  if (!tscResult.ok) return tscResult;

  if (opts.canary) {
    const canaryStart = Date.now();
    try {
      await opts.canary();
    } catch (err) {
      return {
        ok: false,
        errors: [`canary failed: ${err}`],
        preExisting: tscResult.preExisting,
        durationMs: tscResult.durationMs + (Date.now() - canaryStart),
      };
    }
    return {
      ok: true,
      errors: [],
      preExisting: tscResult.preExisting,
      durationMs: tscResult.durationMs + (Date.now() - canaryStart),
    };
  }

  return tscResult;
}

/** Format a verify result for logs / Slack messages. */
export function formatResult(r: VerifyResult): string {
  if (r.ok) {
    const note = r.preExisting.length
      ? ` (${r.preExisting.length} pre-existing tsc errors ignored)`
      : '';
    return `✓ verify ok in ${r.durationMs}ms${note}`;
  }
  const head = `✗ verify failed in ${r.durationMs}ms — ${r.errors.length} blocking error(s)`;
  return [head, ...r.errors.slice(0, 5).map((e) => `  ${e}`)].join('\n');
}
