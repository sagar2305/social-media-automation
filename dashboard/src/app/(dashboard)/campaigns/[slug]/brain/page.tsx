/**
 * /campaigns/[slug]/brain — autoresearch state for one campaign.
 *
 * Two layers:
 *   - Top: campaign-level config + a tiny stats strip (last run, total
 *     experiments, winners declared, losers dropped, posts measured)
 *   - Below: the existing <AutoresearchPanel /> filtered to this
 *     campaign's runs. Reusing it means brain history rendering, the
 *     decision JSON dump, etc., are already taken care of.
 *
 * AI-Brain config edit (toggle + cadence) currently lives in the
 * campaign edit form (Phase 4 / future Phase 8 form expansion); this
 * tab shows the *current* setting plus the run history.
 */

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { getUser } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Brain, Pause, Play, Calendar, Zap, Trophy, Target } from "lucide-react";
import {
  AutoresearchPanel,
  type AutoresearchRun,
} from "@/components/autoresearch-panel";
import type { Campaign } from "@/lib/types";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface StatChipProps {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
}

function StatChip({ Icon, label, value, hint }: StatChipProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground leading-none mt-0.5">{label}</p>
        <p className="text-sm font-semibold tabular-nums">{value}</p>
        {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const ageHours = (Date.now() - d.getTime()) / 3_600_000;
  if (ageHours < 1) return "just now";
  if (ageHours < 24) return `${Math.round(ageHours)}h ago`;
  const ageDays = Math.round(ageHours / 24);
  return `${ageDays}d ago`;
}

export default async function CampaignBrainPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sb = await createClient();
  const user = await getUser();

  const { data: campaign } = await sb
    .from("campaigns")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<Campaign>();
  if (!campaign) notFound();

  const { data: runsData } = await sb
    .from("autoresearch_runs")
    .select("*")
    .eq("campaign_id", campaign.id)
    .order("occurred_at", { ascending: false })
    .limit(30)
    .returns<AutoresearchRun[]>();

  const runs = runsData ?? [];

  // Stats strip
  const totalExperiments = runs.length;
  const totalWinners = runs.reduce(
    (s, r) => s + (typeof r.winners_declared === "number" ? r.winners_declared : 0),
    0,
  );
  const totalLosers = runs.reduce(
    (s, r) => s + (typeof r.losers_dropped === "number" ? r.losers_dropped : 0),
    0,
  );
  const totalPostsMeasured = runs.reduce(
    (s, r) => s + (typeof r.posts_measured === "number" ? r.posts_measured : 0),
    0,
  );
  const lastRunAt = runs[0]?.occurred_at ?? null;

  return (
    <div className="space-y-5">
      {/* Config + stats card */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div
                className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                  campaign.autoresearch_enabled
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                <Brain className="h-5 w-5" />
              </div>
              <div>
                <p className="text-base font-semibold">
                  AI Brain {campaign.autoresearch_enabled ? "active" : "paused"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {campaign.autoresearch_enabled ? (
                    <>
                      Designing one experiment <strong>{campaign.autoresearch_cadence === "daily" ? "every day" : campaign.autoresearch_cadence === "every_2_days" ? "every 2 days" : "every week"}</strong> for this campaign.
                    </>
                  ) : (
                    "Paused — the brain isn't designing experiments for this campaign right now."
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
                  campaign.autoresearch_enabled
                    ? "bg-[#16a34a]/10 text-[#16a34a]"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {campaign.autoresearch_enabled ? (
                  <>
                    <Play className="h-3 w-3" /> enabled
                  </>
                ) : (
                  <>
                    <Pause className="h-3 w-3" /> paused
                  </>
                )}
              </span>
              <Link
                href={`/campaigns/${campaign.slug}/edit`}
                className="text-xs font-medium text-primary hover:underline"
              >
                Configure →
              </Link>
            </div>
          </div>

          {/* Stats strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <StatChip
              Icon={Calendar}
              label="Last run"
              value={fmtDate(lastRunAt)}
            />
            <StatChip
              Icon={Zap}
              label="Cadence"
              value={
                campaign.autoresearch_cadence === "daily"
                  ? "Daily"
                  : campaign.autoresearch_cadence === "every_2_days"
                    ? "Every 2 days"
                    : "Weekly"
              }
            />
            <StatChip
              Icon={Trophy}
              label="Winners declared"
              value={totalWinners.toLocaleString()}
              hint="across all runs"
            />
            <StatChip
              Icon={Target}
              label="Losers dropped"
              value={totalLosers.toLocaleString()}
            />
            <StatChip
              Icon={Brain}
              label="Posts measured"
              value={totalPostsMeasured.toLocaleString()}
              hint={`${totalExperiments} run${totalExperiments === 1 ? "" : "s"}`}
            />
          </div>
        </CardContent>
      </Card>

      {/* Brain log — reuse the existing universal panel, scoped via the
          filtered runs we just loaded. */}
      {runs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Brain className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-base font-medium mb-1">No brain runs yet</p>
            <p className="text-sm text-muted-foreground">
              The autoresearch loop will write its first decision here once the
              cadence fires for this campaign.
              {!campaign.autoresearch_enabled && (
                <>
                  {" "}Enable it in{" "}
                  <Link
                    href={`/campaigns/${campaign.slug}/edit`}
                    className="text-primary hover:underline"
                  >
                    campaign settings
                  </Link>
                  {" "}first.
                </>
              )}
            </p>
          </CardContent>
        </Card>
      ) : (
        <AutoresearchPanel initial={runs} isAdmin={user?.role === "admin"} />
      )}
    </div>
  );
}
