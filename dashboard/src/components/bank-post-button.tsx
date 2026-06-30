"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function BankPostButton({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "posting" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function post() {
    setState("posting");
    setMsg("");
    try {
      const r = await fetch("/api/bank/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const j = await r.json();
      if (!r.ok) {
        setState("error");
        setMsg(j?.error || "Failed");
        return;
      }
      setState("done");
      router.refresh();
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : "Failed");
    }
  }

  if (state === "done") {
    return <span className="text-sm font-medium text-green-600">✓ Posted</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={post} disabled={state === "posting"}>
        {state === "posting" ? "Posting…" : "Post now"}
      </Button>
      {state === "error" && (
        <span className="text-xs text-red-500 max-w-[220px] text-right leading-tight">{msg}</span>
      )}
    </div>
  );
}
