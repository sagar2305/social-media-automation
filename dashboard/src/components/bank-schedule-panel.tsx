"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Bulk-schedule the Content Bank onto 3-a-day slots.
 *
 * Deliberately two-step: "Preview" computes the assignment and shows every slot
 * before anything is submitted, because Blotato has no delete-post endpoint —
 * once a post is scheduled it can't be pulled back from this dashboard.
 *
 * Execution walks the plan in small chunks so the user sees progress instead of
 * one request hanging for minutes under Blotato's 30 req/min rate limit.
 */

const ACCOUNTS = ["yournotetaker", "grow.with.claudia", "miniutewise_thomas"];

/**
 * Two posts per request. Each post first compresses and re-uploads its ~6
 * slides to Blotato's media store, so a post costs ~7 rate-limited calls
 * (~15s). Small chunks keep each request short and the progress bar moving.
 */
const CHUNK = 2;

interface PlanItem {
  id: string;
  account: string;
  title: string;
  scheduledAt: string;
  istLabel: string;
}
interface Plan {
  items: PlanItem[];
  skipped: { account: string; count: number; reason: string }[];
  totalBanked: number;
}

export function BankSchedulePanel({ defaultStartDate }: { defaultStartDate: string }) {
  const router = useRouter();
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [times, setTimes] = useState("02:00, 06:00, 20:00");
  const [accounts, setAccounts] = useState<string[]>(ACCOUNTS);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [done, setDone] = useState<{ ok: number; failed: { id: string; error: string }[] } | null>(null);

  const parsedTimes = times
    .split(",")
    .map((t) => t.trim())
    .filter((t) => /^\d{1,2}:\d{2}$/.test(t))
    .map((t) => (t.length === 4 ? `0${t}` : t));

  function toggleAccount(a: string) {
    setPlan(null);
    setAccounts((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  }

  async function preview() {
    setBusy(true);
    setError("");
    setDone(null);
    try {
      const r = await fetch("/api/bank/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "plan", startDate, times: parsedTimes, accounts }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error || "Failed to build plan");
        return;
      }
      setPlan(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to build plan");
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (!plan) return;
    setBusy(true);
    setError("");
    const failed: { id: string; error: string }[] = [];
    let ok = 0;
    setProgress({ done: 0, total: plan.items.length });

    for (let i = 0; i < plan.items.length; i += CHUNK) {
      const slice = plan.items.slice(i, i + CHUNK);
      try {
        const r = await fetch("/api/bank/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "execute",
            items: slice.map((s) => ({ id: s.id, scheduledAt: s.scheduledAt })),
          }),
        });
        const j = await r.json();
        if (!r.ok) {
          slice.forEach((s) => failed.push({ id: s.id, error: j?.error || `HTTP ${r.status}` }));
        } else {
          for (const res of j.results as { id: string; ok: boolean; error?: string }[]) {
            if (res.ok) ok++;
            else failed.push({ id: res.id, error: res.error || "Unknown error" });
          }
        }
      } catch (e) {
        slice.forEach((s) =>
          failed.push({ id: s.id, error: e instanceof Error ? e.message : "Network error" })
        );
      }
      setProgress({ done: Math.min(i + CHUNK, plan.items.length), total: plan.items.length });
    }

    setDone({ ok, failed });
    setPlan(null);
    setBusy(false);
    router.refresh();
  }

  const byAccount = new Map<string, PlanItem[]>();
  for (const it of plan?.items ?? []) {
    if (!byAccount.has(it.account)) byAccount.set(it.account, []);
    byAccount.get(it.account)!.push(it);
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-semibold">Schedule the bank</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Spreads banked posts across daily slots, one lane per account.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={preview} disabled={busy || !parsedTimes.length}>
              {busy && !progress.total ? "Building…" : "Preview"}
            </Button>
            {plan && plan.items.length > 0 && (
              <Button onClick={execute} disabled={busy}>
                {busy
                  ? `Scheduling ${progress.done}/${progress.total}…`
                  : `Confirm & schedule ${plan.items.length}`}
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-4 items-end">
          <label className="text-sm">
            <span className="block text-muted-foreground mb-1">Start date (IST)</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPlan(null);
              }}
              className="border rounded-md px-3 py-1.5 bg-background"
            />
          </label>
          <label className="text-sm">
            <span className="block text-muted-foreground mb-1">Slots per day (IST)</span>
            <input
              type="text"
              value={times}
              onChange={(e) => {
                setTimes(e.target.value);
                setPlan(null);
              }}
              className="border rounded-md px-3 py-1.5 bg-background w-56"
            />
          </label>
          <div className="text-sm">
            <span className="block text-muted-foreground mb-1">Accounts</span>
            <div className="flex gap-3">
              {ACCOUNTS.map((a) => (
                <label key={a} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={accounts.includes(a)}
                    onChange={() => toggleAccount(a)}
                  />
                  <span>@{a}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        {done && (
          <div className="text-sm space-y-1">
            <p className="font-medium text-green-600">✓ Scheduled {done.ok} posts</p>
            {done.failed.length > 0 && (
              <div className="text-red-500">
                <p>{done.failed.length} failed:</p>
                <ul className="list-disc pl-5">
                  {done.failed.slice(0, 8).map((f) => (
                    <li key={f.id}>
                      {f.id} — {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {plan && (
          <div className="space-y-3 border-t pt-4">
            {plan.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing to schedule for the selected accounts.
              </p>
            ) : (
              <>
                <p className="text-sm">
                  <span className="font-medium">{plan.items.length} posts</span> will be scheduled,
                  from <span className="font-medium">{plan.items[0].istLabel}</span> to{" "}
                  <span className="font-medium">{plan.items[plan.items.length - 1].istLabel}</span>.
                  Blotato has no delete endpoint — this can&apos;t be undone from here.
                </p>
                <p className="text-sm text-muted-foreground">
                  Each post&apos;s slides are compressed and re-uploaded to Blotato before
                  submitting, so expect roughly {Math.ceil((plan.items.length * 25) / 60)} min for{" "}
                  {plan.items.length} posts (measured: ~23s per 6-slide post). Keep this tab open.
                </p>
                {plan.skipped.length > 0 && (
                  <p className="text-sm text-amber-600">
                    Skipped:{" "}
                    {plan.skipped.map((s) => `${s.count} × @${s.account} (${s.reason})`).join(", ")}
                  </p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-h-80 overflow-y-auto">
                  {[...byAccount].map(([account, items]) => (
                    <div key={account} className="text-sm">
                      <p className="font-medium mb-1">
                        @{account} · {items.length}
                      </p>
                      <ul className="space-y-1 text-muted-foreground">
                        {items.map((it) => (
                          <li key={it.id} className="truncate">
                            {it.istLabel} — {it.title}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
