/**
 * CMS coverage audit — proves every text field that an admin can edit
 * actually appears on the live page.
 *
 * For each of the 4 slugs:
 *   1. Take the baked-in defaults.
 *   2. Walk every string leaf and replace it with a unique marker.
 *   3. Upsert that content into cms_pages.
 *   4. Fetch the live /creator/* HTML.
 *   5. For each marker, check whether it appears in the HTML.
 *   6. Report any missing — those are real bugs (admin saves field, page
 *      never renders it).
 *   7. Clean up.
 *
 * Usage:  npx tsx scripts/cms-coverage-audit.ts <SUPABASE_ACCESS_TOKEN>
 */

import { cmsDefaults } from "../src/lib/cms-defaults";
import type { CmsSlug } from "../src/lib/cms-schemas";

const TOKEN = process.argv[2];
const PROJECT_REF = "mkqarsodftnlcuscsrii";
const HOST = "http://localhost:3000";

if (!TOKEN) {
  console.error("Usage: tsx scripts/cms-coverage-audit.ts <SUPABASE_ACCESS_TOKEN>");
  process.exit(1);
}

interface Probe {
  slug: CmsSlug;
  livePaths: string[]; // live URLs to fetch — auth-form is on /creator/login + /creator/signup
}

const probes: Probe[] = [
  { slug: "brief",         livePaths: ["/creator/brief"] },
  { slug: "tiktok-setup",  livePaths: ["/creator/setup/tiktok"] },
  { slug: "welcome",       livePaths: ["/welcome"] },
  { slug: "auth-form",     livePaths: ["/creator/login", "/creator/signup"] },
];

/**
 * Walk an object and replace every string leaf with a unique marker.
 * Returns { markedContent, markers } where markers is a map of
 * path-as-string → marker text. We skip URL-looking fields because
 * those don't render as visible text (they're attribute values).
 */
function instrument(obj: unknown, slug: string): { content: unknown; markers: Map<string, string> } {
  const markers = new Map<string, string>();
  function walk(value: unknown, path: string[]): unknown {
    if (typeof value === "string") {
      const key = path.join(".");
      // Skip URL-ish fields (they render as href/src, not as visible text)
      if (/(?:Url|Href|url|href|email)$/i.test(path[path.length - 1] || "")) {
        return value;
      }
      // Skip the loomEmbedId / youtubeId since they render as iframe src
      if (path[path.length - 1] === "loomEmbedId" || path[path.length - 1] === "youtubeId") {
        return value;
      }
      // Skip icon enum values like "globe", "check" — they're not text
      if (path[path.length - 1] === "icon" || path[path.length - 1] === "kind") {
        return value;
      }
      // Skip platform enums
      if (path[path.length - 1] === "platform") {
        return value;
      }
      const marker = `MARKER-${slug}-${key.replace(/\./g, "_")}-${Math.random().toString(36).slice(2, 7)}`;
      markers.set(key, marker);
      return marker;
    }
    if (Array.isArray(value)) {
      return value.map((v, i) => walk(v, [...path, String(i)]));
    }
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

async function auditSlug(p: Probe): Promise<{ slug: CmsSlug; missing: string[]; total: number }> {
  const base = cmsDefaults[p.slug];
  const { content, markers } = instrument(base, p.slug);

  const jsonLiteral = JSON.stringify(content);
  await runSql(
    `INSERT INTO public.cms_pages (slug, content) VALUES ('${p.slug}', $tag$${jsonLiteral}$tag$::jsonb) ON CONFLICT (slug) DO UPDATE SET content = EXCLUDED.content, updated_at = now();`,
  );

  // Fetch every live path for this slug and concatenate. A field counts as
  // "rendered" if its marker appears in ANY of the slug's live paths.
  const allHtml = (await Promise.all(p.livePaths.map(fetchHtml))).join("\n");
  const missing: string[] = [];
  for (const [path, marker] of markers) {
    if (!allHtml.includes(marker)) missing.push(path);
  }

  await runSql(
    `DELETE FROM public.cms_pages WHERE slug = '${p.slug}'; DELETE FROM public.cms_page_versions WHERE slug = '${p.slug}';`,
  );

  return { slug: p.slug, missing, total: markers.size };
}

(async () => {
  console.log("CMS coverage audit — verifying every editable text field reflects on the live page.\n");
  let overallOk = true;
  for (const p of probes) {
    const { slug, missing, total } = await auditSlug(p);
    if (missing.length === 0) {
      console.log(`✓ ${slug.padEnd(14)} ${total} fields — all render on live page`);
    } else {
      overallOk = false;
      console.log(`✗ ${slug.padEnd(14)} ${total - missing.length}/${total} render. MISSING (${missing.length}):`);
      for (const path of missing) console.log(`    • ${path}`);
    }
  }
  console.log(`\n${overallOk ? "ALL FIELDS RENDER ✅" : "SOME FIELDS DO NOT RENDER ❌ — see paths above"}`);
  process.exit(overallOk ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
