/**
 * Cross-checks every folder under posts/unposted/ against POST-TRACKER.md to
 * determine whether it was actually posted via the older pre-marker system.
 *
 * Method: for each unposted folder, parse (account, date) from the folder name,
 * then look for a tracker row with the same account whose date matches AND
 * whose status starts with "published". If found, the folder was likely
 * already posted and our marker is just missing.
 *
 * Run: npx tsx scripts/_verify_unposted.ts
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';

const TRACKER = 'data/POST-TRACKER.md';
const UNPOSTED_ROOT = 'posts/unposted';
const FLOWS = ['flow1', 'flow2', 'flow3'];

interface TrackerRow {
  postId: string;
  date: string;
  status: string;
  tiktokUrl: string;
}

function parseTracker(md: string): TrackerRow[] {
  return md
    .split('\n')
    .filter((l) => l.startsWith('|') && !l.includes('Post ID') && !l.includes('---'))
    .map((line) => {
      const cols = line.split('|').map((c) => c.trim()).filter(Boolean);
      return {
        postId: cols[0] || '',
        date: cols[1] || '',
        status: cols[11] || '',
        tiktokUrl: cols[12] || '',
      };
    });
}

interface FolderInfo {
  flow: string;
  folder: string;
  account: string; // handle (without @)
  date: string;
  path: string;
}

function parseFolder(flow: string, folder: string): FolderInfo | null {
  // Folder name shape: 2026-04-19_21-46-45_@yournotetaker
  const m = folder.match(/^(\d{4}-\d{2}-\d{2})_\d{2}-\d{2}-\d{2}_@(.+)$/);
  if (!m) return null;
  return {
    flow,
    folder,
    account: m[2].toLowerCase(),
    date: m[1],
    path: join(UNPOSTED_ROOT, flow, folder),
  };
}

async function main() {
  const trackerContent = await readFile(TRACKER, 'utf-8').catch(() => '');
  const rows = parseTracker(trackerContent);

  // Group tracker rows by (account, date) where status starts with "published"
  // Tracker status format: "published (@accountname)" or just "published" (legacy)
  // tiktokUrl format: https://www.tiktok.com/@account/photo/<id>
  const publishedByKey = new Map<string, TrackerRow[]>();
  for (const r of rows) {
    if (!r.status.toLowerCase().startsWith('published')) continue;
    let acct: string | null = null;
    const m1 = r.status.match(/@([^,)\s]+)/);
    if (m1) acct = m1[1].toLowerCase();
    if (!acct) {
      const m2 = r.tiktokUrl.match(/@([^/]+)/);
      if (m2) acct = m2[1].toLowerCase();
    }
    if (!acct) continue;
    const key = `${acct}:${r.date}`;
    if (!publishedByKey.has(key)) publishedByKey.set(key, []);
    publishedByKey.get(key)!.push(r);
  }

  // Walk the unposted tree
  const folders: FolderInfo[] = [];
  for (const flow of FLOWS) {
    const dir = join(UNPOSTED_ROOT, flow);
    let entries: string[];
    try { entries = await readdir(dir); } catch { continue; }
    for (const e of entries) {
      const info = parseFolder(flow, e);
      if (info) folders.push(info);
    }
  }

  // For each unposted folder, check if there's a published tracker row that
  // could plausibly correspond to it.
  let likelyPosted = 0;
  let trulyUnposted = 0;
  const evidenceByAccount: Record<string, { posted: number; unposted: number }> = {};
  const trulyUnpostedList: string[] = [];
  const likelyPostedList: string[] = [];

  for (const f of folders) {
    const acctKey = f.account.toLowerCase();
    const key = `${acctKey}:${f.date}`;
    const matches = publishedByKey.get(key) ?? [];
    const stats = (evidenceByAccount[f.account] ??= { posted: 0, unposted: 0 });
    if (matches.length > 0) {
      likelyPosted++;
      stats.posted++;
      likelyPostedList.push(`  ${f.path}  →  ${matches.length} published tracker row(s) on ${f.date}`);
    } else {
      trulyUnposted++;
      stats.unposted++;
      trulyUnpostedList.push(`  ${f.path}`);
    }
  }

  console.log(`Total folders in posts/unposted/:  ${folders.length}`);
  console.log(`  Likely already posted (have tracker rows): ${likelyPosted}`);
  console.log(`  Truly unposted (no tracker rows):          ${trulyUnposted}`);
  console.log('');
  console.log('Per-account breakdown:');
  for (const [acct, s] of Object.entries(evidenceByAccount)) {
    console.log(`  @${acct.padEnd(22)} likely posted: ${String(s.posted).padStart(3)}   truly unposted: ${String(s.unposted).padStart(3)}`);
  }
  console.log('');
  console.log('Sample truly-unposted (first 10):');
  trulyUnpostedList.slice(0, 10).forEach((l) => console.log(l));
  console.log('');
  console.log('Sample likely-already-posted (first 10):');
  likelyPostedList.slice(0, 10).forEach((l) => console.log(l));
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
