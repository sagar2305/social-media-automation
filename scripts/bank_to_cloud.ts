// Push banked (unposted) post archives → Supabase, so they appear in the admin
// dashboard's Content Bank. Uploads slides to Storage (public URLs) and writes a
// `posts` row with status='banked'. Idempotent. Optional --limit=N for testing.
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
const BUCKET = 'campaign-assets';
const REPO = '/Users/mohitkourav/Code/social-media-automation';
const LIMIT = (() => { const a = process.argv.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1]) : Infinity; })();

const ACCT_CAMPAIGN: Record<string, string> = {
  'yournotetaker': 'minutewise', 'grow.with.claudia': 'minutewise',
  'grow.withamanda': 'minutewise', 'miniutewise_thomas': 'roastai',
};

(async () => {
  const { data: camps } = await sb.from('campaigns').select('id,slug');
  const campId: Record<string, string> = {};
  for (const c of camps ?? []) campId[c.slug] = c.id;

  const { data: existing } = await sb.from('posts').select('id').eq('status', 'banked');
  const have = new Set((existing ?? []).map(r => r.id));

  let uploaded = 0, skipped = 0, failed = 0;
  outer:
  for (const flow of ['flow1', 'flow2', 'flow3']) {
    const base = join(REPO, 'posts', flow);
    let dirs: string[] = [];
    try { dirs = await readdir(base); } catch { continue; }
    for (const dir of dirs) {
      if (!dir.startsWith('2026-')) continue;
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
      const slug = ACCT_CAMPAIGN[handle] || 'minutewise';
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
        date: '2026-06-30',
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
