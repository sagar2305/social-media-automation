/**
 * Repost 6 unposted archives across 3 time slots (now, +3h, +6h).
 *
 * Selection rules:
 *   - Skip archives with a `.submitted` marker (already processed)
 *   - Match today's active 3 accounts (rotation + cap from main.ts)
 *   - Prefer newest archives (most topical content)
 *   - Balance: 2 per account × 3 accounts = 6 total
 *   - Only flow1 + flow2 (matches `npm run flow` scope)
 *
 * Distribution: round-robin per account across 3 slots → 2 per slot.
 * No Gemini calls — uses pre-written caption pool (same as Apr 19 reposter).
 *
 * Run: npx tsx scripts/repost_unposted_6.ts
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local', override: true });

import { readdir, access, rm } from 'fs/promises';
import { join } from 'path';
import { config } from '../config/config.js';
import { postSlideshow } from './post_to_tiktok.js';
import { log } from './api-client.js';
import type { PostMetadata } from './text_overlay.js';
import type { FlowType } from '../config/config.js';

// ─── Config ───────────────────────────────────────────────────

// 6 posts/day total — 3 per account across the two healthy accounts.
const TOTAL_POSTS = parseInt(process.env.REPOST_TOTAL ?? '6', 10);
const PER_ACCOUNT = parseInt(process.env.REPOST_PER_ACCOUNT ?? '3', 10);
const MAX_POSTS_PER_ACCOUNT_PER_24H = 10;
const ALLOWED_HANDLES = new Set([
  'yournotetaker',
  'miniutewise_thomas',
]);

const CAPTIONS: Array<{ title: string; caption: string; hookStyle: PostMetadata['hookStyle'] }> = [
  {
    title: 'This changed how I study forever',
    caption:
      "this changed how i study forever ✨ minutewise is the ai note-taker i wish i had years ago. save for exam week 📚\n\n#studytips #studentlife #minutewise #MinuteWise #studenttiktok #academictiktok #studyhacks #studytok #studymotivation #studywithme #fyp #foryoupage #notetaking #ainotes #studyroutine #collegelife #highschoolhacks #examprep #studentmotivation #learnontiktok",
    hookStyle: 'bold_claim',
  },
  {
    title: "You're studying wrong if you don't do this",
    caption:
      "you're studying wrong if you don't do this 😬 let minutewise record + summarise lectures while you actually pay attention. save for exam week 📌\n\n#studytips #studentlife #minutewise #MinuteWise #studyhacks #academictiktok #collegelife #studytok #examprep #studymotivation #fyp #foryoupage #activerecall #notetaking #studywithme #studytips101 #studentlife101 #learnontiktok #aistudytools #ainotetaker",
    hookStyle: 'bold_claim',
  },
  {
    title: 'How I raised my GPA with one app',
    caption:
      "how i raised my gpa with one app 📈 minutewise turns every lecture into organised notes + flashcards. save this for exam week 🔖\n\n#studytips #studentlife #minutewise #MinuteWise #studyhacks #studytok #academictiktok #studymotivation #studywithme #fyp #foryoupage #notetaking #learnontiktok #collegelife #highschool #exampreparation #studyroutine #studentmotivation #ainotes #studytools",
    hookStyle: 'story_opener',
  },
  {
    title: 'Nobody tells you this about note-taking',
    caption:
      "nobody tells you this about note-taking 🤫 stop rewriting and start retaining. minutewise summarises for you. save for exam week 📚\n\n#studytips #studentlife #minutewise #MinuteWise #notetaking #studyhacks #academictiktok #studytok #studymotivation #studywithme #fyp #foryoupage #learnontiktok #collegelife #studyroutine #studentlife101 #examprep #activerecall #studentmotivation #aistudytools",
    hookStyle: 'contrast',
  },
  {
    title: '5 minutes, $0, better grades',
    caption:
      "5 minutes, $0, better grades 📊 minutewise is the ai note-taker your future self will thank you for. save for exam week 🎯\n\n#studytips #studentlife #minutewise #MinuteWise #studyhacks #academictiktok #studytok #studymotivation #fyp #foryoupage #learnontiktok #collegelife #examprep #activerecall #notetaking #studyroutine #studentmotivation #aistudytools #ainotetaker #studentlife101",
    hookStyle: 'stat_lead',
  },
  {
    title: 'What if your notes wrote themselves?',
    caption:
      "what if your notes wrote themselves? 🪄 minutewise records and organises everything from your lectures. save for exam week 📝\n\n#studytips #studentlife #minutewise #MinuteWise #notetaking #studyhacks #studytok #academictiktok #studymotivation #fyp #foryoupage #learnontiktok #collegelife #examprep #activerecall #studyroutine #studentmotivation #aistudytools #ainotetaker #studentlife101",
    hookStyle: 'question',
  },
];

// ─── Rotation (mirrors main.ts) ──────────────────────────────

function todaysActiveIndices(): number[] {
  // Filter to the hard-coded healthy accounts; ignore rotation for this run.
  return config.tiktokAccounts
    .map((_, i) => i)
    .filter((i) => ALLOWED_HANDLES.has(config.tiktokAccounts[i].handle.toLowerCase()));
}

// ─── Archive discovery ───────────────────────────────────────

interface Archive {
  flow: FlowType;
  folder: string;
  archiveDir: string;
  slidePaths: string[];
  accountIndex: number;
  accountName: string;
}

// Source root for unposted archives. Folders are deleted after successful repost
// to avoid duplicate-post risk (retry_handler scanning posts/<flow>/ for meta.json).
const UNPOSTED_ROOT = 'posts/unposted';

async function scanUnposted(activeIndices: number[]): Promise<Archive[]> {
  const out: Archive[] = [];
  const flowMap: Record<string, FlowType> = {
    flow1: 'photorealistic',
    flow2: 'animated',
    flow3: 'emoji_overlay',
  };
  for (const [folder, flowType] of Object.entries(flowMap)) {
    let entries: string[];
    try {
      entries = await readdir(join(UNPOSTED_ROOT, folder));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const m = entry.match(/_@(.+)$/);
      if (!m) continue;
      const handle = m[1];
      const accountIndex = config.tiktokAccounts.findIndex(
        (a) => a.handle.toLowerCase() === handle.toLowerCase(),
      );
      if (accountIndex === -1) continue;
      if (!activeIndices.includes(accountIndex)) continue;

      const archiveDir = join(UNPOSTED_ROOT, folder, entry);
      // Defensive: skip if a .submitted marker is already present (shouldn't
      // happen in the new layout, but keeps the script idempotent).
      try {
        await access(join(archiveDir, '.submitted'));
        continue;
      } catch {}

      const files = await readdir(archiveDir).catch(() => [] as string[]);
      const slidePaths = files
        .filter((f) => /^slide_\d+\.png$/.test(f))
        .sort()
        .map((f) => join(archiveDir, f));
      if (!slidePaths.length) continue;

      out.push({
        flow: flowType,
        folder,
        archiveDir,
        slidePaths,
        accountIndex,
        accountName: config.tiktokAccounts[accountIndex].name,
      });
    }
  }
  return out;
}

async function deletePosted(srcDir: string): Promise<void> {
  await rm(srcDir, { recursive: true, force: true });
}

// Pick newest N per account, balanced
function pickBalanced(archives: Archive[], activeIndices: number[]): Archive[] {
  const sortedDesc = [...archives].sort((a, b) => b.archiveDir.localeCompare(a.archiveDir));
  const picked: Archive[] = [];
  const perAccount: Record<number, number> = {};
  for (const acctIdx of activeIndices) perAccount[acctIdx] = 0;
  for (const a of sortedDesc) {
    if (perAccount[a.accountIndex] >= PER_ACCOUNT) continue;
    picked.push(a);
    perAccount[a.accountIndex]++;
    if (picked.length >= TOTAL_POSTS) break;
  }
  return picked;
}

// ─── Distribution: round-robin across 3 slots ─────────────────

interface Assignment {
  slot: 0 | 1 | 2;
  scheduleDate: Date | undefined;
  archive: Archive;
  captionIdx: number;
}

function distribute(picked: Archive[]): Assignment[] {
  const now = Date.now();
  const slotTimes: (Date | undefined)[] = [
    undefined,
    new Date(now + 3 * 3600 * 1000),
    new Date(now + 6 * 3600 * 1000),
  ];
  const perAcct: Record<number, number> = {};
  const assignments: Assignment[] = [];
  let captionIdx = 0;

  // Interleave accounts so the global counter naturally spreads each account's
  // posts across different slots (acct1, acct2, acct1, acct2, ...).
  const byAccount: Record<number, Archive[]> = {};
  for (const a of picked) {
    (byAccount[a.accountIndex] ??= []).push(a);
  }
  for (const list of Object.values(byAccount)) {
    list.sort((a, b) => a.archiveDir.localeCompare(b.archiveDir));
  }
  const accountKeys = Object.keys(byAccount).map(Number);
  const interleaved: Archive[] = [];
  const maxLen = Math.max(...accountKeys.map((k) => byAccount[k].length));
  for (let i = 0; i < maxLen; i++) {
    for (const k of accountKeys) {
      if (byAccount[k][i]) interleaved.push(byAccount[k][i]);
    }
  }

  // Global counter → post N goes to slot N % 3, giving balanced distribution.
  let globalIdx = 0;
  for (const a of interleaved) {
    const n = perAcct[a.accountIndex] || 0;
    if (n >= MAX_POSTS_PER_ACCOUNT_PER_24H) continue;
    const slot = (globalIdx % 3) as 0 | 1 | 2;
    assignments.push({
      slot,
      scheduleDate: slotTimes[slot],
      archive: a,
      captionIdx: captionIdx++ % CAPTIONS.length,
    });
    perAcct[a.accountIndex] = n + 1;
    globalIdx++;
  }
  return assignments;
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  const active = todaysActiveIndices();
  const activeNames = active.map((i) => config.tiktokAccounts[i].name);

  log('╔══════════════════════════════════════════════════╗');
  log(`║  REPOST 6 UNPOSTED — 3-slot loop (now/+3h/+6h)`);
  log(`║  Active accounts today: ${activeNames.join(', ')}`);
  log('╚══════════════════════════════════════════════════╝');

  const all = await scanUnposted(active);
  log(`Found ${all.length} unposted archives across today's accounts`);
  if (all.length === 0) {
    log('Nothing to repost. Exiting.');
    return;
  }

  const picked = pickBalanced(all, active);
  log(`Picked ${picked.length} for this run (newest first, ${PER_ACCOUNT}/account):`);
  for (const a of picked) log(`  • ${a.accountName} | ${a.flow} | ${a.archiveDir}`);

  const assignments = distribute(picked);
  log(`\nSlot distribution:`);
  for (const slot of [0, 1, 2] as const) {
    const label = slot === 0 ? 'now' : slot === 1 ? '+3h' : '+6h';
    const count = assignments.filter((a) => a.slot === slot).length;
    log(`  Slot ${slot + 1} (${label}): ${count} post(s)`);
  }
  log('');

  let ok = 0;
  let fail = 0;
  for (const a of assignments) {
    const cap = CAPTIONS[a.captionIdx];
    const metadata: PostMetadata = {
      hookStyle: cap.hookStyle,
      format: `${a.archive.slidePaths.length}-slide`,
      hashtags: Array.from(cap.caption.matchAll(/#(\w+)/g)).map((m) => `#${m[1]}`),
      experimentId: null,
      variant: null,
      createdAt: new Date().toISOString(),
      flow: a.archive.flow,
      account: a.archive.accountName,
    };
    try {
      const result = await postSlideshow(
        a.archive.slidePaths,
        cap.caption,
        cap.title,
        metadata,
        false,
        a.archive.accountIndex,
        'direct',
        a.scheduleDate,
      );
      log(`✅ ${a.archive.accountName} | slot ${a.slot + 1} → ${result.postId}`);
      // Delete the source folder so it can never be reposted again.
      await deletePosted(a.archive.archiveDir);
      log(`   deleted → ${a.archive.archiveDir}`);
      ok++;
    } catch (err) {
      log(`❌ ${a.archive.accountName} | slot ${a.slot + 1} → ${err}`);
      fail++;
    }
  }

  log(`\n╔══════════════════════════════════════════════════╗`);
  log(`║  COMPLETE — ${ok} submitted, ${fail} failed`);
  log('╚══════════════════════════════════════════════════╝');
}

main().catch((err) => {
  log(`FATAL: ${err}`);
  process.exit(1);
});
