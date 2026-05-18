/**
 * Manual Gemini fix trigger.
 *
 * Usage:
 *   npx tsx scripts/auto_fix/fix.ts "<error message or stack trace>"
 *   npx tsx scripts/auto_fix/fix.ts --file=scripts/some_script.ts "<error message>"
 *   cat error.log | npx tsx scripts/auto_fix/fix.ts -
 *
 * This lets you ask Gemini to fix any error you paste in, not just ones that
 * went through the live pipeline. Useful for debugging or triggering from the
 * dashboard "Ask AI to Fix" button.
 */

import { classifyError } from './classifier.js';
import { runGeminiFix } from './gemini_fixer.js';
import type { ErrorSource } from './error_catalog.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log('Usage: npx tsx scripts/auto_fix/fix.ts "<error message or stack>"');
    console.log('       cat error.log | npx tsx scripts/auto_fix/fix.ts -');
    console.log('Options:');
    console.log('  --source=blotato|gemini|scrapeCreators|...   override source');
    console.log('  --status=429                                  override HTTP status');
    process.exit(args.length === 0 ? 1 : 0);
  }

  const sourceArg = args.find((a) => a.startsWith('--source='))?.split('=')[1];
  const statusArg = args.find((a) => a.startsWith('--status='))?.split('=')[1];
  const positional = args.filter((a) => !a.startsWith('--'));

  let message: string;
  if (positional[0] === '-') {
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

  const err = new Error(message);
  err.stack = message; // treat the full pasted text as the stack

  const classified = classifyError(err, {
    source: sourceArg as ErrorSource | undefined,
    status: statusArg ? parseInt(statusArg) : undefined,
  });

  console.log(`Classified: tier=${classified.tier} signature=${classified.signature}`);
  console.log(`Action hint: ${classified.action}`);
  console.log('');
  console.log('Asking Gemini for a fix...');

  // Always attempt, even for tiers the auto-pipeline wouldn't normally escalate.
  // Manual invocation means the human wants AI help regardless of tier.
  const forcePropose = { ...classified, tier: 'PROPOSE' as const };
  await runGeminiFix(forcePropose, err);
}

main().catch((err) => {
  console.error('fix.ts failed:', err);
  process.exit(1);
});
