/**
 * CLI for managing PROPOSE-tier auto-fix proposals.
 *
 *   npx tsx scripts/auto_fix_proposals.ts list                   # show pending
 *   npx tsx scripts/auto_fix_proposals.ts diff <id>              # print unified diff
 *   npx tsx scripts/auto_fix_proposals.ts approve <id>           # apply shadow → working tree
 *   npx tsx scripts/auto_fix_proposals.ts reject <id>            # discard
 *   npx tsx scripts/auto_fix_proposals.ts purge-resolved         # delete applied/rejected
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local', override: true });

import {
  listAll,
  readMetadata,
  readDiff,
  shadowApply,
  transition,
  purge,
} from './auto_fix/proposals.js';

function fmtAge(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const mins = ms / 60_000;
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function cmdList() {
  const all = await listAll();
  const pending = all.filter((m) => m.status === 'pending');
  if (!pending.length) {
    console.log('No pending proposals.');
    if (all.length) console.log(`(${all.length} resolved — see \`purge-resolved\` to clean up)`);
    return;
  }
  console.log(`Pending proposals (${pending.length}):\n`);
  console.log(`ID                         Age      Files  Description`);
  console.log(`──                         ───      ─────  ───────────`);
  for (const m of pending) {
    console.log(
      `${m.id.padEnd(26)} ${fmtAge(m.createdAt).padEnd(8)} ${String(m.files.length).padEnd(6)} ${m.description.slice(0, 80)}`,
    );
  }
  console.log('\nReview a proposal:  diff <id>');
  console.log('Apply:              approve <id>');
  console.log('Discard:            reject <id>');
}

async function cmdDiff(id: string) {
  const m = await readMetadata(id);
  if (!m) { console.error(`Proposal ${id} not found`); process.exit(2); }
  console.log(`# Proposal: ${m.id}`);
  console.log(`# Description: ${m.description}`);
  console.log(`# Reason: ${m.reason}`);
  console.log(`# Status: ${m.status}`);
  console.log(`# Files: ${m.files.join(', ')}`);
  console.log('');
  const diff = await readDiff(id);
  console.log(diff || '(empty diff)');
}

async function cmdApprove(id: string) {
  const m = await readMetadata(id);
  if (!m) { console.error(`Proposal ${id} not found`); process.exit(2); }
  if (m.status !== 'pending') {
    console.error(`Proposal ${id} is already ${m.status}.`);
    process.exit(2);
  }
  const { restored } = await shadowApply(id);
  await transition(id, 'applied');
  console.log(`✓ Approved ${id} — ${restored} file(s) updated in working tree.`);
  console.log(`  Don't forget to git commit when you're satisfied.`);
}

async function cmdReject(id: string) {
  const m = await readMetadata(id);
  if (!m) { console.error(`Proposal ${id} not found`); process.exit(2); }
  if (m.status !== 'pending') {
    console.error(`Proposal ${id} is already ${m.status}.`);
    process.exit(2);
  }
  await transition(id, 'rejected');
  console.log(`✓ Rejected ${id}. Shadow files retained for inspection — purge later with \`purge-resolved\`.`);
}

async function cmdPurgeResolved() {
  const all = await listAll();
  const resolved = all.filter((m) => m.status !== 'pending');
  for (const m of resolved) await purge(m.id);
  console.log(`Purged ${resolved.length} resolved proposal(s).`);
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case 'list': return cmdList();
    case 'diff': if (!arg) { console.error('Usage: diff <id>'); process.exit(2); } return cmdDiff(arg);
    case 'approve': if (!arg) { console.error('Usage: approve <id>'); process.exit(2); } return cmdApprove(arg);
    case 'reject': if (!arg) { console.error('Usage: reject <id>'); process.exit(2); } return cmdReject(arg);
    case 'purge-resolved': return cmdPurgeResolved();
    default:
      console.log('Auto-fix proposal CLI');
      console.log('Commands:');
      console.log('  list             — show pending proposals');
      console.log('  diff <id>        — print unified diff for a proposal');
      console.log('  approve <id>     — apply the proposed change to the working tree');
      console.log('  reject <id>      — mark as rejected (shadow files kept for inspection)');
      console.log('  purge-resolved   — delete applied/rejected proposals from disk');
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
