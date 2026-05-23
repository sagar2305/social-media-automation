/**
 * Check whether the intern tile's `handle` is actually VISIBLE on the
 * page, vs just buried in the RSC payload. Counts occurrences inside
 * visible <body> markup vs inside <script> tags.
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
  console.error("Usage: tsx scripts/check-intern-handle-visibility.ts <SUPABASE_ACCESS_TOKEN> [campaign=minutewise]");
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
  const MARK = "@INTERN-HANDLE-CHECK-XYZ";
  const base = defaultsFor("brief", CAMPAIGN);
  const content = {
    ...base,
    internShowcase: {
      heading: base.internShowcase.heading,
      subtitle: base.internShowcase.subtitle,
      tiles: [{ handle: MARK, youtubeId: "TESTID", tiktokUrl: "https://tiktok.com/x" }],
    },
  };
  await runSql(`INSERT INTO public.cms_pages (campaign, slug, content) VALUES ('${CAMPAIGN}', 'brief', $tag$${JSON.stringify(content)}$tag$::jsonb) ON CONFLICT (campaign, slug) DO UPDATE SET content = EXCLUDED.content, updated_at = now();`);

  try {
    const html = await (await fetch(`${HOST}/creator/${CAMPAIGN}/brief?_=${Date.now()}`, { cache: "no-store" })).text();

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
  } finally {
    // Cleanup runs even if the fetch/parse threw, so probe rows don't
    // pollute the DB between runs.
    await runSql(`DELETE FROM public.cms_pages WHERE campaign='${CAMPAIGN}' AND slug='brief'; DELETE FROM public.cms_page_versions WHERE campaign='${CAMPAIGN}' AND slug='brief';`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
