/**
 * CLI for the docs-freshness system.
 *
 *   npx tsx scripts/docs_refresh.ts list          # show all docs + freshness
 *   npx tsx scripts/docs_refresh.ts stale         # show only stale docs
 *   npx tsx scripts/docs_refresh.ts mark <source> # stamp a source as refreshed
 *
 * Until Day 3 wires in context7 auto-fetch, the `mark` step is manual: edit
 * the relevant docs/*.md file yourself (or ask Claude), then stamp it.
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local', override: true });

import {
  listFreshness,
  markFresh,
  STALE_THRESHOLD_MS,
} from './auto_fix/docs_freshness.js';
import { list as listQueue, clear as clearQueue } from './auto_fix/refresh_queue.js';
import type { ErrorSource } from './auto_fix/error_catalog.js';

function fmtAge(date: Date | null): string {
  if (!date) return 'never';
  const days = (Date.now() - date.getTime()) / (24 * 60 * 60 * 1000);
  return days < 1 ? 'today' : `${Math.floor(days)}d ago`;
}

async function cmdList(showStaleOnly: boolean) {
  const rows = await listFreshness();
  const filtered = showStaleOnly ? rows.filter((r) => r.stale) : rows;
  if (!filtered.length) {
    console.log(showStaleOnly ? 'All docs are fresh.' : 'No tracked docs.');
    return;
  }
  const staleDays = STALE_THRESHOLD_MS / (24 * 60 * 60 * 1000);
  console.log(`Source           Path                              Last refreshed   Status`);
  console.log(`──────           ────                              ──────────────   ──────`);
  for (const r of filtered) {
    const flag = r.stale ? '⚠  STALE' : '✓  fresh';
    console.log(
      `${r.source.padEnd(16)} ${r.path.padEnd(33)} ${fmtAge(r.lastRefreshed).padEnd(16)} ${flag}`,
    );
  }
  if (showStaleOnly) console.log(`\n(threshold: ${staleDays}d)`);
}

async function cmdMark(source: string) {
  const valid: ErrorSource[] = ['blotato', 'gemini', 'scrapeCreators', 'virlo', 'tiktok'];
  if (!valid.includes(source as ErrorSource)) {
    console.error(`Unknown source "${source}". Valid: ${valid.join(', ')}`);
    process.exit(2);
  }
  await markFresh(source as ErrorSource);
  await clearQueue(source as ErrorSource);
  console.log(`Marked ${source} docs as fresh (now). Refresh queue cleared.`);
}

async function cmdQueue() {
  const items = await listQueue();
  if (!items.length) {
    console.log('Refresh queue empty.');
    return;
  }
  console.log(`Pending doc-refresh requests:\n`);
  console.log(`Source           Count  Signature                                   Queued`);
  console.log(`──────           ─────  ─────────                                   ──────`);
  for (const it of items) {
    console.log(
      `${it.source.padEnd(16)} ${String(it.count).padEnd(6)} ${it.signature.padEnd(43)} ${it.queuedAt.slice(0, 19)}`,
    );
  }
  console.log(`\nTo clear: refresh the relevant docs/<source>-api.md, then \`mark <source>\`.`);
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case 'list':
      return cmdList(false);
    case 'stale':
      return cmdList(true);
    case 'queue':
      return cmdQueue();
    case 'mark':
      if (!arg) {
        console.error('Usage: docs_refresh.ts mark <source>');
        process.exit(2);
      }
      return cmdMark(arg);
    default:
      console.log('Commands:');
      console.log('  list            — show all tracked docs + freshness');
      console.log('  stale           — show only stale docs (> 14 days old)');
      console.log('  queue           — show pending doc-refresh requests from auto-classifier');
      console.log('  mark <source>   — stamp source as refreshed + clear from queue');
      console.log('');
      console.log('Valid sources: blotato, gemini, scrapeCreators, virlo, tiktok');
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
