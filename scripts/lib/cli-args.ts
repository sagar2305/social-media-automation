/**
 * Shared CLI flag parsing for the bank/schedule scripts.
 *
 * Each of these scripts had its own copy of the same `--flag=value` reader and
 * its own `Number(...)` limit parse, and the same defect turned up in all of
 * them: an unvalidated limit silently changes what the script does rather than
 * failing. These write rows and submit posts that Blotato cannot delete, so a
 * mistyped flag has to stop the run, not quietly alter it.
 */

/** Read `--name=value`. Values may contain `=`. */
export function flagValue(name: string, argv: string[] = process.argv): string | undefined {
  return argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
}

/**
 * Read a `--name=<positive integer>` flag, or `fallback` when absent.
 *
 * Rejects, with a message naming the bad value:
 *   - non-numeric ("abc") — Number() gives NaN, and every NaN comparison is
 *     false, so `count >= NaN` never trips and the limit silently does nothing
 *   - fractional ("1.5")  — `count >= 1.5` first trips at 2, so the script
 *     processes one MORE item than asked
 *   - zero or negative    — nothing would ever be processed
 */
export function positiveIntFlag(
  name: string,
  fallback: number,
  argv: string[] = process.argv,
): number {
  const raw = flagValue(name, argv);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`--${name} must be a positive integer (got "${raw}").`);
    process.exit(1);
  }
  return n;
}
