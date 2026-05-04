/**
 * One-shot: repost Apr 19 archived slides (flow1 + flow2) via Blotato.
 * Distributes them across 3 time slots (now, +3h, +6h) matching the
 * `npm run flow` pattern. Skips today's rotation-skipped account and
 * stays under Blotato's 10 posts / account / 24h cap.
 *
 * No Gemini calls — uses a rotating pool of pre-written MinuteWise
 * captions. Works even when the Gemini spending cap is exhausted.
 *
 * Run:  npx tsx scripts/repost_apr19_archives.ts
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local', override: true });

import { readdir, writeFile, access } from 'fs/promises';
import { join } from 'path';
import { config } from '../config/config.js';
import { postSlideshow } from './post_to_tiktok.js';
import { log } from './api-client.js';
import type { PostMetadata } from './text_overlay.js';
import type { FlowType } from '../config/config.js';

// ─── Config ───────────────────────────────────────────────────

const TARGET_DATE_PREFIX = '2026-04-19';
const MAX_POSTS_PER_ACCOUNT_PER_24H = 10; // Blotato Starter plan

// Pre-written captions (no Gemini needed). Each picks a hook style + hashtag set.
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
    title: "Nobody tells you this about note-taking",
    caption:
      "nobody tells you this about note-taking 🤫 stop rewriting and start retaining. minutewise summarises for you. save for exam week 📚\n\n#studytips #studentlife #minutewise #MinuteWise #notetaking #studyhacks #academictiktok #studytok #studymotivation #studywithme #fyp #foryoupage #learnontiktok #collegelife #studyroutine #studentlife101 #examprep #activerecall #studentmotivation #aistudytools",
    hookStyle: 'contrast',
  },
  {
    title: 'The study hack that saved my semester',
    caption:
      "the study hack that saved my semester 🫣 minutewise records, transcribes, and summarises every class for you. save for exam week 💾\n\n#studytips #studentlife #minutewise #MinuteWise #studyhacks #academictiktok #studytok #studymotivation #fyp #foryoupage #learnontiktok #collegelife #studentlife101 #examprep #activerecall #notetaking #studyroutine #studentmotivation #aistudytools #ainotetaker",
    hookStyle: 'story_opener',
  },
  {
    title: '5 minutes, $0, better grades',
    caption:
      "5 minutes, $0, better grades 📊 minutewise is the ai note-taker your future self will thank you for. save for exam week 🎯\n\n#studytips #studentlife #minutewise #MinuteWise #studyhacks #academictiktok #studytok #studymotivation #fyp #foryoupage #learnontiktok #collegelife #examprep #activerecall #notetaking #studyroutine #studentmotivation #aistudytools #ainotetaker #studentlife101",
    hookStyle: 'stat_lead',
  },
  {
    title: 'Why are people hiding this study app?',
    caption:
      "why are people hiding this study app?? 👀 minutewise basically does half your studying for you. save for exam week 💫\n\n#studytips #studentlife #minutewise #MinuteWise #studyhacks #studytok #academictiktok #studymotivation #fyp #foryoupage #learnontiktok #collegelife #examprep #notetaking #studyroutine #studentmotivation #aistudytools #ainotetaker #studentlife101 #studywithme",
    hookStyle: 'question',
  },
  {
    title: 'What if your notes wrote themselves?',
    caption:
      "what if your notes wrote themselves? 🪄 minutewise records and organises everything from your lectures. save for exam week 📝\n\n#studytips #studentlife #minutewise #MinuteWise #notetaking #studyhacks #studytok #academictiktok #studymotivation #fyp #foryoupage #learnontiktok #collegelife #examprep #activerecall #studyroutine #studentmotivation #aistudytools #ainotetaker #studentlife101",
    hookStyle: 'question',
  },
];

// ─── Rotation (mirrors main.ts) ──────────────────────────────

function todaysActiveAccountIndices(): number[] {
  const all = config.tiktokAccounts.map((_, i) => i);
  const offset = Math.floor(Date.now() / (24 * 60 * 60 * 1000)) % all.length;
  const rotated = [...all.slice(offset), ...all.slice(0, offset)];
  const CAP = 3;
  return rotated.slice(0, CAP);
}

// ─── Archive Discovery ───────────────────────────────────────

interface Archive {
  flow: FlowType;
  folder: string;
  archiveDir: string;
  slidePaths: string[];
  accountIndex: number;
  accountName: string;
}

async function findArchives(activeIndices: number[]): Promise<Archive[]> {
  const out: Archive[] = [];
  const flowMap: Record<string, FlowType> = {
    flow1: 'photorealistic',
    flow2: 'animated',
    // flow3 is intentionally excluded — `npm run flow` only posts flow1+flow2
  };

  for (const [folder, flowType] of Object.entries(flowMap)) {
    let entries: string[];
    try {
      entries = await readdir(join('posts', folder));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.startsWith(TARGET_DATE_PREFIX)) continue;
      const m = entry.match(/_@(.+)$/);
      if (!m) continue;
      const handle = m[1];
      const accountIndex = config.tiktokAccounts.findIndex(
        (a) => a.handle.toLowerCase() === handle.toLowerCase(),
      );
      if (accountIndex === -1) continue;
      if (!activeIndices.includes(accountIndex)) continue;

      const archiveDir = join('posts', folder, entry);
      // Idempotency: skip archives that already posted successfully
      const submittedMarker = join(archiveDir, '.submitted');
      try {
        await access(submittedMarker);
        continue; // already submitted on a prior run
      } catch {
        // no marker → eligible
      }

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

// ─── Distribution: pack archives into 3 time slots honoring per-account cap ──

interface SlotAssignment {
  slot: 0 | 1 | 2;
  scheduleDate: Date | undefined;
  archive: Archive;
  captionIdx: number;
}

function distribute(archives: Archive[]): SlotAssignment[] {
  const now = Date.now();
  const slotTimes: (Date | undefined)[] = [
    undefined, // slot 0: post now
    new Date(now + 3 * 3600 * 1000),
    new Date(now + 6 * 3600 * 1000),
  ];

  // Sort by folder name (chronological within the day) for deterministic order
  const sorted = [...archives].sort((a, b) => a.archiveDir.localeCompare(b.archiveDir));

  const perAccountCount: Record<number, number> = {};
  const assignments: SlotAssignment[] = [];
  let captionIdx = 0;

  for (const a of sorted) {
    const count = perAccountCount[a.accountIndex] || 0;
    if (count >= MAX_POSTS_PER_ACCOUNT_PER_24H) {
      log(`  ⏭️  skip ${a.archiveDir} — account already at ${MAX_POSTS_PER_ACCOUNT_PER_24H}/24h cap`);
      continue;
    }
    // Round-robin slot assignment using the current per-account count
    const slot = (count % 3) as 0 | 1 | 2;
    assignments.push({
      slot,
      scheduleDate: slotTimes[slot],
      archive: a,
      captionIdx: captionIdx++ % CAPTIONS.length,
    });
    perAccountCount[a.accountIndex] = count + 1;
  }
  return assignments;
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  const active = todaysActiveAccountIndices();
  const activeNames = active.map((i) => config.tiktokAccounts[i].name);

  log(`╔══════════════════════════════════════════════════╗`);
  log(`║  REPOST ARCHIVES — ${TARGET_DATE_PREFIX}`);
  log(`║  Active accounts today: ${activeNames.join(', ')}`);
  log(`╚══════════════════════════════════════════════════╝`);

  const archives = await findArchives(active);
  log(`Found ${archives.length} archive(s) for today's active accounts`);
  if (!archives.length) {
    log('Nothing to repost. Exiting.');
    return;
  }

  const assignments = distribute(archives);
  log(`\nDistribution across 3 slots:`);
  const bySlot: Record<number, SlotAssignment[]> = { 0: [], 1: [], 2: [] };
  for (const a of assignments) bySlot[a.slot].push(a);
  for (const slot of [0, 1, 2] as const) {
    const label = slot === 0 ? 'now' : slot === 1 ? '+3h' : '+6h';
    log(`  Slot ${slot + 1} (${label}): ${bySlot[slot].length} post(s)`);
    for (const a of bySlot[slot]) {
      log(`    - ${a.archive.flow} | ${a.archive.accountName} | ${a.archive.archiveDir}`);
    }
  }
  log('');

  let successCount = 0;
  let failCount = 0;

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
        /* useCta */ false, // CTA slide already baked into archived slides
        a.archive.accountIndex,
        'direct',
        a.scheduleDate,
      );
      log(`✅ ${a.archive.accountName} | slot ${a.slot + 1} → ${result.postId}`);
      // Mark archive as submitted so re-runs skip it
      await writeFile(join(a.archive.archiveDir, '.submitted'), `${result.postId}\n${new Date().toISOString()}\n`);
      successCount++;
    } catch (err) {
      log(`❌ ${a.archive.accountName} | slot ${a.slot + 1} → ${err}`);
      failCount++;
    }
  }

  log(`\n╔══════════════════════════════════════════════════╗`);
  log(`║  COMPLETE — ${successCount} submitted, ${failCount} failed`);
  log(`╚══════════════════════════════════════════════════╝`);
}

main().catch((err) => {
  log(`FATAL: ${err}`);
  process.exit(1);
});
