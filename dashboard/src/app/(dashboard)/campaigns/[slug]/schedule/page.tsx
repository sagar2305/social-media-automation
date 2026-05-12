/**
 * /campaigns/[slug]/schedule — campaign-scoped batch editor.
 *
 * Same UI as the global /settings/schedule but filtered to one
 * campaign: only this campaign's batches show in the table, only
 * this campaign's accounts are pickable, and newly created batches
 * have campaign_id auto-set to this campaign.
 *
 * The global schedule_settings (master enabled toggle + timezone +
 * last-run sentinel) is shared across all campaigns and isn't shown
 * here — it lives at /settings/schedule.
 */

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { getUser } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { BatchManager, type CycleBatch } from "@/components/batch-manager";
import type { ManagedAccount } from "@/components/account-manager";
import type { Campaign } from "@/lib/types";
import Link from "next/link";
import { Settings as SettingsIcon, Info } from "lucide-react";

export const revalidate = 0;

async function loadSchedule(slug: string) {
  const sb = await createClient();
  const { data: campaign } = await sb
    .from("campaigns")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<Campaign>();
  if (!campaign) return null;

  const [batchesRes, accountsRes] = await Promise.all([
    sb
      .from("cycle_batches")
      .select("*")
      .eq("campaign_id", campaign.id)
      .order("order_index", { ascending: true })
      .returns<CycleBatch[]>(),
    sb
      .from("accounts")
      .select("id, name, handle, active, notes")
      .eq("campaign_id", campaign.id)
      .order("created_at", { ascending: true })
      .returns<ManagedAccount[]>(),
  ]);

  return {
    campaign,
    batches: batchesRes.data ?? [],
    accounts: accountsRes.data ?? [],
  };
}

export default async function CampaignSchedulePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await loadSchedule(slug);
  if (!data) notFound();

  const { campaign, batches, accounts } = data;
  const user = await getUser();

  return (
    <div className="space-y-5">
      {/* Helper info — explains the relationship to global schedule_settings */}
      <Card className="shadow-sm border-0 ring-0">
        <CardContent className="py-3 px-4 flex items-start gap-3 text-xs text-muted-foreground">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>
              Batches define when this campaign posts. The Mac mini&apos;s
              <code className="font-mono mx-1 px-1 py-0.5 rounded bg-muted">scheduler.tick</code>
              fires each enabled batch at its run time.
            </p>
            <p className="mt-1">
              The master scheduler toggle and timezone live in{" "}
              <Link
                href="/settings/schedule"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                <SettingsIcon className="h-3 w-3" />
                Settings → Schedule
              </Link>
              {" "}— they apply to every campaign.
            </p>
          </div>
        </CardContent>
      </Card>

      {accounts.length === 0 && (
        <Card className="shadow-sm border border-destructive/40 bg-destructive/[0.04]">
          <CardContent className="py-4 px-4 flex items-start gap-3">
            <div className="mt-0.5 shrink-0">
              <div className="h-7 w-7 rounded-full bg-destructive/10 border border-destructive/30 flex items-center justify-center">
                <Info className="h-4 w-4 text-destructive" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-destructive">
                You can&apos;t create a batch yet — this campaign has no accounts.
              </p>
              <p className="text-sm text-foreground/80 mt-1">
                A scheduled batch posts to this campaign&apos;s accounts only.
                With zero accounts attached, a batch would have nothing to post
                to and the cycle will refuse to run.
              </p>
              <Link
                href={`/campaigns/${campaign.slug}/accounts`}
                className="inline-flex items-center mt-3 text-sm font-medium text-destructive hover:text-destructive/80 underline-offset-4 hover:underline"
              >
                Go to Accounts tab → add an account first
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      <BatchManager
        initial={batches}
        accounts={accounts}
        isAdmin={user?.role === "admin"}
        campaignId={campaign.id}
        campaignSlug={campaign.slug}
        campaignFlow={
          campaign.flows_enabled?.photorealistic ? "photorealistic" :
          campaign.flows_enabled?.animated ? "animated" :
          campaign.flows_enabled?.emoji_overlay ? "emoji_overlay" :
          "photorealistic"
        }
      />
    </div>
  );
}
