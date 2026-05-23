/**
 * One-shot end-to-end smoke test for the Signup Control CMS.
 *
 * For each slug:
 *   1. Build a copy of the baked-in defaults with a unique marker
 *      embedded in a visible field (so the live page must show it).
 *   2. Upsert the row via the Supabase Management API (DDL-capable).
 *   3. Curl the live creator-facing route with a cache-bust query
 *      param and assert the marker is in the HTML.
 *   4. Delete the row.
 *   5. Curl again, assert the page reverted to a default-only marker.
 *
 * Run:  npx tsx scripts/cms-roundtrip-smoke.ts <ACCESS_TOKEN>
 */

import { cmsDefaults } from "../src/lib/cms-defaults";
import type { CmsSlug } from "../src/lib/cms-schemas";

const TOKEN = process.argv[2];
const PROJECT_REF = "mkqarsodftnlcuscsrii";
const HOST = "http://localhost:3000";

if (!TOKEN) {
  console.error("Usage: tsx scripts/cms-roundtrip-smoke.ts <SUPABASE_ACCESS_TOKEN>");
  process.exit(1);
}

interface Probe {
  slug: CmsSlug;
  livePath: string;
  // Mutate the default content to embed `marker` somewhere visible in HTML.
  // Return the modified content. The marker must be plain text — no HTML.
  inject: (marker: string, base: typeof cmsDefaults[CmsSlug]) => unknown;
  // String we expect to find in the *default* HTML (i.e. after the row is
  // deleted) — proves the page reverted.
  defaultMarker: string;
}

const probes: Probe[] = [
  {
    slug: "brief",
    livePath: "/creator/brief",
    inject: (marker, base) => {
      const b = base as typeof cmsDefaults.brief;
      return { ...b, hero: { ...b.hero, heading: marker } };
    },
    defaultMarker: cmsDefaults.brief.hero.heading,
  },
  {
    slug: "tiktok-setup",
    livePath: "/creator/setup/tiktok",
    inject: (marker, base) => {
      const t = base as typeof cmsDefaults["tiktok-setup"];
      return { ...t, hero: { ...t.hero, heading: marker } };
    },
    defaultMarker: cmsDefaults["tiktok-setup"].hero.heading,
  },
  {
    slug: "welcome",
    livePath: "/welcome",
    inject: (marker, base) => {
      const w = base as typeof cmsDefaults.welcome;
      return { ...w, hero: { ...w.hero, title: marker } };
    },
    defaultMarker: cmsDefaults.welcome.hero.title,
  },
  {
    slug: "auth-form",
    livePath: "/creator/login",
    inject: (marker, base) => {
      const a = base as typeof cmsDefaults["auth-form"];
      return { ...a, hero: { ...a.hero, heading: marker } };
    },
    defaultMarker: cmsDefaults["auth-form"].hero.heading,
  },
];

async function runSql(sql: string): Promise<unknown> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase ${res.status}: ${txt}`);
  }
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
  const marker = `SMOKE-${p.slug}-${Date.now()}`;
  const content = p.inject(marker, cmsDefaults[p.slug]);
  const json = JSON.stringify(content).replace(/'/g, "''");

  // Step 1 — write
  await runSql(
    `INSERT INTO public.cms_pages (slug, content) VALUES ('${p.slug}', '${json}'::jsonb)
     ON CONFLICT (slug) DO UPDATE SET content = EXCLUDED.content, updated_at = now();`,
  );

  // Step 2 — live page should contain marker
  const seenMarker = await htmlIncludes(p.livePath, marker);

  // Step 3 — delete
  await runSql(`DELETE FROM public.cms_pages WHERE slug = '${p.slug}';`);

  // Step 4 — defaults should return
  const seenDefault = await htmlIncludes(p.livePath, p.defaultMarker);

  const pass = seenMarker && seenDefault;
  console.log(
    `${pass ? "✓" : "✗"} ${p.slug.padEnd(14)} ` +
      `write→see-on-page=${seenMarker ? "yes" : "NO"}  ` +
      `delete→defaults-return=${seenDefault ? "yes" : "NO"}`,
  );
  return pass;
}

(async () => {
  console.log(`Running CMS round-trip smoke test against ${HOST}\n`);
  let allPass = true;
  for (const p of probes) {
    try {
      const ok = await runProbe(p);
      if (!ok) allPass = false;
    } catch (e) {
      console.log(`✗ ${p.slug.padEnd(14)} THREW: ${(e as Error).message}`);
      allPass = false;
    }
  }
  console.log(`\n${allPass ? "ALL PASS ✅" : "FAILURES ❌"}`);
  process.exit(allPass ? 0 : 1);
})();
