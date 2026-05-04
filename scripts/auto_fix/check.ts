/**
 * Ad-hoc classifier inspector.
 *
 * Paste any error message on the CLI and see exactly how the auto-fix system
 * will classify it: source, tier, signature, and recommended action.
 *
 * Usage:
 *   npx tsx scripts/auto_fix/check.ts "ENOENT: no such file or directory, open 'data/foo.md'"
 *   npx tsx scripts/auto_fix/check.ts "Gemini API 429: { exceeded its monthly spending cap }"
 *   echo "EACCES: permission denied" | npx tsx scripts/auto_fix/check.ts -
 *
 * Pass `--source=blotato` (or any other source) to override the inferred
 * source. Pass `--status=429` to override the HTTP status.
 */

import { classifyError, formatClassified } from './classifier.js';
import type { ErrorSource } from './error_catalog.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log('Usage: npx tsx scripts/auto_fix/check.ts "<error message>"');
    console.log('       cat error.txt | npx tsx scripts/auto_fix/check.ts -');
    console.log('Options: --source=<src>  --status=<n>');
    process.exit(args.length === 0 ? 1 : 0);
  }

  const sourceArg = args.find((a) => a.startsWith('--source='))?.split('=')[1];
  const statusArg = args.find((a) => a.startsWith('--status='))?.split('=')[1];
  const positional = args.filter((a) => !a.startsWith('--'));

  let message: string;
  if (positional[0] === '-') {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    message = Buffer.concat(chunks).toString('utf-8').trim();
  } else {
    message = positional.join(' ');
  }

  if (!message) {
    console.error('No error message provided.');
    process.exit(1);
  }

  const result = classifyError(new Error(message), {
    source: sourceArg as ErrorSource | undefined,
    status: statusArg ? parseInt(statusArg) : undefined,
  });

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Input:     ${message.slice(0, 200)}${message.length > 200 ? '…' : ''}`);
  console.log('───────────────────────────────────────────────────────────');
  console.log(`Source:    ${result.source}`);
  console.log(`Status:    ${result.status ?? '(none)'}`);
  console.log(`Tier:      ${result.tier}`);
  console.log(`Signature: ${result.signature}`);
  console.log(`Catalog:   ${result.entry?.id ?? '(no catalog match)'}`);
  if (result.entry?.docs) console.log(`Docs:      ${result.entry.docs}`);
  if (result.entry?.retry) console.log(`Retry:     maxAttempts=${result.entry.retry.maxAttempts}, backoff=${result.entry.retry.backoffMs}ms`);
  console.log('───────────────────────────────────────────────────────────');
  console.log(`Action:    ${result.action}`);
  if (result.entry?.notes) console.log(`Notes:     ${result.entry.notes}`);
  console.log('───────────────────────────────────────────────────────────');
  console.log(`One-liner: ${formatClassified(result)}`);
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('Probe failed:', err);
  process.exit(1);
});
