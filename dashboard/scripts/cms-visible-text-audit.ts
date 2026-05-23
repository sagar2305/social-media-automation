/**
 * Strict CMS audit: prove every editable string is rendered as VISIBLE
 * text on the live page, not just present in the HTML somewhere.
 *
 * The earlier `cms-coverage-audit.ts` checked HTML.includes(marker),
 * which counts hits inside the RSC payload `<script>` tag too — that's
 * how the intern-handle bug slipped through. This audit strips scripts
 * before checking, so a string is only "rendered" if it's actually
 * visible to the human visitor. Runs across every (campaign, slug).
 *
 *   npx tsx scripts/cms-visible-text-audit.ts <SUPABASE_ACCESS_TOKEN>
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
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TOKEN = process.argv[2];
const PROJECT_REF = "mkqarsodftnlcuscsrii";
const HOST = "http://localhost:3000";
const REPO = process.cwd();

if (!TOKEN) {
  console.error("Usage: tsx scripts/cms-visible-text-audit.ts <SUPABASE_ACCESS_TOKEN>");
  process.exit(1);
}

interface SlugMeta {
  livePaths: (campaign: Campaign) => string[];
  viewSources: string[];
}

/** The `campaign-theme` slug has no visible text — it's a single-field
 *  theme picker. Skip it entirely from this audit. */
type AuditableSlug = Exclude<CmsSlug, "campaign-theme">;
const AUDITABLE_SLUGS = CMS_SLUGS.filter(
  (s): s is AuditableSlug => s !== "campaign-theme",
);

const slugMeta: Record<AuditableSlug, SlugMeta> = {
  brief: {
    livePaths: (c) => [`/creator/${c}/brief`],
    viewSources: ["src/app/(auth)/creator/brief/view.tsx"],
  },
  "tiktok-setup": {
    livePaths: (c) => [`/creator/${c}/setup/tiktok`],
    viewSources: ["src/app/(auth)/creator/setup/tiktok/view.tsx"],
  },
  welcome: {
    livePaths: () => ["/welcome"],
    viewSources: ["src/app/(auth)/welcome/page.tsx"],
  },
  "auth-form": {
    livePaths: (c) => [`/creator/${c}/login`, `/creator/${c}/signup`],
    viewSources: ["src/components/creator-auth-form.tsx"],
  },
};

interface Probe {
  slug: AuditableSlug;
  campaign: Campaign;
  livePaths: string[];
  viewSources: string[];
}

function buildProbes(): Probe[] {
  const probes: Probe[] = [];
  for (const campaign of CAMPAIGNS) {
    for (const slug of AUDITABLE_SLUGS) {
      if (slugScope[slug] === "shared" && campaign !== "minutewise") continue;
      const meta = slugMeta[slug];
      probes.push({ slug, campaign, livePaths: meta.livePaths(campaign), viewSources: meta.viewSources });
    }
  }
  return probes;
}

function pathToRegex(pathStr: string): RegExp {
  const segments = pathStr.split(".").map((s) => /^\d+$/.test(s) ? s : `"${s}"`);
  const joined = segments.join(",\\s*");
  return new RegExp(`path\\s*=\\s*\\{\\s*\\[\\s*${joined.replace(/"/g, '\\"')}\\s*\\]\\s*\\}`);
}

function pathToFlexibleRegex(pathStr: string): RegExp {
  const segments = pathStr.split(".").map((s) =>
    /^\d+$/.test(s) ? `[^,\\]]+` : `"${s}"`,
  );
  const joined = segments.join(",\\s*");
  return new RegExp(`path\\s*=\\s*\\{\\s*\\[\\s*${joined.replace(/"/g, '\\"')}\\s*\\]\\s*\\}`);
}

function isReferencedAsPlaceholder(pathStr: string, src: string): boolean {
  const access = pathStr.replace(/\.(\d+)/g, "[$1]");
  return new RegExp(
    `placeholder\\s*=\\s*\\{[^}]*\\.${access.replace(/\./g, "\\.").replace(/\[\d+\]/g, "\\[\\d+\\]")}[^}]*\\}`,
  ).test(src)
    || new RegExp(`placeholder\\s*=\\s*\\{[^}]*${access.split(".").pop()}[^}]*\\}`).test(src);
}

function visibleTextOnly(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g, (_match, tag, attrs) => {
      const stripped = attrs.replace(/\s+[a-zA-Z][a-zA-Z0-9-]*\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g, "");
      return `<${tag}${stripped}>`;
    });
}

function instrument(obj: unknown, label: string): { content: unknown; markers: Map<string, string> } {
  const markers = new Map<string, string>();
  function walk(value: unknown, path: string[]): unknown {
    if (typeof value === "string") {
      const key = path.join(".");
      const last = path[path.length - 1] || "";
      if (/(?:Url|Href|url|href)$/i.test(last)) return value;
      if (last === "loomEmbedId" || last === "youtubeId") return value;
      if (last === "icon" || last === "kind" || last === "platform") return value;
      if (last === "imageUrl") return value;
      if (last === "tiktokUrl") return value;
      const marker = `MARK-${label}-${key.replace(/\./g, "_")}-${Math.random().toString(36).slice(2, 7)}`;
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

async function runSql(sql: string) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
}

async function fetchHtml(path: string): Promise<string> {
  const r = await fetch(`${HOST}${path}?_=${Date.now()}`, { cache: "no-store" });
  return r.text();
}

(async () => {
  console.log("Strict CMS visible-text audit — every editable string must appear as VISIBLE text.\n");
  let overallOk = true;

  for (const p of buildProbes()) {
    const label = `${p.campaign}/${p.slug}`;
    const base = defaultsFor(p.slug, p.campaign);
    const { content, markers } = instrument(base, label.replace(/\//g, "-"));
    const campaignKey = resolveCampaignKey(p.slug, p.campaign);
    const jsonLit = JSON.stringify(content);

    await runSql(
      `INSERT INTO public.cms_pages (campaign, slug, content) VALUES
         ('${campaignKey}', '${p.slug}', $tag$${jsonLit}$tag$::jsonb)
       ON CONFLICT (campaign, slug) DO UPDATE
         SET content = EXCLUDED.content, updated_at = now();`,
    );

    const rawHtml = (await Promise.all(p.livePaths.map(fetchHtml))).join("\n");
    const visible = visibleTextOnly(rawHtml);
    const viewSrc = p.viewSources.map((vp) => readFileSync(join(REPO, vp), "utf8")).join("\n");

    const visibleNow: string[] = [];
    const wrappedConditional: string[] = [];
    const placeholderOnly: string[] = [];
    const trulyBroken: string[] = [];

    for (const [path, marker] of markers) {
      if (visible.includes(marker)) {
        visibleNow.push(path);
      } else if (pathToRegex(path).test(viewSrc) || pathToFlexibleRegex(path).test(viewSrc)) {
        wrappedConditional.push(path);
      } else if (isReferencedAsPlaceholder(path, viewSrc)) {
        placeholderOnly.push(path);
      } else {
        trulyBroken.push(path);
      }
    }

    const truly = trulyBroken.length;
    if (truly === 0) {
      console.log(`✓ ${label.padEnd(28)} ${markers.size} fields OK  (visible=${visibleNow.length}, conditional=${wrappedConditional.length}, placeholder=${placeholderOnly.length})`);
    } else {
      overallOk = false;
      console.log(`✗ ${label.padEnd(28)} ${truly} truly broken (visible=${visibleNow.length}, conditional=${wrappedConditional.length}, placeholder=${placeholderOnly.length}, BROKEN=${truly}):`);
      for (const path of trulyBroken) console.log(`    • ${path}`);
    }

    await runSql(
      `DELETE FROM public.cms_pages WHERE campaign='${campaignKey}' AND slug='${p.slug}';
       DELETE FROM public.cms_page_versions WHERE campaign='${campaignKey}' AND slug='${p.slug}';`,
    );
  }

  console.log(`\n${overallOk ? "ALL EDITABLE TEXT IS VISIBLE ✅" : "SOME FIELDS SAVED BUT INVISIBLE ❌"}`);
  process.exit(overallOk ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
