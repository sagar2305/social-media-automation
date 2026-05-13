"use client";

/**
 * "Send test" button for /campaigns/[slug]/reports.
 *
 * Calls the sendTestDigest server action, surfaces success/failure
 * inline. Idle → sending → result. Result chip auto-resets after 5s.
 */

import { useState } from "react";
import { Send, Loader2, Check, AlertTriangle } from "lucide-react";
import { sendTestDigest } from "./actions";

export function TestSendButton({
  slug,
  hasRecipients,
}: {
  slug: string;
  hasRecipients: boolean;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onClick() {
    if (state === "sending") return;
    setState("sending");
    setErrorMsg(null);
    const result = await sendTestDigest({ slug });
    if (result.ok) {
      setState("sent");
      setTimeout(() => setState("idle"), 5_000);
    } else {
      setState("error");
      setErrorMsg(result.error);
      setTimeout(() => setState("idle"), 7_000);
    }
  }

  if (!hasRecipients) {
    return (
      <button
        type="button"
        disabled
        title="Add at least one recipient on the edit page"
        className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-xs font-medium text-muted-foreground cursor-not-allowed"
      >
        <Send className="h-3.5 w-3.5" />
        Send test
      </button>
    );
  }

  if (state === "sending") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Sending…
      </span>
    );
  }

  if (state === "sent") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-[#16a34a]/40 bg-[#16a34a]/10 px-3 py-2 text-xs font-medium text-[#16a34a]">
        <Check className="h-3.5 w-3.5" />
        Sent
      </span>
    );
  }

  if (state === "error") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-md border border-destructive bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive max-w-[260px] truncate"
        title={errorMsg ?? undefined}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {errorMsg ?? "Failed"}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-xs font-medium hover:bg-muted transition-colors"
    >
      <Send className="h-3.5 w-3.5" />
      Send test
    </button>
  );
}
