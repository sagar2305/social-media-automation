/**
 * Single-assignment progress card for the creator portal.
 *
 * Shows: campaign name, assignment status, posts delivered vs expected
 * with a bar, plain-English summary of how pay is calculated, and which
 * multipliers were locked in for this assignment.
 *
 * The plain-English rate card is the killer detail — creators always
 * want to know "what am I being paid?" without parsing the operator's
 * config form. We translate `mode + amounts` into one short sentence.
 */

import type { Assignment, Campaign, CampaignPayoutConfig, Multiplier } from "@/lib/types";

interface Props {
  campaign: Pick<Campaign, "id" | "slug" | "name" | "status">;
  assignment: Assignment;
  config: CampaignPayoutConfig | null;
  postsDelivered: number;
}

function fmtUsd(cents: number, currency: string = "USD"): string {
  const sym = currency === "USD" ? "$" : currency === "INR" ? "₹" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "";
  return `${sym}${(cents / 100).toFixed(2)}`;
}

function rateCardSentence(
  config: CampaignPayoutConfig | null,
  rateOverrideCents: number | null,
): string {
  if (!config || config.mode === "none") {
    return "Rate card not set yet — check back once your contact configures it.";
  }
  const cur = config.currency || "USD";
  const flat = rateOverrideCents ?? config.flat_per_post_cents;
  const cpm = config.cpm_cents;
  switch (config.mode) {
    case "flat":
      return flat ? `${fmtUsd(flat, cur)} per published post.` : "Flat fee per post.";
    case "cpm":
      return cpm ? `${fmtUsd(cpm, cur)} per 1,000 views (measured ${config.cpm_view_window_days} days after publishing).` : "CPM-based.";
    case "hybrid":
      return `${flat ? fmtUsd(flat, cur) : "$—"} per post, plus ${cpm ? fmtUsd(cpm, cur) : "$—"} per 1,000 views above ${config.hybrid_threshold_views ?? 0}.`;
    case "milestone":
      return `Bonus tiers when posts cross view milestones (${config.milestones.length} tier${config.milestones.length === 1 ? "" : "s"} configured).`;
    default:
      return "";
  }
}

function appliedMultiplierLabels(config: CampaignPayoutConfig | null, ids: string[]): Multiplier[] {
  if (!config || ids.length === 0) return [];
  return config.multipliers.filter((m) => ids.includes(m.id));
}

export function CampaignProgressCard({ campaign, assignment, config, postsDelivered }: Props) {
  const expected = Math.max(1, assignment.expected_posts);
  const pct = Math.min(100, Math.round((postsDelivered / expected) * 100));
  const overDelivered = postsDelivered > expected;
  const sentence = rateCardSentence(config, assignment.rate_override_cents);
  const multipliers = appliedMultiplierLabels(config, assignment.applied_multipliers);

  return (
    <div className="group rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-4 transition-all hover:border-emerald-500/30 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold tracking-tight">{campaign.name}</p>
          <p className="text-[11px] text-muted-foreground mt-1 uppercase tracking-widest">
            {assignment.status}
            {assignment.due_date && (
              <> · due {new Date(assignment.due_date).toLocaleDateString("en-US")}</>
            )}
          </p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
            campaign.status === "active"
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "bg-muted text-muted-foreground"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${campaign.status === "active" ? "bg-emerald-500" : "bg-muted-foreground/50"}`} />
          {campaign.status}
        </span>
      </div>

      {/* Progress bar — saturates at 100% but appends "+N over" when
          the creator delivered more than expected, which happens when
          the operator increases expected_posts mid-flight. */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5 text-xs">
          <span className="text-muted-foreground">Posts delivered</span>
          <span className="tabular-nums font-medium">
            {postsDelivered} / {expected}
            {overDelivered && (
              <span className="text-emerald-600 dark:text-emerald-400 ml-1.5">
                +{postsDelivered - expected} over
              </span>
            )}
          </span>
        </div>
        <div className="h-2 w-full bg-muted/70 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${
              pct >= 100
                ? "bg-gradient-to-r from-emerald-500 to-emerald-600"
                : "bg-gradient-to-r from-emerald-400 to-emerald-500"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Rate card explainer + locked-in multipliers */}
      <div className="pt-3 border-t border-border/50 space-y-2">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
          How you&apos;re paid on this campaign
        </p>
        <p className="text-sm">{sentence}</p>
        {multipliers.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {multipliers.map((m) => (
              <span
                key={m.id}
                className="inline-flex items-center rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-medium"
              >
                {m.label} ({m.pct >= 0 ? "+" : ""}{m.pct}%)
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
