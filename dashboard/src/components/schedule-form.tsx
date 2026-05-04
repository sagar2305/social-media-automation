"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Save, CalendarCheck2, Power } from "lucide-react";
import type { CycleBatch } from "@/components/batch-manager";

interface Props {
  enabled: boolean;
  timezone: string;
  lastRunDate: string | null;
  lastRunAt: string | null;
  batches: CycleBatch[];
}

const COMMON_TIMEZONES = [
  "Asia/Kolkata",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Australia/Sydney",
  "UTC",
];

export function ScheduleForm({
  enabled: initialEnabled,
  timezone: initialTz,
  lastRunDate,
  lastRunAt,
  batches,
}: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [timezone, setTimezone] = useState(initialTz);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = enabled !== initialEnabled || timezone !== initialTz;

  const nextRun = useMemo(
    () => computeNextRunFromBatches(batches, timezone, enabled),
    [batches, timezone, enabled],
  );

  async function handleSave() {
    setSaving(true);
    setError(null);
    const supabase = createBrowserSupabase();

    const { error: err } = await supabase
      .from("schedule_settings")
      .update({
        enabled,
        timezone,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    router.refresh();
  }

  const enabledBatches = batches.filter((b) => b.enabled);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cycle Schedule</h1>
          <p className="text-muted-foreground mt-1">
            Master scheduler settings. Add or edit specific run times in the <strong>Cycle Batches</strong> table below.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving || !dirty}>
          <Save className="h-4 w-4 mr-1.5" />
          {saving ? "Saving…" : saved ? "Saved!" : "Save Changes"}
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-4 pb-4 text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Master controls */}
        <Card className="lg:col-span-2 shadow-sm border-0 ring-0">
          <CardContent className="pt-6 space-y-6">
            <div>
              <p className="text-lg font-semibold">Master controls</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Settings that apply to every batch. Each batch&apos;s own time, flow, accounts, and path are configured below.
              </p>
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 block">
                Timezone (used by every batch)
              </label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-border/50 bg-muted/40 px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              >
                {(COMMON_TIMEZONES.includes(timezone) ? COMMON_TIMEZONES : [timezone, ...COMMON_TIMEZONES]).map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Each batch&apos;s run time is interpreted in this timezone.
              </p>
            </div>

            <div className="flex items-center justify-between border-t border-border/50 pt-5">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center">
                  <Power className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Master scheduler</p>
                  <p className="text-xs text-muted-foreground">
                    Off pauses ALL batches at once. Individual batches can be turned off below without affecting the master switch.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEnabled(!enabled)}
                aria-label="Toggle master scheduler"
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
                  enabled ? "bg-primary" : "bg-muted-foreground/30"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform mt-0.5 ${
                    enabled ? "translate-x-5 ml-0.5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Status panel */}
        <Card className="shadow-sm border-0 ring-0 bg-primary text-primary-foreground overflow-hidden">
          <CardContent className="pt-6 flex flex-col h-full">
            <div className="mb-4">
              <div className="h-10 w-10 rounded-lg bg-white/20 flex items-center justify-center mb-4">
                <CalendarCheck2 className="h-5 w-5" />
              </div>
              <p className="text-xl font-bold">{enabled ? "Active" : "Paused"}</p>
              <p className="text-sm text-primary-foreground/70 mt-1">
                {!enabled
                  ? "Master scheduler is off — no batches will fire."
                  : enabledBatches.length === 0
                    ? "No enabled batches. Add one below."
                    : nextRun
                      ? `Next run: ${nextRun}`
                      : "—"}
              </p>
            </div>
            <div className="mt-auto pt-6 space-y-3 text-sm">
              <Row label="Enabled batches" value={`${enabledBatches.length} of ${batches.length}`} />
              <Row label="Last run date" value={lastRunDate ?? "Never"} />
              <Row label="Last run at" value={formatDateTime(lastRunAt)} />
              <Row label="Tick interval" value="every 5 min" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm border-0 ring-0">
        <CardContent className="pt-6">
          <p className="text-sm font-semibold mb-2">How this works</p>
          <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
            <li>The Mac runs a 5-minute scheduler tick. Each tick reads the batches below from Supabase.</li>
            <li>For every enabled batch whose <code className="text-xs bg-muted/40 rounded px-1">run_time</code> has passed today and that hasn&apos;t already fired today, the cycle runs with that batch&apos;s flow / accounts / path / posts-per-account.</li>
            <li>If the Mac was asleep at a batch&apos;s scheduled time, the next tick after wake-up picks up the missed batch automatically.</li>
            <li>Editing a batch below takes effect within 5 minutes — no restart, no SSH, no plist editing.</li>
            <li>The <strong>Master scheduler</strong> toggle pauses everything at once. Individual batch toggles pause just that one row.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-primary-foreground/70">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "Never";
  try {
    const d = new Date(iso);
    const fmt = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
    return fmt.format(d);
  } catch {
    return iso;
  }
}

function computeNextRunFromBatches(
  batches: CycleBatch[],
  timezone: string,
  enabled: boolean,
): string | null {
  if (!enabled) return null;
  const eligible = batches.filter((b) => b.enabled);
  if (eligible.length === 0) return null;

  const today = nowInTimezone(timezone);
  const todayDate = today.date;
  const todayMin = today.minutes;

  // For each enabled batch, figure out whether it's still "today" (run_time in
  // future and not already run today) or has slipped to "tomorrow".
  type Candidate = { batch: CycleBatch; whenLabel: string; sortKey: number };
  const candidates: Candidate[] = eligible.map((b) => {
    const targetMin = parseHHMM(b.run_time);
    const ranToday = b.last_run_date === todayDate;
    const stillToday = !ranToday && targetMin >= todayMin;
    if (stillToday) {
      return {
        batch: b,
        whenLabel: `today at ${b.run_time}`,
        sortKey: targetMin, // earlier today first
      };
    }
    // Tomorrow run — use 24*60 + targetMin to sort after all "today" runs
    return {
      batch: b,
      whenLabel: `tomorrow at ${b.run_time}`,
      sortKey: 24 * 60 + targetMin,
    };
  });

  candidates.sort((a, b) => a.sortKey - b.sortKey);
  const next = candidates[0];
  return `${next.whenLabel} — ${next.batch.label}`;
}

function nowInTimezone(tz: string): { date: string; minutes: number } {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      minutes: parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10),
    };
  } catch {
    const now = new Date();
    return {
      date: now.toISOString().slice(0, 10),
      minutes: now.getUTCHours() * 60 + now.getUTCMinutes(),
    };
  }
}

function parseHHMM(s: string): number {
  const [hh, mm] = s.split(":").map(Number);
  return (hh || 0) * 60 + (mm || 0);
}
