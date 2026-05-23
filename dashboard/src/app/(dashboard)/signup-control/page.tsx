/**
 * /signup-control — admin tile picker for the creator onboarding CMS.
 *
 * Lists the four editable pages (Brief, TikTok Setup, Welcome, Auth
 * Form). Each tile routes to its own editor at /signup-control/<slug>.
 * Admin-gated via requireRole.
 */

import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import {
  CMS_SLUGS,
  cmsPageMeta,
  type CmsSlug,
} from "@/lib/cms-schemas";
import {
  FileEdit,
  ArrowUpRight,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";

export const dynamic = "force-dynamic";

interface TileMeta {
  slug: CmsSlug;
  title: string;
  description: string;
  livePath: string;
  isSaved: boolean;
  updatedAt: string | null;
}

export default async function SignupControlPage() {
  await requireRole("admin");

  // Bulk-fetch saved rows so each tile can show "Saved · 2h ago" vs
  // "Defaults — never edited" without 4 round-trips.
  const sb = await createClient();
  let savedRows: Array<{ slug: string; updated_at: string }> = [];
  try {
    const { data } = await sb
      .from("cms_pages")
      .select("slug, updated_at")
      .in("slug", CMS_SLUGS as unknown as string[]);
    if (data) savedRows = data as Array<{ slug: string; updated_at: string }>;
  } catch {
    // Table may not exist yet — fine, tiles fall back to "defaults".
  }

  const savedBySlug = new Map(savedRows.map((r) => [r.slug, r.updated_at]));
  const tiles: TileMeta[] = CMS_SLUGS.map((slug) => ({
    slug,
    title: cmsPageMeta[slug].title,
    description: cmsPageMeta[slug].description,
    livePath: cmsPageMeta[slug].livePath,
    isSaved: savedBySlug.has(slug),
    updatedAt: savedBySlug.get(slug) ?? null,
  }));

  return (
    <div className="p-6 sm:p-8 space-y-6 max-w-5xl">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px] uppercase tracking-widest font-semibold">
          <FileEdit className="h-3 w-3" />
          Signup Control
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Edit the creator onboarding pages
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Pick a page to edit its copy, video links, FAQ items, journey
          steps, and more. Changes go live the moment you save — no
          deploy needed.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {tiles.map((tile) => (
          <Link
            key={tile.slug}
            href={`/signup-control/${tile.slug}`}
            className="group rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.08] to-emerald-500/[0.02] hover:from-emerald-500/[0.14] hover:to-emerald-500/[0.04] transition-colors p-5 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <div className="h-10 w-10 rounded-xl bg-emerald-500/15 ring-1 ring-emerald-500/25 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
                <FileEdit className="h-5 w-5" strokeWidth={2.25} />
              </div>
              <ArrowUpRight className="h-5 w-5 text-emerald-600/70 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-emerald-600 transition-all" />
            </div>
            <div className="space-y-1">
              <p className="text-lg font-semibold leading-tight">{tile.title}</p>
              <p className="text-sm text-foreground/70 leading-snug">
                {tile.description}
              </p>
            </div>
            <div className="flex items-center justify-between text-xs pt-1 mt-auto">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <ExternalLink className="h-3 w-3" />
                {tile.livePath}
              </span>
              {tile.isSaved ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300 font-medium">
                  <CheckCircle2 className="h-3 w-3" />
                  Saved · {formatRelative(tile.updatedAt!)}
                </span>
              ) : (
                <span className="text-muted-foreground">Defaults · never edited</span>
              )}
            </div>
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="p-5 text-xs text-muted-foreground space-y-1.5">
          <p className="font-semibold text-foreground">How this works</p>
          <p>
            Each tile above edits a JSON content blob for the page. If a
            tile shows <em>&quot;Defaults · never edited&quot;</em>, the
            creator-facing page is rendering the baked-in fallback — so
            your first save replaces those defaults. Lists support add,
            remove, and reorder. Video links accept Loom or YouTube
            share URLs.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!then) return "—";
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
