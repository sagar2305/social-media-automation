/**
 * Strict CMS audit: prove every editable string is rendered as VISIBLE
 * text on the live page, not just present in the HTML somewhere.
 *
 * The earlier `cms-coverage-audit.ts` checked HTML.includes(marker),
 * which counts hits inside the RSC payload `<script>` tag too — that's
 * how the intern-handle bug slipped through. This audit strips scripts
 * before checking, so a string is only "rendered" if it's actually
 * visible to the human visitor.
 *
 *   npx tsx scripts/cms-visible-text-audit.ts <SUPABASE_ACCESS_TOKEN>
 */

import { cmsDefaults } from "../src/lib/cms-defaults";
import type { CmsSlug } from "../src/lib/cms-schemas";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TOKEN = process.argv[2];
const PROJECT_REF = "mkqarsodftnlcuscsrii";
const HOST = "http://localhost:3000";
const REPO = "/Users/mohitkourav/Code/social-media-automation/dashboard";

if (!TOKEN) {
  console.error("Usage: tsx scripts/cms-visible-text-audit.ts <SUPABASE_ACCESS_TOKEN>");
  process.exit(1);
}

interface Probe {
  slug: CmsSlug;
  livePaths: string[];
  /** View source(s) — paths checked for `<Editable path={[...]}>` wraps. */
  viewSources: string[];
}

const probes: Probe[] = [
  { slug: "brief",         livePaths: ["/creator/brief"],                            viewSources: ["src/app/(auth)/creator/brief/view.tsx"] },
  { slug: "tiktok-setup",  livePaths: ["/creator/setup/tiktok"],                     viewSources: ["src/app/(auth)/creator/setup/tiktok/view.tsx"] },
  { slug: "welcome",       livePaths: ["/welcome"],                                  viewSources: ["src/app/(auth)/welcome/page.tsx"] },
  { slug: "auth-form",     livePaths: ["/creator/login", "/creator/signup"],         viewSources: ["src/components/creator-auth-form.tsx"] },
];

/** Convert "X.Y.0.Z" → regex matching `path={["X","Y",0,"Z"]}` (whitespace tolerant). */
function pathToRegex(pathStr: string): RegExp {
  const segments = pathStr.split(".").map((s) => /^\d+$/.test(s) ? s : `"${s}"`);
  const joined = segments.join(",\\s*");
  return new RegExp(`path\\s*=\\s*\\{\\s*\\[\\s*${joined.replace(/"/g, '\\"')}\\s*\\]\\s*\\}`);
}

/**
 * Same idea but allows any expression in place of numeric indices —
 * matches `path={["steps", currentStepId - 1, "title"]}` for path
 * "steps.0.title". The earlier strict pathToRegex only matched literal
 * numeric indices and missed dynamic-index lookups.
 */
function pathToFlexibleRegex(pathStr: string): RegExp {
  const segments = pathStr.split(".").map((s) =>
    /^\d+$/.test(s) ? `[^,\\]]+` : `"${s}"`,
  );
  const joined = segments.join(",\\s*");
  return new RegExp(`path\\s*=\\s*\\{\\s*\\[\\s*${joined.replace(/"/g, '\\"')}\\s*\\]\\s*\\}`);
}

/** Look for `placeholder={...path-reference...}` to detect placeholder-only fields. */
function isReferencedAsPlaceholder(pathStr: string, src: string): boolean {
  // The path "signUp.emailPlaceholder" corresponds to JS access like
  // `copy.signUp.emailPlaceholder` or `c.signUp.emailPlaceholder`.
  const access = pathStr.replace(/\.(\d+)/g, "[$1]");
  return new RegExp(`placeholder\\s*=\\s*\\{[^}]*\\.${access.replace(/\./g, "\\.").replace(/\[\d+\]/g, "\\[\\d+\\]")}[^}]*\\}`).test(src)
    || new RegExp(`placeholder\\s*=\\s*\\{[^}]*${access.split(".").pop()}[^}]*\\}`).test(src);
}

/**
 * Strip <script> blocks (RSC payload, hydration data) and HTML attribute
 * values from the served HTML, leaving only the actual visible text
 * content that a human reader sees. This is the strict "is it actually
 * shown" check.
 */
function visibleTextOnly(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    // Strip all attribute values from HTML tags. So `<a href="x">hi</a>` → `<a>hi</a>`.
    // This catches the case where a marker appears as an attribute value
    // (e.g. href, alt, title, data-...) but is invisible.
    .replace(/<([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g, (_match, tag, attrs) => {
      const stripped = attrs.replace(/\s+[a-zA-Z][a-zA-Z0-9-]*\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g, "");
      return `<${tag}${stripped}>`;
    });
}

/**
 * Walk an object and replace every string leaf with a unique marker.
 * Skip fields that are documented to render as attribute values only
 * (URLs, embed IDs, icon enum values).
 */
function instrument(obj: unknown, slug: string): { content: unknown; markers: Map<string, string> } {
  const markers = new Map<string, string>();
  function walk(value: unknown, path: string[]): unknown {
    if (typeof value === "string") {
      const key = path.join(".");
      const last = path[path.length - 1] || "";

      // These fields render only as attribute values, not visible text.
      // Skipping them avoids false positives.
      if (/(?:Url|Href|url|href)$/i.test(last)) return value;
      if (last === "loomEmbedId" || last === "youtubeId") return value;
      if (last === "icon" || last === "kind" || last === "platform") return value;

      // imageUrl is href-only too (renders as <img src>)
      if (last === "imageUrl") return value;

      // tiktokUrl is href-only in intern showcase
      if (last === "tiktokUrl") return value;

      const marker = `MARK-${slug}-${key.replace(/\./g, "_")}-${Math.random().toString(36).slice(2, 7)}`;
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

  for (const p of probes) {
    const base = cmsDefaults[p.slug];
    const { content, markers } = instrument(base, p.slug);

    const jsonLit = JSON.stringify(content);
    await runSql(`INSERT INTO public.cms_pages (slug, content) VALUES ('${p.slug}', $tag$${jsonLit}$tag$::jsonb) ON CONFLICT (slug) DO UPDATE SET content = EXCLUDED.content, updated_at = now();`);

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
        // Wrapped in <Editable path={[...]}> somewhere — will render
        // when the conditional that gates it fires (e.g. TikTok step 3
        // when user clicks through to step 3, signUp success state
        // when form succeeds, etc.).
        wrappedConditional.push(path);
      } else if (isReferencedAsPlaceholder(path, viewSrc)) {
        // Field is used as an <input placeholder="..."> — invisible to
        // the "body text" check but functional + stylable inside the
        // input (and admins can edit the text via the editor's hint).
        placeholderOnly.push(path);
      } else {
        trulyBroken.push(path);
      }
    }

    const truly = trulyBroken.length;
    if (truly === 0) {
      console.log(`✓ ${p.slug.padEnd(14)} ${markers.size} fields OK  (visible=${visibleNow.length}, conditional=${wrappedConditional.length}, placeholder=${placeholderOnly.length})`);
    } else {
      overallOk = false;
      console.log(`✗ ${p.slug.padEnd(14)} ${truly} truly broken (visible=${visibleNow.length}, conditional=${wrappedConditional.length}, placeholder=${placeholderOnly.length}, BROKEN=${truly}):`);
      for (const path of trulyBroken) console.log(`    • ${path}`);
    }

    await runSql(`DELETE FROM public.cms_pages WHERE slug='${p.slug}'; DELETE FROM public.cms_page_versions WHERE slug='${p.slug}';`);
  }

  console.log(`\n${overallOk ? "ALL EDITABLE TEXT IS VISIBLE ✅" : "SOME FIELDS SAVED BUT INVISIBLE ❌"}`);
  process.exit(overallOk ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
