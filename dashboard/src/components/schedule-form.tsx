"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Save, Clock, CalendarCheck2, Power } from "lucide-react";

interface Props {
  enabled: boolean;
  runTime: string;
  timezone: string;
  lastRunDate: string | null;
  lastRunAt: string | null;
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
  runTime: initialRunTime,
  timezone: initialTz,
  lastRunDate,
  lastRunAt,
}: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [runTime, setRunTime] = useState(initialRunTime);
  const [timezone, setTimezone] = useState(initialTz);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    enabled !== initialEnabled ||
    runTime !== initialRunTime ||
    timezone !== initialTz;

  const nextRun = useMemo(() => computeNextRun(runTime, timezone, enabled), [runTime, timezone, enabled]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const supabase = createBrowserSupabase();

    const { error: err } = await supabase
      .from("schedule_settings")
      .update({
        enabled,
        run_time: runTime,
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

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cycle Schedule</h1>
          <p className="text-muted-foreground mt-1">
            Set when the content pipeline runs each day. Changes apply within 5 minutes.
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
        {/* Schedule controls */}
        <Card className="lg:col-span-2 shadow-sm border-0 ring-0">
          <CardContent className="pt-6 space-y-6">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <p className="text-lg font-semibold">Daily run time</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 block">
                  Run Time (HH:MM, 24h)
                </label>
                <Input
                  type="time"
                  value={runTime}
                  onChange={(e) => setRunTime(e.target.value)}
                  className="bg-muted/40 border-border/50"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 block">
                  Timezone
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
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-border/50 pt-5">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center">
                  <Power className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Scheduler enabled</p>
                  <p className="text-xs text-muted-foreground">
                    When off, the cycle never runs automatically. Manual runs via the CLI still work.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEnabled(!enabled)}
                aria-label="Toggle scheduler"
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
                {enabled
                  ? `Next run: ${nextRun ?? "—"}`
                  : "The pipeline will not run until re-enabled."}
              </p>
            </div>
            <div className="mt-auto pt-6 space-y-3 text-sm">
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
            <li>The Mac runs a 5-minute scheduler tick. Each tick reads this setting from Supabase.</li>
            <li>If the current time (in the chosen timezone) is past the run time and today&apos;s cycle hasn&apos;t already run, the daily flow fires.</li>
            <li>If the Mac was asleep at the scheduled time, the next tick after it wakes will pick up the missed run.</li>
            <li>Changing the time below takes effect within 5 minutes — no restart, no SSH, no plist editing.</li>
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
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function computeNextRun(runTime: string, timezone: string, enabled: boolean): string | null {
  if (!enabled) return null;
  const [hh, mm] = runTime.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;

  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const tzNowMin = parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10);
  const targetMin = hh * 60 + mm;

  const label = `${runTime} ${timezone}`;
  return tzNowMin < targetMin ? `today at ${label}` : `tomorrow at ${label}`;
}
