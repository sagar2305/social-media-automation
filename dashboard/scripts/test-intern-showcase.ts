/**
 * One-shot end-to-end test for the intern-showcase section.
 *   npx tsx scripts/test-intern-showcase.ts <SUPABASE_ACCESS_TOKEN>
 */

import { defaultsFor } from "../src/lib/cms-defaults";

const ALLOWED_CAMPAIGNS = ["minutewise", "roastai", "call-recorder"] as const;
type AllowedCampaign = (typeof ALLOWED_CAMPAIGNS)[number];

const TOKEN = process.argv[2];
const campaignArg = process.argv[3] ?? "minutewise";
if (!ALLOWED_CAMPAIGNS.includes(campaignArg as AllowedCampaign)) {
  console.error(`Invalid campaign "${campaignArg}". Expected one of: ${ALLOWED_CAMPAIGNS.join(", ")}`);
  process.exit(1);
}
const CAMPAIGN: AllowedCampaign = campaignArg as AllowedCampaign;
const PROJECT_REF = "mkqarsodftnlcuscsrii";
const HOST = "http://localhost:3000";

if (!TOKEN) {
  console.error("Usage: tsx scripts/test-intern-showcase.ts <SUPABASE_ACCESS_TOKEN> [campaign=minutewise]");
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
  const base = defaultsFor("brief", CAMPAIGN);
  const content = {
    ...base,
    internShowcase: {
      heading: "SHOWCASE-HEAD-XYZ",
      subtitle: "SHOWCASE-SUB-XYZ",
      tiles: [
        { handle: "@TEST-HANDLE-UNIQUE-XYZ", youtubeId: "TESTYOUTUBEID", tiktokUrl: "https://tiktok.com/TEST-TIKTOK-URL-XYZ" },
      ],
    },
  };

  const jsonLit = JSON.stringify(content);
  await runSql(`INSERT INTO public.cms_pages (campaign, slug, content) VALUES ('${CAMPAIGN}', 'brief', $tag$${jsonLit}$tag$::jsonb) ON CONFLICT (campaign, slug) DO UPDATE SET content = EXCLUDED.content, updated_at = now();`);
  console.log("Wrote test row.");

  let allPass = false;
  try {
    const html = await (await fetch(`${HOST}/creator/${CAMPAIGN}/brief?_=${Date.now()}`, { cache: "no-store" })).text();

    const checks: [string, RegExp][] = [
      ["Showcase heading 'SHOWCASE-HEAD-XYZ'         ", /SHOWCASE-HEAD-XYZ/],
      ["Showcase subtitle 'SHOWCASE-SUB-XYZ'         ", /SHOWCASE-SUB-XYZ/],
      ["Tile handle '@TEST-HANDLE-UNIQUE-XYZ'        ", /@TEST-HANDLE-UNIQUE-XYZ/],
      ["YouTube embed src=TESTYOUTUBEID              ", /embed\/TESTYOUTUBEID/],
      ["TikTok href contains TEST-TIKTOK-URL-XYZ     ", /TEST-TIKTOK-URL-XYZ/],
    ];

    allPass = true;
    for (const [label, re] of checks) {
      const ok = re.test(html);
      if (!ok) allPass = false;
      console.log(`  ${ok ? "✓" : "✗"} ${label}`);
    }
  } finally {
    // Always clean up the probe row, even if the fetch/check threw.
    await runSql(`DELETE FROM public.cms_pages WHERE campaign='${CAMPAIGN}' AND slug='brief'; DELETE FROM public.cms_page_versions WHERE campaign='${CAMPAIGN}' AND slug='brief';`);
    console.log("\nCleanup done.");
  }
  console.log(allPass ? "\nALL PASS ✅" : "\nSOME FIELDS DON'T RENDER ❌");
  process.exit(allPass ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
