"use client";

/**
 * Refresh Now — triggers an immediate analytics+sync refresh for this
 * campaign without waiting for the every-6h cron.
 *
 * Mechanism: inserts a row into cycle_jobs scoped to this campaign,
 * with a marker so the jobs poller knows to run `refresh:quick` instead
 * of a full cycle. The poller (running on the Mac mini via launchd)
 * picks it up within 60s.
 *
 * UI: optimistic — show "Queued ✓" immediately on success, then revert
 * to "Refresh Now" after 4 seconds.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { RefreshCw, Check, Loader2 } from "lucide-react";

interface Props {
  campaignId: string;
  campaignSlug: string;
}

type State = "idle" | "queueing" | "queued" | "error";

export function RefreshNowButton({ campaignId, campaignSlug }: Props) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onClick() {
    if (state !== "idle") return;
    setState("queueing");
    setErrorMsg(null);

    const sb = createBrowserSupabase();
    // We piggy-back on cycle_jobs as the "ask the Mac mini to do something"
    // queue. The poller looks at status='pending', claims it, and decides
    // what to run. The label tells it this is a refresh, not a posting cycle.
    const { error } = await sb.from("cycle_jobs").insert({
      status: "pending",
      label: `refresh:quick:${campaignSlug}`,
      flows: [],
      path: "draft",
      account_handles: [],
      posts_per_account: 0,
      skip_research: true,
      schedule_offset_hours: 0,
      campaign_id: campaignId,
    });

    if (error) {
      setState("error");
      setErrorMsg(error.message);
      return;
    }

    setState("queued");
    // Tell the page to re-fetch shortly — gives the user immediate
    // feedback that data refreshed once the poller fires.
    setTimeout(() => router.refresh(), 8_000);
    setTimeout(() => setState("idle"), 4_000);
  }

  if (state === "error" && errorMsg) {
    return (
      <button
        type="button"
        onClick={() => setState("idle")}
        className="inline-flex items-center gap-1.5 rounded-md border border-destructive bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
        title={errorMsg}
      >
        Failed — retry
      </button>
    );
  }

  if (state === "queueing") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Queueing…
      </span>
    );
  }

  if (state === "queued") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-[#16a34a]/40 bg-[#16a34a]/10 px-3 py-2 text-xs font-medium text-[#16a34a]">
        <Check className="h-3.5 w-3.5" />
        Queued
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-xs font-medium hover:bg-muted transition-colors"
    >
      <RefreshCw className="h-3.5 w-3.5" />
      Refresh Now
    </button>
  );
}
