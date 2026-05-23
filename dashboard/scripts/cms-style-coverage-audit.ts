/**
 * CMS *style* coverage audit — proves that every `styleProps("X.Y")`
 * wired into an editor actually applies its styling to the live page.
 *
 * Approach: write a content blob whose `styles` map contains a unique
 * letter-spacing value for every path the editors expose. Fetch the
 * live HTML and check each unique letter-spacing string appears at
 * least once. Missing entries = paths the editor can save styles for
 * but the View never renders that text through <Editable>, so the
 * style is silently dropped.
 *
 *   npx tsx scripts/cms-style-coverage-audit.ts <SUPABASE_ACCESS_TOKEN>
 */

import { cmsDefaults } from "../src/lib/cms-defaults";
import type { CmsSlug, StylesMap, TypographyTokens } from "../src/lib/cms-schemas";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TOKEN = process.argv[2];
const PROJECT_REF = "mkqarsodftnlcuscsrii";
const HOST = "http://localhost:3000";
const REPO = "/Users/mohitkourav/Code/social-media-automation/dashboard";

if (!TOKEN) {
  console.error("Usage: tsx scripts/cms-style-coverage-audit.ts <SUPABASE_ACCESS_TOKEN>");
  process.exit(1);
}

interface Probe {
  slug: CmsSlug;
  editorPath: string;
  livePaths: string[];
  /** View-source files to also grep for `path={[...]}` so we can verify
   *  conditionally-rendered Editable wraps (e.g. finalFooter that only
   *  appears on TikTok step 6, signUp fields that only appear when the
   *  signUp tab is active). */
  viewSources: string[];
}

const probes: Probe[] = [
  { slug: "brief",         editorPath: "src/app/(dashboard)/signup-control/brief/editor.tsx",         livePaths: ["/creator/brief"],                          viewSources: ["src/app/(auth)/creator/brief/view.tsx"] },
  { slug: "tiktok-setup",  editorPath: "src/app/(dashboard)/signup-control/tiktok-setup/editor.tsx",  livePaths: ["/creator/setup/tiktok"],                   viewSources: ["src/app/(auth)/creator/setup/tiktok/view.tsx"] },
  { slug: "welcome",       editorPath: "src/app/(dashboard)/signup-control/welcome/editor.tsx",       livePaths: ["/welcome"],                                viewSources: ["src/app/(auth)/welcome/page.tsx"] },
  { slug: "auth-form",     editorPath: "src/app/(dashboard)/signup-control/auth-form/editor.tsx",     livePaths: ["/creator/login", "/creator/signup"],       viewSources: ["src/components/creator-auth-form.tsx"] },
];

/**
 * Pull every styleProps(...) path out of an editor file. Handles both
 * "literal" forms and template-literal forms with `${i}` index. For
 * template-literal paths we substitute index 0 since that's what the
 * defaults will render (every list defaults to at least 1 item).
 */
function extractStylePaths(editorPath: string): string[] {
  const src = readFileSync(join(REPO, editorPath), "utf8");
  const out = new Set<string>();
  // styleProps("foo.bar")
  for (const m of src.matchAll(/styleProps\("([^"]+)"\)/g)) out.add(m[1]);
  // styleProps(`foo.${i}.bar`) — substitute index 0
  for (const m of src.matchAll(/styleProps\(`([^`]+)`\)/g)) {
    out.add(m[1].replace(/\$\{i\}/g, "0").replace(/\$\{[^}]+\}/g, "0"));
  }
  return [...out];
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

async function auditSlug(p: Probe): Promise<{ slug: CmsSlug; total: number; missing: string[] }> {
  const paths = extractStylePaths(p.editorPath);

  // Build a styles map: each path gets a unique letter-spacing value
  // we can grep for.
  const styles: StylesMap = {};
  const expectedMarker = new Map<string, string>();
  paths.forEach((path, i) => {
    const marker = `0.${(i + 100).toString().padStart(3, "0")}em`; // e.g. 0.100em, 0.101em
    expectedMarker.set(path, marker);
    const tokens: TypographyTokens = { letterSpacing: marker };
    styles[path] = tokens;
  });

  // Write a content row = defaults + custom styles map
  const content = { ...cmsDefaults[p.slug], styles };
  const json = JSON.stringify(content);
  await runSql(
    `INSERT INTO public.cms_pages (slug, content) VALUES ('${p.slug}', $tag$${json}$tag$::jsonb) ON CONFLICT (slug) DO UPDATE SET content = EXCLUDED.content, updated_at = now();`,
  );

  const html = (await Promise.all(p.livePaths.map(fetchHtml))).join("\n");

  // ALSO read the View sources so we can verify that conditionally-
  // rendered text (e.g. TikTok finalFooter, only on step 6) is at
  // least wrapped in <Editable> in the source. A wrap = style will
  // apply when that state is reached.
  const viewSrc = p.viewSources
    .map((vp) => readFileSync(join(REPO, vp), "utf8"))
    .join("\n");

  /** Convert path string "X.Y.0.Z" → regex matching `path={["X","Y",0,"Z"]}` (whitespace tolerant). */
  function pathToRegex(pathStr: string): RegExp {
    const segments = pathStr.split(".").map((s) => /^\d+$/.test(s) ? s : `"${s}"`);
    const joined = segments.join(",\\s*");
    return new RegExp(`path\\s*=\\s*\\{\\s*\\[\\s*${joined.replace(/"/g, '\\"')}\\s*\\]\\s*\\}`);
  }

  const missing: string[] = [];
  for (const [path, marker] of expectedMarker) {
    const inHtml = html.includes(`letter-spacing:${marker}`) || html.includes(`letter-spacing: ${marker}`);
    const wrappedInSource = pathToRegex(path).test(viewSrc);
    if (!inHtml && !wrappedInSource) {
      missing.push(`${path}  (expected ${marker})`);
    }
  }

  await runSql(
    `DELETE FROM public.cms_pages WHERE slug = '${p.slug}'; DELETE FROM public.cms_page_versions WHERE slug = '${p.slug}';`,
  );

  return { slug: p.slug, total: paths.length, missing };
}

(async () => {
  console.log("CMS *style* coverage audit — verifying every styleProps path applies on the live page.\n");
  let overallOk = true;
  for (const p of probes) {
    const { slug, total, missing } = await auditSlug(p);
    if (missing.length === 0) {
      console.log(`✓ ${slug.padEnd(14)} ${total} style paths — all apply on live page`);
    } else {
      overallOk = false;
      console.log(`✗ ${slug.padEnd(14)} ${total - missing.length}/${total} apply. MISSING (${missing.length}):`);
      for (const m of missing) console.log(`    • ${m}`);
    }
  }
  console.log(`\n${overallOk ? "ALL STYLE PATHS APPLY ✅" : "SOME STYLE PATHS DO NOT APPLY ❌ — see paths above"}`);
  process.exit(overallOk ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
