/**
 * /logs/[slug] — file viewer for one campaign's AI-brain.
 *
 * Reads data/campaigns/<slug>/*.md|tsv|json from disk and renders
 * each file in a tab. See the parent /logs index page for the
 * conceptual overview of the autoresearch loop.
 *
 * Works because dashboard + autoresearch scripts run on the same
 * machine. If the dashboard ever deploys separately from where the
 * files live, this becomes a sync-to-Supabase-Storage problem.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, AlertCircle, ArrowLeft } from "lucide-react";
import { LogsFileTabs } from "../logs-file-tabs";

export const dynamic = "force-dynamic";

const KNOWN_FILES: Array<{ key: string; filename: string; label: string; description: string }> = [
  { key: "format-winners",  filename: "FORMAT-WINNERS.md",  label: "Format Winners",  description: "Formats ranked by save rate" },
  { key: "hashtag-bank",    filename: "HASHTAG-BANK.md",    label: "Hashtag Bank",    description: "Hashtags with performance data" },
  { key: "lessons-learned", filename: "LESSONS-LEARNED.md", label: "Lessons Learned", description: "Rolling dashboard + insights" },
  { key: "trending-now",    filename: "TRENDING-NOW.md",    label: "Trending Now",    description: "Current trends from Virlo" },
  { key: "post-tracker",    filename: "POST-TRACKER.md",    label: "Post Tracker",    description: "Posts with metrics" },
  { key: "experiment-log",  filename: "EXPERIMENT-LOG.md",  label: "Experiment Log",  description: "A/B test history" },
  { key: "results-tsv",     filename: "results.tsv",        label: "Results (TSV)",   description: "Raw autoresearch ledger" },
  { key: "tier-state",      filename: "tier-state.json",    label: "Tier State",      description: "ScrapeCreators cursor" },
];

function campaignDataDir(slug: string): string {
  return join(process.cwd(), "..", "data", "campaigns", slug);
}

async function loadFiles(slug: string) {
  const dir = campaignDataDir(slug);
  try {
    await readdir(dir);
  } catch {
    return KNOWN_FILES.map((f) => ({
      ...f,
      content: null,
      error: "Campaign folder doesn't exist on disk yet.",
      sizeBytes: 0,
    }));
  }
  return Promise.all(
    KNOWN_FILES.map(async (f) => {
      try {
        const raw = await readFile(join(dir, f.filename), "utf-8");
        return { ...f, content: raw, error: null, sizeBytes: Buffer.byteLength(raw, "utf-8") };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ...f,
          content: null,
          error: msg.includes("ENOENT") ? "Not generated yet" : msg,
          sizeBytes: 0,
        };
      }
    }),
  );
}

export default async function CampaignLogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const sb = await createClient();
  const { data: campaign } = await sb
    .from("campaigns")
    .select("slug, name, status")
    .eq("slug", slug)
    .maybeSingle<{ slug: string; name: string; status: string }>();
  if (!campaign) notFound();

  const files = await loadFiles(slug);
  const activeFileKey = typeof sp.file === "string" ? sp.file : KNOWN_FILES[0].key;

  return (
    <div className="space-y-6">
      <Link
        href="/logs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to all campaigns
      </Link>

      <div>
        <h1 className="text-5xl font-semibold tracking-tight">{campaign.name}</h1>
        <p className="text-lg text-muted-foreground mt-2">
          AI-brain files for this campaign. Read-only — the autoresearch
          scripts own these files.
        </p>
      </div>

      <div className="rounded-md border border-dashed border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground flex items-start gap-2">
        <FileText className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <p>
            Files live at <code className="font-mono">data/campaigns/{slug}/</code>
          </p>
          <p className="mt-0.5">
            These files are written by <code className="font-mono">npm run refresh</code> /
            autoresearch / cycle scripts. The dashboard reads them from disk
            on every request — refresh after a script run to see the latest.
          </p>
        </div>
      </div>

      <LogsFileTabs files={files} activeKey={activeFileKey} activeSlug={slug} />

      {files.every((f) => f.content === null) && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground space-y-2">
            <AlertCircle className="h-5 w-5 mx-auto text-muted-foreground/60" />
            <p>No autoresearch files yet for {campaign.name}.</p>
            <p className="text-xs">
              Run <code className="font-mono">npm run refresh</code> with this
              campaign active, or wait for the daily autoresearch loop.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
