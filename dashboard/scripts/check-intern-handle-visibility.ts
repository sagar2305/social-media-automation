/**
 * Check whether the intern tile's `handle` is actually VISIBLE on the
 * page, vs just buried in the RSC payload. Counts occurrences inside
 * visible <body> markup vs inside <script> tags.
 */

import { cmsDefaults } from "../src/lib/cms-defaults";

const TOKEN = process.argv[2];
const PROJECT_REF = "mkqarsodftnlcuscsrii";
const HOST = "http://localhost:3000";

async function runSql(sql: string) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
}

(async () => {
  const MARK = "@INTERN-HANDLE-CHECK-XYZ";
  const content = {
    ...cmsDefaults.brief,
    internShowcase: {
      heading: cmsDefaults.brief.internShowcase.heading,
      subtitle: cmsDefaults.brief.internShowcase.subtitle,
      tiles: [{ handle: MARK, youtubeId: "TESTID", tiktokUrl: "https://tiktok.com/x" }],
    },
  };
  await runSql(`INSERT INTO public.cms_pages (slug, content) VALUES ('brief', $tag$${JSON.stringify(content)}$tag$::jsonb) ON CONFLICT (slug) DO UPDATE SET content = EXCLUDED.content, updated_at = now();`);

  const html = await (await fetch(`${HOST}/creator/brief?_=${Date.now()}`, { cache: "no-store" })).text();

  // Count occurrences in <script> RSC payloads vs everywhere else.
  const scriptRegex = /<script[^>]*>[\s\S]*?<\/script>/g;
  const inScripts = (html.match(scriptRegex) || []).join("").split(MARK).length - 1;
  const total = html.split(MARK).length - 1;
  const visible = total - inScripts;

  console.log(`Total occurrences of "${MARK}" in HTML:        ${total}`);
  console.log(`  inside <script> tags (RSC payload, hidden): ${inScripts}`);
  console.log(`  outside <script> (visible text):            ${visible}`);
  console.log();
  if (visible > 0) console.log("✓ Handle IS rendered as visible text.");
  else console.log("✗ Handle is in the data but NOT shown as visible text on the page.");

  await runSql(`DELETE FROM public.cms_pages WHERE slug='brief'; DELETE FROM public.cms_page_versions WHERE slug='brief';`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
