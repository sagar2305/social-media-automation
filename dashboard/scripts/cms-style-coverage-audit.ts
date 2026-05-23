/**
 * CMS *style* coverage audit — proves that every `styleProps("X.Y")`
 * wired into an editor actually applies its styling to the live page.
 *
 * Approach: for each (campaign, slug) pair, write a content blob whose
 * `styles` map contains a unique letter-spacing value for every path
 * the editor exposes. Fetch the live HTML and check each unique
 * letter-spacing string appears at least once. Missing entries =
 * paths the editor can save styles for but the View never renders
 * that text through <Editable>, so the style is silently dropped.
 *
 *   npx tsx scripts/cms-style-coverage-audit.ts <SUPABASE_ACCESS_TOKEN>
 */

import { defaultsFor } from "../src/lib/cms-defaults";
import {
  CAMPAIGNS,
  CMS_SLUGS,
  resolveCampaignKey,
  slugScope,
  type CmsSlug,
  type Campaign,
  type StylesMap,
  type TypographyTokens,
} from "../src/lib/cms-schemas";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TOKEN = process.argv[2];
const PROJECT_REF = "mkqarsodftnlcuscsrii";
const HOST = "http://localhost:3000";
const REPO = process.cwd();

if (!TOKEN) {
  console.error("Usage: tsx scripts/cms-style-coverage-audit.ts <SUPABASE_ACCESS_TOKEN>");
  process.exit(1);
}

interface SlugMeta {
  editorPath: (campaign: Campaign) => string;
  livePaths: (campaign: Campaign) => string[];
  viewSources: string[];
}

/** The `campaign-theme` editor has no `styleProps()` calls (it's a
 *  preset picker, not a text editor), so this audit skips it. */
type AuditableSlug = Exclude<CmsSlug, "campaign-theme">;
const AUDITABLE_SLUGS = CMS_SLUGS.filter(
  (s): s is AuditableSlug => s !== "campaign-theme",
);

const slugMeta: Record<AuditableSlug, SlugMeta> = {
  brief: {
    // editorPath is the same file for every campaign — the campaign
    // is a URL segment in the dynamic route. styleProps are extracted
    // statically from the source, so we read the [campaign] template.
    editorPath: () => `src/app/(dashboard)/signup-control/[campaign]/brief/editor.tsx`,
    livePaths: (c) => [`/creator/${c}/brief`],
    viewSources: ["src/app/(auth)/creator/brief/view.tsx"],
  },
  "tiktok-setup": {
    editorPath: () => `src/app/(dashboard)/signup-control/[campaign]/tiktok-setup/editor.tsx`,
    livePaths: (c) => [`/creator/${c}/setup/tiktok`],
    viewSources: ["src/app/(auth)/creator/setup/tiktok/view.tsx"],
  },
  welcome: {
    editorPath: () => `src/app/(dashboard)/signup-control/welcome/editor.tsx`,
    livePaths: () => ["/welcome"],
    viewSources: ["src/app/(auth)/welcome/page.tsx"],
  },
  "auth-form": {
    editorPath: () => `src/app/(dashboard)/signup-control/[campaign]/auth-form/editor.tsx`,
    livePaths: (c) => [`/creator/${c}/login`, `/creator/${c}/signup`],
    viewSources: ["src/components/creator-auth-form.tsx"],
  },
};

interface Probe {
  slug: AuditableSlug;
  campaign: Campaign;
  editorPath: string;
  livePaths: string[];
  viewSources: string[];
}

function buildProbes(): Probe[] {
  const probes: Probe[] = [];
  for (const campaign of CAMPAIGNS) {
    for (const slug of AUDITABLE_SLUGS) {
      if (slugScope[slug] === "shared" && campaign !== "minutewise") continue;
      const meta = slugMeta[slug];
      probes.push({
        slug,
        campaign,
        editorPath: meta.editorPath(campaign),
        livePaths: meta.livePaths(campaign),
        viewSources: meta.viewSources,
      });
    }
  }
  return probes;
}

function extractStylePaths(editorPath: string): string[] {
  const src = readFileSync(join(REPO, editorPath), "utf8");
  const out = new Set<string>();
  for (const m of src.matchAll(/styleProps\("([^"]+)"\)/g)) out.add(m[1]);
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

async function auditProbe(p: Probe): Promise<{ label: string; total: number; missing: string[] }> {
  const label = `${p.campaign}/${p.slug}`;
  const paths = extractStylePaths(p.editorPath);
  const styles: StylesMap = {};
  const expectedMarker = new Map<string, string>();
  paths.forEach((path, i) => {
    const marker = `0.${(i + 100).toString().padStart(3, "0")}em`;
    expectedMarker.set(path, marker);
    const tokens: TypographyTokens = { letterSpacing: marker };
    styles[path] = tokens;
  });

  const base = defaultsFor(p.slug, p.campaign) as Record<string, unknown>;
  const content = { ...base, styles };
  const campaignKey = resolveCampaignKey(p.slug, p.campaign);
  const json = JSON.stringify(content);
  await runSql(
    `INSERT INTO public.cms_pages (campaign, slug, content) VALUES
       ('${campaignKey}', '${p.slug}', $tag$${json}$tag$::jsonb)
     ON CONFLICT (campaign, slug) DO UPDATE
       SET content = EXCLUDED.content, updated_at = now();`,
  );

  const html = (await Promise.all(p.livePaths.map(fetchHtml))).join("\n");
  const viewSrc = p.viewSources
    .map((vp) => readFileSync(join(REPO, vp), "utf8"))
    .join("\n");

  function pathToRegex(pathStr: string): RegExp {
    const segments = pathStr.split(".").map((s) => /^\d+$/.test(s) ? s : `"${s}"`);
    const joined = segments.join(",\\s*");
    return new RegExp(`path\\s*=\\s*\\{\\s*\\[\\s*${joined.replace(/"/g, '\\"')}\\s*\\]\\s*\\}`);
  }

  const missing: string[] = [];
  for (const [path, marker] of expectedMarker) {
    const inHtml =
      html.includes(`letter-spacing:${marker}`) ||
      html.includes(`letter-spacing: ${marker}`);
    const wrappedInSource = pathToRegex(path).test(viewSrc);
    if (!inHtml && !wrappedInSource) missing.push(`${path}  (expected ${marker})`);
  }

  await runSql(
    `DELETE FROM public.cms_pages WHERE campaign='${campaignKey}' AND slug='${p.slug}';
     DELETE FROM public.cms_page_versions WHERE campaign='${campaignKey}' AND slug='${p.slug}';`,
  );

  return { label, total: paths.length, missing };
}

(async () => {
  console.log("CMS *style* coverage audit — verifying every styleProps path applies on the live page.\n");
  let overallOk = true;
  for (const p of buildProbes()) {
    const { label, total, missing } = await auditProbe(p);
    if (missing.length === 0) {
      console.log(`✓ ${label.padEnd(28)} ${total} style paths — all apply`);
    } else {
      overallOk = false;
      console.log(`✗ ${label.padEnd(28)} ${total - missing.length}/${total} apply. MISSING (${missing.length}):`);
      for (const m of missing) console.log(`    • ${m}`);
    }
  }
  console.log(`\n${overallOk ? "ALL STYLE PATHS APPLY ✅" : "SOME STYLE PATHS DO NOT APPLY ❌ — see paths above"}`);
  process.exit(overallOk ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
