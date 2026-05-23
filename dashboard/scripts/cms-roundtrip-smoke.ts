/**
 * One-shot end-to-end smoke test for the Signup Control CMS.
 *
 * For each (campaign, slug) pair:
 *   1. Build a copy of the per-campaign defaults with a unique marker
 *      embedded in a visible field (so the live page must show it).
 *   2. Upsert the row via the Supabase Management API (DDL-capable).
 *   3. Curl the live creator-facing route with a cache-bust query
 *      param and assert the marker is in the HTML.
 *   4. Delete the row.
 *   5. Curl again, assert the page reverted to a default-only marker.
 *
 * Run:  npx tsx scripts/cms-roundtrip-smoke.ts <ACCESS_TOKEN>
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
  console.error("Usage: tsx scripts/cms-roundtrip-smoke.ts <SUPABASE_ACCESS_TOKEN>");
  process.exit(1);
}

interface Probe {
  slug: Exclude<CmsSlug, "campaign-theme">;
  campaign: Campaign;
  livePath: string;
  /** Mutate the default content to embed `marker` somewhere visible. */
  inject: (marker: string, base: unknown) => unknown;
  /** A string from the *defaults* — must appear after the row is deleted. */
  defaultMarker: string;
}

/** Slugs the smoke test exercises. `campaign-theme` has no visible
 *  text — it's a single-field theme picker — so writing a "marker"
 *  string into it wouldn't make sense; skip. */
type AuditableSlug = Exclude<CmsSlug, "campaign-theme">;
const AUDITABLE_SLUGS = CMS_SLUGS.filter(
  (s): s is AuditableSlug => s !== "campaign-theme",
);

function livePathFor(slug: AuditableSlug, campaign: Campaign): string {
  switch (slug) {
    case "brief": return `/creator/${campaign}/brief`;
    case "tiktok-setup": return `/creator/${campaign}/setup/tiktok`;
    case "auth-form": return `/creator/${campaign}/login`;
    case "welcome": return `/welcome`;
  }
}

const INJECTORS: Record<AuditableSlug, Probe["inject"]> = {
  brief: (marker, base) => {
    const b = base as ReturnType<typeof defaultsFor<"brief">>;
    return { ...b, hero: { ...b.hero, heading: marker } };
  },
  "tiktok-setup": (marker, base) => {
    const t = base as ReturnType<typeof defaultsFor<"tiktok-setup">>;
    return { ...t, hero: { ...t.hero, heading: marker } };
  },
  welcome: (marker, base) => {
    const w = base as ReturnType<typeof defaultsFor<"welcome">>;
    return { ...w, hero: { ...w.hero, title: marker } };
  },
  "auth-form": (marker, base) => {
    const a = base as ReturnType<typeof defaultsFor<"auth-form">>;
    return { ...a, hero: { ...a.hero, heading: marker } };
  },
};

function defaultMarkerFor(slug: AuditableSlug, campaign: Campaign): string {
  const d = defaultsFor(slug, campaign);
  switch (slug) {
    case "brief":         return (d as ReturnType<typeof defaultsFor<"brief">>).hero.heading;
    case "tiktok-setup":  return (d as ReturnType<typeof defaultsFor<"tiktok-setup">>).hero.heading;
    case "welcome":       return (d as ReturnType<typeof defaultsFor<"welcome">>).hero.title;
    case "auth-form":     return (d as ReturnType<typeof defaultsFor<"auth-form">>).hero.heading;
  }
}

/**
 * Build the full probe list. Welcome is shared across campaigns so we
 * only probe it once (with campaign=minutewise as the trigger, but the
 * row is stored under '_shared').
 */
function buildProbes(): Probe[] {
  const probes: Probe[] = [];
  for (const campaign of CAMPAIGNS) {
    for (const slug of AUDITABLE_SLUGS) {
      if (slugScope[slug] === "shared" && campaign !== "minutewise") continue;
      probes.push({
        slug,
        campaign,
        livePath: livePathFor(slug, campaign),
        inject: INJECTORS[slug],
        defaultMarker: defaultMarkerFor(slug, campaign),
      });
    }
  }
  return probes;
}

async function runSql(sql: string): Promise<unknown> {
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

async function htmlIncludes(path: string, needle: string): Promise<boolean> {
  const url = `${HOST}${path}?_=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    console.error(`  ✗ ${url} returned ${res.status}`);
    return false;
  }
  const html = await res.text();
  return html.includes(needle);
}

async function runProbe(p: Probe): Promise<boolean> {
  const marker = `SMOKE-${p.campaign}-${p.slug}-${Date.now()}`;
  const base = defaultsFor(p.slug, p.campaign);
  const content = p.inject(marker, base);
  const campaignKey = resolveCampaignKey(p.slug, p.campaign);
  // Use $tag$ dollar quoting so JSON containing single quotes serializes safely.
  const jsonLit = JSON.stringify(content);

  await runSql(
    `INSERT INTO public.cms_pages (campaign, slug, content) VALUES
       ('${campaignKey}', '${p.slug}', $tag$${jsonLit}$tag$::jsonb)
     ON CONFLICT (campaign, slug) DO UPDATE
       SET content = EXCLUDED.content, updated_at = now();`,
  );

  const seenMarker = await htmlIncludes(p.livePath, marker);

  await runSql(
    `DELETE FROM public.cms_pages WHERE campaign='${campaignKey}' AND slug='${p.slug}';
     DELETE FROM public.cms_page_versions WHERE campaign='${campaignKey}' AND slug='${p.slug}';`,
  );

  const seenDefault = await htmlIncludes(p.livePath, p.defaultMarker);

  const pass = seenMarker && seenDefault;
  console.log(
    `${pass ? "✓" : "✗"} ${`${p.campaign}/${p.slug}`.padEnd(28)} ` +
      `write→see-on-page=${seenMarker ? "yes" : "NO"}  ` +
      `delete→defaults-return=${seenDefault ? "yes" : "NO"}`,
  );
  return pass;
}

(async () => {
  console.log(`Running CMS round-trip smoke test against ${HOST}\n`);
  const probes = buildProbes();
  let allPass = true;
  for (const p of probes) {
    try {
      const ok = await runProbe(p);
      if (!ok) allPass = false;
    } catch (e) {
      console.log(`✗ ${p.campaign}/${p.slug} THREW: ${(e as Error).message}`);
      allPass = false;
    }
  }
  console.log(`\n${allPass ? "ALL PASS ✅" : "FAILURES ❌"}`);
  process.exit(allPass ? 0 : 1);
})();
