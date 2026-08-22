"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type SyncResult = {
  ok: boolean;
  checkedAt: string;
  cached: boolean;
  checked: number;
  changed: number;
  failures: Array<{ error: string }>;
};

export function LiveBlotatoSync() {
  const router = useRouter();
  const [result, setResult] = useState<SyncResult>();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    setRefreshing(true);
    try {
      const response = await fetch("/api/creddy/blotato/status", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = await response.json() as SyncResult;
      setResult(next);
      if (next.changed > 0) router.refresh();
    } catch (error) {
      setResult({
        ok: false,
        checkedAt: new Date().toISOString(),
        cached: false,
        checked: 0,
        changed: 0,
        failures: [{ error: error instanceof Error ? error.message : "Live Blotato sync failed" }],
      });
    } finally {
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${result?.ok === false ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
      <span className={`size-2 rounded-full ${result?.ok === false ? "bg-amber-500" : "bg-emerald-500"}`} />
      <span>{result?.ok === false ? "Blotato sync needs attention" : "Blotato live"}</span>
      {result?.checkedAt && <span className="text-muted-foreground">· {new Date(result.checkedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>}
      <button aria-label="Refresh Blotato status" className="ml-auto rounded p-1 hover:bg-black/5" disabled={refreshing} onClick={() => void refresh()} type="button">
        <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}
