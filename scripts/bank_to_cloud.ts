// Push banked (unposted) post archives → Supabase, so they appear in the admin
// dashboard's Content Bank. Uploads slides to Storage (public URLs) and writes a
// `posts` row with status='banked'. Idempotent. Optional --limit=N for testing.
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Prefer a service-role key for this admin script (it writes Storage + rows);
// fall back to the anon key for local use. Fail fast if neither is set.
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPA_URL || !SUPA_KEY) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) are required.');
  process.exit(1);
}
const sb = createClient(SUPA_URL, SUPA_KEY);
const BUCKET = 'campaign-assets';
// Repo root: --repo=… arg, REPO_ROOT env, else the current working directory.
const REPO = (process.argv.find((a) => a.startsWith('--repo='))?.split('=')[1])
  ?? process.env.REPO_ROOT ?? process.cwd();
const LIMIT = (() => { const a = process.argv.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1]) : Infinity; })();

const ACCT_CAMPAIGN: Record<string, string> = {
  'yournotetaker': 'minutewise', 'grow.with.claudia': 'minutewise',
  'grow.withamanda': 'minutewise', 'miniutewise_thomas': 'roastai',
};

(async () => {
  const { data: camps } = await sb.from('campaigns').select('id,slug');
  const campId: Record<string, string> = {};
  for (const c of camps ?? []) campId[c.slug] = c.id;

  // All existing ids (any status) — never re-bank a row that was already
  // posted/claimed, which would flip its status back to 'banked' and risk a
  // duplicate publish.
  const { data: existing } = await sb.from('posts').select('id');
  const have = new Set((existing ?? []).map(r => r.id));

  let uploaded = 0, skipped = 0, failed = 0;
  outer:
  for (const flow of ['flow1', 'flow2', 'flow3']) {
    const base = join(REPO, 'posts', flow);
    let dirs: string[] = [];
    try { dirs = await readdir(base); } catch { continue; }
    for (const dir of dirs) {
      if (!/^\d{4}-\d{2}-\d{2}_/.test(dir)) continue;
      if (uploaded >= LIMIT) break outer;
      const adir = join(base, dir);
      let meta: any;
      try { meta = JSON.parse(await readFile(join(adir, 'meta.json'), 'utf8')); } catch { continue; }
      if (meta.postId) { skipped++; continue; }          // already posted
      const id = dir;
      if (have.has(id)) { skipped++; continue; }          // already banked
      const files = (await readdir(adir)).filter(f => /^slide_\d+\.png$/.test(f))
        .sort((a, b) => parseInt(a.match(/\d+/)![0]) - parseInt(b.match(/\d+/)![0]));
      if (!files.length) continue;
      const urls: string[] = [];
      let upErr = false;
      for (let i = 0; i < files.length; i++) {
        const buf = await readFile(join(adir, files[i]));
        const path = `bank/${id}/slide_${i + 1}.png`;
        const { error } = await sb.storage.from(BUCKET).upload(path, buf, { upsert: true, contentType: 'image/png' });
        if (error) { console.log('  upload err', path, error.message); upErr = true; break; }
        urls.push(sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
      }
      if (upErr) { failed++; continue; }
      const handle = (meta.accountName || '').replace('@', '');
      // Fail closed: don't guess a campaign for an unknown account.
      const slug = ACCT_CAMPAIGN[handle];
      if (!slug) { console.log(`  skip ${id}: unmapped account "${handle}"`); skipped++; continue; }
      const row = {
        id,
        status: 'banked',
        account: handle,
        flow: meta.flow,
        campaign_id: campId[slug] || null,
        thumbnail_url: urls[0],
        hashtags: meta.metadata?.hashtags || [],
        format: meta.metadata?.format || `${files.length}-slide`,
        hook_style: meta.metadata?.hookStyle || null,
        date: (dir.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? (meta.createdAt ?? '').slice(0, 10)) || null,
        failure_resolution_note: JSON.stringify({ title: meta.title, caption: meta.caption, slideUrls: urls, slideCount: files.length }),
      };
      const { error: ie } = await sb.from('posts').upsert(row, { onConflict: 'id' });
      if (ie) { console.log('  insert err', id, ie.message); failed++; continue; }
      uploaded++;
      if (uploaded % 10 === 0) console.log(`  ...uploaded ${uploaded}`);
    }
  }
  console.log(`DONE. uploaded=${uploaded} skipped(posted/already)=${skipped} failed=${failed}`);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
