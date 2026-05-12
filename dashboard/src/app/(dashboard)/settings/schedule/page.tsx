import { createClient } from "@/lib/supabase";
import { ScheduleForm } from "@/components/schedule-form";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { ChevronRight, Clock, Layers } from "lucide-react";
import type { CycleBatch } from "@/components/batch-manager";

export const revalidate = 0;

interface ScheduleSettings {
  enabled: boolean;
  timezone: string;
  last_run_date: string | null;
  last_run_at: string | null;
}

interface CampaignRow {
  id: string;
  slug: string;
  name: string;
  status: "active" | "paused" | "archived";
}

/**
 * /settings/schedule — global scheduler controls only.
 *
 * Master enabled toggle + timezone live here (these are process-wide
 * and apply to every campaign's batches). Batch creation/editing
 * itself moved to /campaigns/[slug]/schedule because every batch must
 * belong to a campaign — there's no meaningful "global" batch
 * anymore. This page now summarises each campaign's batch count and
 * links straight to its scheduler.
 */
export default async function SchedulePage() {
  const supabase = await createClient();

  const [settingsRes, batchesRes, campaignsRes] = await Promise.all([
    supabase.from("schedule_settings").select("*").eq("id", 1).single<ScheduleSettings>(),
    supabase
      .from("cycle_batches")
      .select("*")
      .order("run_time", { ascending: true })
      .returns<CycleBatch[]>(),
    supabase
      .from("campaigns")
      .select("id, slug, name, status")
      .order("created_at", { ascending: true })
      .returns<CampaignRow[]>(),
  ]);

  const batches = batchesRes.data ?? [];
  const campaigns = campaignsRes.data ?? [];

  // Group batch counts per campaign + spot any orphan rows (no
  // campaign_id, or campaign_id pointing at a deleted campaign). The
  // engine refuses to fire orphan rows; surfacing them here lets the
  // operator clean them up without digging through SQL.
  const byCampaignId = new Map<string, CycleBatch[]>();
  const orphans: CycleBatch[] = [];
  const knownCampaignIds = new Set(campaigns.map((c) => c.id));
  for (const b of batches) {
    if (!b.campaign_id || !knownCampaignIds.has(b.campaign_id)) {
      orphans.push(b);
      continue;
    }
    const arr = byCampaignId.get(b.campaign_id) ?? [];
    arr.push(b);
    byCampaignId.set(b.campaign_id, arr);
  }

  return (
    <div className="space-y-10">
      <ScheduleForm
        enabled={settingsRes.data?.enabled ?? true}
        timezone={settingsRes.data?.timezone ?? "Asia/Kolkata"}
        lastRunDate={settingsRes.data?.last_run_date ?? null}
        lastRunAt={settingsRes.data?.last_run_at ?? null}
        batches={batches}
      />

      <Card>
        <CardContent className="pt-6 space-y-5">
          <div>
            <p className="text-lg font-semibold flex items-center gap-2">
              <Layers className="h-5 w-5 text-muted-foreground" />
              Campaign Schedules
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
              Batches live on each campaign now — every batch posts only to
              its own campaign&apos;s accounts. Pick a campaign below to manage
              its schedule. Adding or editing a batch from this global page is
              no longer supported.
            </p>
          </div>

          <div className="divide-y divide-border/60">
            {campaigns.map((c) => {
              const cBatches = byCampaignId.get(c.id) ?? [];
              const enabledCount = cBatches.filter((b) => b.enabled).length;
              return (
                <Link
                  key={c.id}
                  href={`/campaigns/${c.slug}/schedule`}
                  className="flex items-center justify-between gap-3 py-3 hover:bg-muted/30 -mx-2 px-2 rounded-md transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium flex items-center gap-2">
                      {c.name}
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {c.slug}
                      </span>
                      {c.status !== "active" && (
                        <span className="text-[10px] uppercase tracking-wider text-amber-600">
                          {c.status}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                      <Clock className="h-3 w-3" />
                      {cBatches.length === 0
                        ? "No batches"
                        : `${cBatches.length} batch${cBatches.length === 1 ? "" : "es"} · ${enabledCount} enabled`}
                      {cBatches.length > 0 && (
                        <span className="text-muted-foreground/70">
                          · {cBatches
                            .slice(0, 4)
                            .map((b) => b.run_time)
                            .join(", ")}
                          {cBatches.length > 4 ? ", …" : ""}
                        </span>
                      )}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </Link>
              );
            })}
            {campaigns.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No campaigns yet.{" "}
                <Link href="/campaigns/new" className="text-primary underline-offset-4 hover:underline">
                  Create one
                </Link>{" "}
                to start scheduling.
              </p>
            )}
          </div>

          {orphans.length > 0 && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
              <p className="text-sm font-semibold text-destructive">
                {orphans.length} orphan batch{orphans.length === 1 ? "" : "es"} found
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                These batches have no campaign_id (or point at a deleted campaign), so the
                engine refuses to fire them. Delete them via SQL or attach them to a campaign:
              </p>
              <ul className="mt-2 space-y-1">
                {orphans.map((b) => (
                  <li key={b.id} className="text-xs font-mono text-destructive/80">
                    {b.run_time} {b.label} <span className="text-destructive/60">({b.id})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
