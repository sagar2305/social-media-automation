/**
 * One-shot end-to-end test for the intern-showcase section.
 *   npx tsx scripts/test-intern-showcase.ts <SUPABASE_ACCESS_TOKEN>
 */

import { cmsDefaults } from "../src/lib/cms-defaults";

const TOKEN = process.argv[2];
const PROJECT_REF = "mkqarsodftnlcuscsrii";
const HOST = "http://localhost:3000";

if (!TOKEN) {
  console.error("Usage: tsx scripts/test-intern-showcase.ts <SUPABASE_ACCESS_TOKEN>");
  process.exit(1);
}

async function runSql(sql: string) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
}

(async () => {
  // Build a content blob that exercises the intern showcase
  const content = {
    ...cmsDefaults.brief,
    internShowcase: {
      heading: "SHOWCASE-HEAD-XYZ",
      subtitle: "SHOWCASE-SUB-XYZ",
      tiles: [
        { handle: "@TEST-HANDLE-UNIQUE-XYZ", youtubeId: "TESTYOUTUBEID", tiktokUrl: "https://tiktok.com/TEST-TIKTOK-URL-XYZ" },
      ],
    },
  };

  const jsonLit = JSON.stringify(content);
  await runSql(`INSERT INTO public.cms_pages (slug, content) VALUES ('brief', $tag$${jsonLit}$tag$::jsonb) ON CONFLICT (slug) DO UPDATE SET content = EXCLUDED.content, updated_at = now();`);
  console.log("Wrote test row.");

  const html = await (await fetch(`${HOST}/creator/brief?_=${Date.now()}`, { cache: "no-store" })).text();

  const checks: [string, RegExp][] = [
    ["Showcase heading 'SHOWCASE-HEAD-XYZ'         ", /SHOWCASE-HEAD-XYZ/],
    ["Showcase subtitle 'SHOWCASE-SUB-XYZ'         ", /SHOWCASE-SUB-XYZ/],
    ["Tile handle '@TEST-HANDLE-UNIQUE-XYZ'        ", /@TEST-HANDLE-UNIQUE-XYZ/],
    ["YouTube embed src=TESTYOUTUBEID              ", /embed\/TESTYOUTUBEID/],
    ["TikTok href contains TEST-TIKTOK-URL-XYZ     ", /TEST-TIKTOK-URL-XYZ/],
  ];

  let allPass = true;
  for (const [label, re] of checks) {
    const ok = re.test(html);
    if (!ok) allPass = false;
    console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  }

  await runSql(`DELETE FROM public.cms_pages WHERE slug='brief'; DELETE FROM public.cms_page_versions WHERE slug='brief';`);
  console.log("\nCleanup done.");
  console.log(allPass ? "\nALL PASS ✅" : "\nSOME FIELDS DON'T RENDER ❌");
  process.exit(allPass ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
