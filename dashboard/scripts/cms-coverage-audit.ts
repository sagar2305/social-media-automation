/**
 * CMS coverage audit — proves every text field that an admin can edit
 * actually appears on the live page.
 *
 * For each (campaign, slug) pair:
 *   1. Take the per-campaign defaults.
 *   2. Walk every string leaf and replace it with a unique marker.
 *   3. Upsert that content into cms_pages.
 *   4. Fetch the live /creator/<campaign>/* HTML.
 *   5. For each marker, check whether it appears in the HTML.
 *   6. Report any missing — those are real bugs (admin saves field, page
 *      never renders it).
 *   7. Clean up.
 *
 * Welcome is a shared slug; it's audited once against /welcome.
 *
 * Usage:  npx tsx scripts/cms-coverage-audit.ts <SUPABASE_ACCESS_TOKEN>
 */

import { defaultsFor } from "../src/lib/cms-defaults";
import {
  CAMPAIGNS,
  CMS_SLUGS,
  resolveCampaignKey,
  slugScope,
  type CmsSlug,
  type Campaign,
} from "../src/lib/cms-schemas";

const TOKEN = process.argv[2];
const PROJECT_REF = "mkqarsodftnlcuscsrii";
const HOST = "http://localhost:3000";

if (!TOKEN) {
  console.error("Usage: tsx scripts/cms-coverage-audit.ts <SUPABASE_ACCESS_TOKEN>");
  process.exit(1);
}

/** Skip the `campaign-theme` slug — it's a single-field theme picker
 *  with no visible text, so the coverage check would always be empty. */
type AuditableSlug = Exclude<CmsSlug, "campaign-theme">;
const AUDITABLE_SLUGS = CMS_SLUGS.filter(
  (s): s is AuditableSlug => s !== "campaign-theme",
);

interface Probe {
  slug: AuditableSlug;
  campaign: Campaign;
  livePaths: string[];
}

function livePathsFor(slug: AuditableSlug, campaign: Campaign): string[] {
  switch (slug) {
    case "brief": return [`/creator/${campaign}/brief`];
    case "tiktok-setup": return [`/creator/${campaign}/setup/tiktok`];
    case "auth-form": return [`/creator/${campaign}/login`, `/creator/${campaign}/signup`];
    case "welcome": return ["/welcome"];
  }
}

function buildProbes(): Probe[] {
  const probes: Probe[] = [];
  for (const campaign of CAMPAIGNS) {
    for (const slug of AUDITABLE_SLUGS) {
      if (slugScope[slug] === "shared" && campaign !== "minutewise") continue;
      probes.push({ slug, campaign, livePaths: livePathsFor(slug, campaign) });
    }
  }
  return probes;
}

function instrument(obj: unknown, label: string): { content: unknown; markers: Map<string, string> } {
  const markers = new Map<string, string>();
  function walk(value: unknown, path: string[]): unknown {
    if (typeof value === "string") {
      const key = path.join(".");
      const last = path[path.length - 1] || "";
      if (/(?:Url|Href|url|href|email)$/i.test(last)) return value;
      if (last === "loomEmbedId" || last === "youtubeId") return value;
      if (last === "icon" || last === "kind" || last === "platform") return value;
      const marker = `MARKER-${label}-${key.replace(/\./g, "_")}-${Math.random().toString(36).slice(2, 7)}`;
      markers.set(key, marker);
      return marker;
    }
    if (Array.isArray(value)) return value.map((v, i) => walk(v, [...path, String(i)]));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = walk(v, [...path, k]);
      return out;
    }
    return value;
  }
  return { content: walk(obj, []), markers };
}

async function runSql(sql: string): Promise<void> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
}

async function fetchHtml(path: string): Promise<string> {
  const r = await fetch(`${HOST}${path}?_=${Date.now()}`, { cache: "no-store" });
  return r.text();
}

async function auditProbe(p: Probe): Promise<{ label: string; missing: string[]; total: number }> {
  const label = `${p.campaign}/${p.slug}`;
  const base = defaultsFor(p.slug, p.campaign);
  const { content, markers } = instrument(base, label.replace(/\//g, "-"));
  const campaignKey = resolveCampaignKey(p.slug, p.campaign);

  const jsonLiteral = JSON.stringify(content);
  await runSql(
    `INSERT INTO public.cms_pages (campaign, slug, content) VALUES
       ('${campaignKey}', '${p.slug}', $tag$${jsonLiteral}$tag$::jsonb)
     ON CONFLICT (campaign, slug) DO UPDATE
       SET content = EXCLUDED.content, updated_at = now();`,
  );

  const allHtml = (await Promise.all(p.livePaths.map(fetchHtml))).join("\n");
  const missing: string[] = [];
  for (const [path, marker] of markers) {
    if (!allHtml.includes(marker)) missing.push(path);
  }

  await runSql(
    `DELETE FROM public.cms_pages WHERE campaign='${campaignKey}' AND slug='${p.slug}';
     DELETE FROM public.cms_page_versions WHERE campaign='${campaignKey}' AND slug='${p.slug}';`,
  );

  return { label, missing, total: markers.size };
}

(async () => {
  console.log("CMS coverage audit — verifying every editable text field reflects on the live page.\n");
  let overallOk = true;
  for (const p of buildProbes()) {
    const { label, missing, total } = await auditProbe(p);
    if (missing.length === 0) {
      console.log(`✓ ${label.padEnd(28)} ${total} fields — all render`);
    } else {
      overallOk = false;
      console.log(`✗ ${label.padEnd(28)} ${total - missing.length}/${total} render. MISSING (${missing.length}):`);
      for (const path of missing) console.log(`    • ${path}`);
    }
  }
  console.log(`\n${overallOk ? "ALL FIELDS RENDER ✅" : "SOME FIELDS DO NOT RENDER ❌ — see paths above"}`);
  process.exit(overallOk ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
