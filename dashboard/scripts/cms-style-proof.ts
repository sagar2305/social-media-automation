/**
 * Proof that per-text styling reflects on the live page.
 *
 *   npx tsx scripts/cms-style-proof.ts <SUPABASE_ACCESS_TOKEN>
 *
 * 1. Inserts a brief row with a styles map: `hero.heading` gets a
 *    big italic Brush Script in red.
 * 2. Fetches /creator/brief and asserts the inline style attribute
 *    contains the size / color / font-style / font-family we set.
 * 3. Cleans up.
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
  console.error("Usage: tsx scripts/cms-style-proof.ts <SUPABASE_ACCESS_TOKEN> [campaign=minutewise]");
  process.exit(1);
}

async function runSql(sql: string) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

(async () => {
  const base = defaultsFor("brief", CAMPAIGN);
  const styled = {
    ...base,
    hero: { ...base.hero, heading: "STYLED HEADING TEST" },
    styles: {
      "hero.heading": {
        size: "4.5rem",
        weight: "800" as const,
        color: "#d8312f",
        fontStyle: "italic" as const,
        fontFamily: "Brush Script MT, cursive",
      },
    },
  };

  // Inline the JSON with dollar-quoted Postgres strings (no escaping).
  const jsonLiteral = JSON.stringify(styled);
  await runSql(
    `INSERT INTO public.cms_pages (campaign, slug, content) VALUES ('${CAMPAIGN}', 'brief', $tag$${jsonLiteral}$tag$::jsonb) ON CONFLICT (campaign, slug) DO UPDATE SET content = EXCLUDED.content, updated_at = now();`,
  );

  let pass = false;
  try {
    const url = `${HOST}/creator/${CAMPAIGN}/brief?_=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    const html = await res.text();

    const checks: [string, RegExp][] = [
      ["1) Heading text present                ", /STYLED HEADING TEST/],
      ["2) Inline font-size: 4.5rem            ", /font-size:\s*4\.5rem/],
      ["3) Inline color (#d8312f or rgb form)  ", /color:\s*(#d8312f|rgb\(216,\s*49,\s*47\))/i],
      ["4) Inline font-style: italic           ", /font-style:\s*italic/],
      ["5) Brush Script font-family            ", /font-family:[^;"]*Brush Script/],
      ["6) Inline font-weight: 800             ", /font-weight:\s*800/],
    ];

    pass = true;
    for (const [label, re] of checks) {
      const ok = re.test(html);
      if (!ok) pass = false;
      console.log(`${ok ? "✓" : "✗"} ${label}`);
    }
  } finally {
    // Cleanup always runs, even if fetch/parse threw — leaving probe
    // rows behind would skew the next run.
    await runSql(`DELETE FROM public.cms_pages WHERE campaign='${CAMPAIGN}' AND slug='brief'; DELETE FROM public.cms_page_versions WHERE campaign='${CAMPAIGN}' AND slug='brief';`);
  }

  console.log("");
  console.log(pass ? "ALL CHECKS PASS ✅" : "FAILURES ❌");
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
