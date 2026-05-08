/**
 * /campaigns/[slug]/reports — email digest config + sent-history view.
 *
 * Phase 11 scope: surface the campaign's report configuration
 * (recipients, frequency, what's included) read from the campaigns
 * row, plus a placeholder Test send button. Resend integration +
 * actual email delivery + sent-history table land in Phase 16.
 *
 * The card style mirrors AI Brain so the two tabs feel like siblings.
 */

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, Calendar, Send, Inbox, BellOff } from "lucide-react";
import Link from "next/link";
import type { Campaign } from "@/lib/types";

export const revalidate = 60;

const INCLUDE_LABELS: Record<string, string> = {
  kpis: "KPI summary (videos, views, likes, comments, shares, saves)",
  top_posts: "Top posts of the week",
  ai_insights: "AI Brain insights from autoresearch",
  failed_posts: "Posts that failed to publish",
  account_growth: "Per-account follower / view trend",
};

function frequencyLabel(f: Campaign["email_frequency"]): string {
  if (f === "daily") return "Every day";
  if (f === "monthly") return "Once a month";
  return "Every week";
}

export default async function CampaignReportsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sb = await createClient();
  const { data: campaign } = await sb
    .from("campaigns")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<Campaign>();
  if (!campaign) notFound();

  const recipients = campaign.email_recipients ?? [];
  const include = campaign.email_include ?? {};
  const includedKeys = Object.entries(include)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  const hasRecipients = recipients.length > 0;

  return (
    <div className="space-y-5">
      {/* Header card */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div
                className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                  hasRecipients
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <p className="text-base font-semibold">
                  Email reports {hasRecipients ? "configured" : "not configured"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {hasRecipients
                    ? `${frequencyLabel(campaign.email_frequency)}, ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}.`
                    : "Add at least one recipient email to start receiving digests."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/campaigns/${campaign.slug}/edit`}
                className="text-xs font-medium text-primary hover:underline"
              >
                Configure →
              </Link>
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-xs font-medium text-muted-foreground cursor-not-allowed"
                title="Test send — wired up in Phase 16 (Resend integration)"
              >
                <Send className="h-3.5 w-3.5" />
                Send test
              </button>
            </div>
          </div>

          {/* Frequency */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-md border border-border bg-card px-3 py-2.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Calendar className="h-3.5 w-3.5" />
                Frequency
              </div>
              <p className="text-sm font-semibold">
                {frequencyLabel(campaign.email_frequency)}
              </p>
            </div>
            <div className="rounded-md border border-border bg-card px-3 py-2.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Inbox className="h-3.5 w-3.5" />
                Recipients
              </div>
              {hasRecipients ? (
                <div className="flex flex-wrap gap-1">
                  {recipients.map((email) => (
                    <span
                      key={email}
                      className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[11px] font-mono"
                    >
                      {email}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  None configured
                </p>
              )}
            </div>
          </div>

          {/* What's included */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Included in each digest
            </p>
            <div className="space-y-1">
              {Object.entries(INCLUDE_LABELS).map(([key, label]) => {
                const enabled = include[key] === true;
                return (
                  <div
                    key={key}
                    className="flex items-center gap-2 text-sm py-1"
                  >
                    <span
                      className={`inline-flex h-4 w-4 items-center justify-center rounded-sm shrink-0 ${
                        enabled
                          ? "bg-[#16a34a] text-white"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {enabled ? (
                        <svg
                          className="h-3 w-3"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          aria-hidden
                        >
                          <path
                            fillRule="evenodd"
                            clipRule="evenodd"
                            d="M16.7 5.3a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0l-3-3a1 1 0 1 1 1.4-1.4L9 11.6l6.3-6.3a1 1 0 0 1 1.4 0Z"
                          />
                        </svg>
                      ) : null}
                    </span>
                    <span
                      className={
                        enabled ? "text-foreground" : "text-muted-foreground line-through"
                      }
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
              {includedKeys.length === 0 && (
                <p className="text-sm text-muted-foreground italic mt-2">
                  No content blocks selected — digest would be empty.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sent history placeholder */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-base font-semibold">Sent history</p>
            <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider">
              Phase 16
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Email delivery wires up in Phase 16 (Resend integration). Once
            that lands, every send shows up here with a status (delivered /
            bounced / opened) and a "View as recipient" link.
          </p>

          {!hasRecipients && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
              <BellOff className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Add recipient emails on the{" "}
                <Link
                  href={`/campaigns/${campaign.slug}/edit`}
                  className="text-primary hover:underline"
                >
                  edit page
                </Link>
                {" "}so digests start sending the moment Phase 16 ships.
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
