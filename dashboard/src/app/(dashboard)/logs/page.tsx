/**
 * /logs — campaign grid index.
 *
 * Lists every active campaign as a clickable card. Each card shows
 * how many AI-brain files exist on disk for that campaign and the
 * most-recent file mtime so the operator can see at a glance which
 * campaigns are actively being researched.
 *
 * Click a card → /logs/<slug> for the file viewer.
 *
 * Top of the page has a small "How autoresearch works" explainer so
 * mam understands the loop before drilling in.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, ChevronRight, RotateCw, Sparkles, TrendingUp, Trophy } from "lucide-react";

export const dynamic = "force-dynamic";

interface CampaignCard {
  slug: string;
  name: string;
  status: string;
  fileCount: number;
  totalBytes: number;
  lastUpdated: Date | null;
  exists: boolean;
}

const FILE_NAMES = [
  "FORMAT-WINNERS.md",
  "HASHTAG-BANK.md",
  "LESSONS-LEARNED.md",
  "TRENDING-NOW.md",
  "POST-TRACKER.md",
  "EXPERIMENT-LOG.md",
  "results.tsv",
  "tier-state.json",
];

function campaignDataDir(slug: string): string {
  return join(process.cwd(), "..", "data", "campaigns", slug);
}

async function summarise(slug: string): Promise<Omit<CampaignCard, "slug" | "name" | "status">> {
  const dir = campaignDataDir(slug);
  let exists = true;
  try {
    await readdir(dir);
  } catch {
    exists = false;
  }
  if (!exists) return { fileCount: 0, totalBytes: 0, lastUpdated: null, exists };

  let fileCount = 0;
  let totalBytes = 0;
  let latest: Date | null = null;

  for (const name of FILE_NAMES) {
    try {
      const s = await stat(join(dir, name));
      fileCount++;
      totalBytes += s.size;
      if (!latest || s.mtime > latest) latest = s.mtime;
    } catch {
      // File doesn't exist yet — fine, it's optional.
    }
  }
  return { fileCount, totalBytes, lastUpdated: latest, exists };
}

function timeAgo(date: Date | null): string {
  if (!date) return "never";
  const ms = Date.now() - date.getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default async function LogsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Backward-compat: the old layout used /logs?campaign=<slug>&file=<key>
  // for the file viewer. Now the file viewer lives at /logs/<slug>.
  // Redirect any old-shape URL so bookmarks / shared links still work.
  const sp = await searchParams;
  const legacyCampaign = typeof sp.campaign === "string" ? sp.campaign : null;
  if (legacyCampaign) {
    const legacyFile = typeof sp.file === "string" ? sp.file : null;
    const tail = legacyFile ? `?file=${encodeURIComponent(legacyFile)}` : "";
    redirect(`/logs/${legacyCampaign}${tail}`);
  }

  const sb = await createClient();
  const { data: campaigns } = await sb
    .from("campaigns")
    .select("slug, name, status")
    .neq("status", "archived")
    .order("created_at", { ascending: true })
    .returns<Array<{ slug: string; name: string; status: string }>>();

  const summaries: CampaignCard[] = await Promise.all(
    (campaigns ?? []).map(async (c) => ({
      ...c,
      ...(await summarise(c.slug)),
    })),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-5xl font-semibold tracking-tight">Logs</h1>
        <p className="text-lg text-muted-foreground mt-2">
          Each campaign has its own &quot;AI brain&quot; — a folder of files
          the autoresearch loop reads, writes, and learns from. Pick a
          campaign to see its files.
        </p>
      </div>

      {/* How autoresearch works — explainer card. Mam asked about this
          today; surfacing the loop here so anyone landing on /logs
          can see what they're looking at. */}
      <Card className="border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.06] to-transparent">
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
              How autoresearch works
            </p>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Every campaign has its own learning loop, separate from every other
            campaign&apos;s. The loop runs daily (via{" "}
            <code className="font-mono text-xs">npm run refresh</code> on a
            cron / loop) and does four things in order:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <LoopStep
              n={1}
              icon={<RotateCw className="h-4 w-4" />}
              title="Pull metrics"
              body="ScrapeCreators API fetches views, likes, saves, comments for every post since the last run."
            />
            <LoopStep
              n={2}
              icon={<Trophy className="h-4 w-4" />}
              title="Score + rank"
              body="Posts are bucketed by format and hook style. Save rate is the primary signal — formats that perform get promoted in FORMAT-WINNERS."
            />
            <LoopStep
              n={3}
              icon={<TrendingUp className="h-4 w-4" />}
              title="Update brain"
              body="HASHTAG-BANK, LESSONS-LEARNED, TRENDING-NOW are rewritten. Winners stay in rotation, losers get dropped."
            />
            <LoopStep
              n={4}
              icon={<Sparkles className="h-4 w-4" />}
              title="Generate"
              body="Next batch of posts uses the updated brain — top-ranked formats and hashtags get heavier weighting in Gemini prompts."
            />
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed pt-1">
            All four steps write to <code className="font-mono">data/campaigns/&lt;slug&gt;/</code>.
            The files below are the campaign&apos;s current state — what the
            AI brain believes is winning. Click into any campaign to read
            them.
          </p>
        </CardContent>
      </Card>

      {/* Campaign grid. Each card is a deep-link into /logs/<slug>. */}
      {summaries.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No active campaigns yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {summaries.map((c) => (
            <Link
              key={c.slug}
              href={`/logs/${c.slug}`}
              className="group rounded-xl border border-border bg-card p-4 hover:border-emerald-500/40 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <p className="text-base font-semibold truncate leading-tight">{c.name}</p>
                  <p className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">{c.slug}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:translate-x-1 transition-transform" />
              </div>
              {/* 3-column metric strip — dense, no big gap between label
                  and value. Each tile stacks an eyebrow label on top of
                  a bold value, mirroring the perf tiles elsewhere in
                  the dashboard. */}
              {c.exists ? (
                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border/40">
                  <MetricCell
                    label="Files"
                    value={`${c.fileCount}/${FILE_NAMES.length}`}
                  />
                  <MetricCell
                    label="Size"
                    value={`${(c.totalBytes / 1024).toFixed(1)} KB`}
                  />
                  <MetricCell
                    label="Updated"
                    value={timeAgo(c.lastUpdated)}
                  />
                </div>
              ) : (
                <div className="pt-3 border-t border-border/40 flex items-center gap-2 text-xs">
                  <FileText className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  <span className="text-amber-700 dark:text-amber-400">No folder on disk yet</span>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function LoopStep({
  n,
  icon,
  title,
  body,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg bg-background/60 backdrop-blur-sm border border-border/40 px-3 py-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold">
          {n}
        </span>
        <span className="text-emerald-700/80 dark:text-emerald-400/80">{icon}</span>
      </div>
      <p className="text-xs font-semibold">{title}</p>
      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{body}</p>
    </div>
  );
}

/**
 * Compact stat cell — eyebrow label on top, bold value below.
 * Sits in a 3-column grid inside the campaign card. No flex-justify-
 * between label/value layout (which was producing too much whitespace
 * on wider screens — the value floated to the right edge while the
 * label stuck to the left).
 */
function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-medium">
        {label}
      </p>
      <p className="text-sm font-semibold tabular-nums mt-0.5 truncate">
        {value}
      </p>
    </div>
  );
}
