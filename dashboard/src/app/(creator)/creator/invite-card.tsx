"use client";

/**
 * Pending-invite card for the creator portal.
 *
 * Renders when an admin assigned the creator to a campaign with
 * `as_invite=true` (status='pending'). Shows the deal terms — rate
 * card sentence, expected posts, applied multipliers — so the creator
 * accepts informed, not blind.
 *
 * Two buttons: Accept (→ status='active', accepted_at stamped) and
 * Decline (→ status='rejected', terminal). Both call server actions
 * gated by assertCreator() — the creator can only act on their own
 * pending rows.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, XCircle, AlertCircle, Sparkles } from "lucide-react";
import { acceptAssignment, declineAssignment } from "../../(dashboard)/payouts/actions";
import type { Assignment, Campaign, CampaignPayoutConfig, Multiplier } from "@/lib/types";

interface Props {
  assignment: Assignment;
  campaign: Pick<Campaign, "id" | "slug" | "name" | "status">;
  config: CampaignPayoutConfig | null;
}

function fmtUsd(cents: number, currency: string = "USD"): string {
  const sym = currency === "USD" ? "$" : currency === "INR" ? "₹" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "";
  return `${sym}${(cents / 100).toFixed(2)}`;
}

function rateCardSentence(config: CampaignPayoutConfig | null, rateOverrideCents: number | null): string {
  if (!config || config.mode === "none") return "Rate card not configured yet.";
  const cur = config.currency || "USD";
  const flat = rateOverrideCents ?? config.flat_per_post_cents;
  const cpm = config.cpm_cents;
  switch (config.mode) {
    case "flat":  return flat ? `${fmtUsd(flat, cur)} per published post.` : "Flat fee per post.";
    case "cpm":   return cpm ? `${fmtUsd(cpm, cur)} per 1,000 views (measured ${config.cpm_view_window_days} days after publishing).` : "CPM-based.";
    case "hybrid":return `${flat ? fmtUsd(flat, cur) : "$—"} per post, plus ${cpm ? fmtUsd(cpm, cur) : "$—"} per 1,000 views above ${config.hybrid_threshold_views ?? 0}.`;
    case "milestone": return `Bonus tiers when posts cross view milestones (${config.milestones.length} tier${config.milestones.length === 1 ? "" : "s"}).`;
    default: return "";
  }
}

export function InviteCard({ assignment, campaign, config }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sentence = rateCardSentence(config, assignment.rate_override_cents);
  const lockedMultipliers: Multiplier[] = config
    ? config.multipliers.filter((m) => assignment.applied_multipliers.includes(m.id))
    : [];

  function onAccept() {
    setError(null);
    startTransition(async () => {
      const r = await acceptAssignment({ id: assignment.id });
      if (!r.ok) { setError(r.error); return; }
      router.refresh();
    });
  }

  function onDecline() {
    if (!confirm(
      `Decline this invite from ${campaign.name}?\n\nThis is final — your contact would have to send a fresh invite to re-add you.`,
    )) return;
    setError(null);
    startTransition(async () => {
      const r = await declineAssignment({ id: assignment.id });
      if (!r.ok) { setError(r.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border-2 border-emerald-500/40 bg-gradient-to-br from-emerald-500/[0.10] to-emerald-500/[0.02] p-5 sm:p-6 space-y-4 shadow-sm hover:shadow-md transition-shadow">
      {/* Decorative dot pattern in the corner — matches the hero card */}
      <div
        aria-hidden
        className="absolute -top-4 -right-4 h-24 w-24 opacity-30 [background-image:radial-gradient(theme(colors.emerald.500/0.5)_1px,transparent_1px)] [background-size:10px_10px] pointer-events-none"
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-7 w-7 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
            <Sparkles className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-emerald-700/80 dark:text-emerald-400/80 font-semibold">
              New invite
            </p>
            <p className="text-base font-semibold leading-tight">{campaign.name}</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-2 text-sm">
        <Row label="Expected posts">{assignment.expected_posts}</Row>
        <Row label="How you're paid">{sentence}</Row>
        {lockedMultipliers.length > 0 && (
          <Row label="Bonuses included">
            <div className="flex flex-wrap gap-1.5">
              {lockedMultipliers.map((m) => (
                <span
                  key={m.id}
                  className="inline-flex items-center rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-medium"
                >
                  {m.label} ({m.pct >= 0 ? "+" : ""}{m.pct}%)
                </span>
              ))}
            </div>
          </Row>
        )}
        {assignment.due_date && (
          <Row label="Due by">{new Date(assignment.due_date).toLocaleDateString("en-US")}</Row>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 pt-3 border-t border-emerald-500/15">
        <button
          type="button"
          onClick={onDecline}
          disabled={pending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm hover:bg-muted/40 transition-colors disabled:opacity-50"
        >
          <XCircle className="h-3.5 w-3.5" />
          Decline
        </button>
        <button
          type="button"
          onClick={onAccept}
          disabled={pending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          Accept invite
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 items-baseline">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
        {label}
      </span>
      <span>{children}</span>
    </div>
  );
}
