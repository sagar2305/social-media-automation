"use client";

import {
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  LoaderCircle,
  Send,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type CreddyCalendarEvent = {
  key: string;
  itemId: string;
  hook: string;
  platform: "instagram" | "tiktok";
  account: string;
  format: "text_music" | "narrated";
  mode: "tiktok_draft" | "schedule" | "publish_now";
  status: "pending" | "submitted" | "draft_sent" | "blotato_draft" | "scheduled" | "publishing" | "published" | "failed";
  calendarAt: string;
  scheduledFor: string;
  submittedAt?: string;
  publishedAt?: string;
  lastCheckedAt?: string;
  submissionId?: string;
  publishedUrl?: string;
  error?: string;
};

type ViewMode = "month" | "week" | "day" | "agenda";

const statusLabels: Record<CreddyCalendarEvent["status"], string> = {
  pending: "Queued",
  submitted: "Submitted",
  draft_sent: "Draft sent",
  blotato_draft: "Blotato draft",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
};

const statusStyles: Record<CreddyCalendarEvent["status"], string> = {
  pending: "border-blue-200 bg-blue-50 text-blue-800",
  submitted: "border-amber-200 bg-amber-50 text-amber-900",
  draft_sent: "border-violet-200 bg-violet-50 text-violet-900",
  blotato_draft: "border-violet-200 bg-violet-50 text-violet-900",
  scheduled: "border-blue-200 bg-blue-50 text-blue-800",
  publishing: "border-amber-200 bg-amber-50 text-amber-900",
  published: "border-emerald-200 bg-emerald-50 text-emerald-900",
  failed: "border-red-200 bg-red-50 text-red-900",
};

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date): Date {
  const result = startOfDay(date);
  result.setDate(result.getDate() - result.getDay());
  return result;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sameDay(left: Date, right: Date): boolean {
  return dateKey(left) === dateKey(right);
}

function addDays(date: Date, count: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatFull(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function PlatformIcon({ platform, className = "size-3.5" }: { platform: CreddyCalendarEvent["platform"]; className?: string }) {
  return platform === "instagram" ? <Camera className={className} /> : <span className={`${className} inline-flex items-center justify-center font-bold`}>♪</span>;
}

function StatusIcon({ status }: { status: CreddyCalendarEvent["status"] }) {
  if (status === "published") return <CheckCircle2 className="size-4 text-emerald-600" />;
  if (status === "failed") return <CircleAlert className="size-4 text-red-600" />;
  if (status === "publishing" || status === "submitted") return <LoaderCircle className="size-4 text-amber-600" />;
  if (status === "draft_sent" || status === "blotato_draft") return <Send className="size-4 text-violet-600" />;
  return <Clock3 className="size-4 text-blue-600" />;
}

export function CreddyPublishingCalendar({ events, initialDate }: { events: CreddyCalendarEvent[]; initialDate: string }) {
  const [cursor, setCursor] = useState(() => startOfDay(new Date(initialDate)));
  const [view, setView] = useState<ViewMode>("month");
  const [selected, setSelected] = useState<CreddyCalendarEvent | null>(null);
  const [platform, setPlatform] = useState<"all" | CreddyCalendarEvent["platform"]>("all");
  const [status, setStatus] = useState<"all" | CreddyCalendarEvent["status"]>("all");

  const filtered = useMemo(() => events
    .filter((event) => platform === "all" || event.platform === platform)
    .filter((event) => status === "all" || event.status === status)
    .sort((a, b) => a.calendarAt.localeCompare(b.calendarAt)), [events, platform, status]);

  const visibleDays = useMemo(() => {
    if (view === "day") return [startOfDay(cursor)];
    if (view === "week") return Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(cursor), index));
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = startOfWeek(first);
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [cursor, view]);

  const eventMap = useMemo(() => {
    const map = new Map<string, CreddyCalendarEvent[]>();
    for (const event of filtered) {
      const key = dateKey(new Date(event.calendarAt));
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return map;
  }, [filtered]);

  function move(direction: -1 | 1) {
    const next = new Date(cursor);
    if (view === "month") next.setMonth(next.getMonth() + direction);
    else if (view === "week") next.setDate(next.getDate() + direction * 7);
    else next.setDate(next.getDate() + direction);
    setCursor(startOfDay(next));
  }

  const title = view === "month"
    ? cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : view === "week"
      ? `${startOfWeek(cursor).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${addDays(startOfWeek(cursor), 6).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
      : cursor.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-4 py-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setCursor(startOfDay(new Date(initialDate)))} type="button" variant="outline">Today</Button>
            <div className="flex overflow-hidden rounded-lg border bg-card">
              <button aria-label="Previous period" className="p-2.5 hover:bg-muted" onClick={() => move(-1)} type="button"><ChevronLeft className="size-4" /></button>
              <button aria-label="Next period" className="border-l p-2.5 hover:bg-muted" onClick={() => move(1)} type="button"><ChevronRight className="size-4" /></button>
            </div>
            <h2 className="min-w-52 text-lg font-semibold tracking-tight">{title}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Filter by platform" className="h-9 rounded-lg border bg-background px-3 text-sm" onChange={(event) => setPlatform(event.target.value as typeof platform)} value={platform}>
              <option value="all">All platforms</option>
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
            </select>
            <select aria-label="Filter by status" className="h-9 rounded-lg border bg-background px-3 text-sm" onChange={(event) => setStatus(event.target.value as typeof status)} value={status}>
              <option value="all">All statuses</option>
              {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <div className="flex overflow-hidden rounded-lg border bg-card">
              {(["month", "week", "day", "agenda"] as ViewMode[]).map((mode) => (
                <button className={`border-l px-3 py-2 text-sm capitalize first:border-l-0 ${view === mode ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`} key={mode} onClick={() => setView(mode)} type="button">{mode}</button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {view === "agenda" ? (
        <AgendaList events={filtered} onSelect={setSelected} />
      ) : view === "day" ? (
        <DayList day={cursor} events={eventMap.get(dateKey(cursor)) ?? []} onSelect={setSelected} />
      ) : (
        <CalendarGrid cursor={cursor} days={visibleDays} eventMap={eventMap} monthMode={view === "month"} onSelect={setSelected} />
      )}

      {selected && <EventDetails event={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function CalendarGrid({ cursor, days, eventMap, monthMode, onSelect }: {
  cursor: Date;
  days: Date[];
  eventMap: Map<string, CreddyCalendarEvent[]>;
  monthMode: boolean;
  onSelect: (event: CreddyCalendarEvent) => void;
}) {
  const today = new Date();
  return (
    <Card className="overflow-hidden">
      <CardContent className="overflow-x-auto p-0">
        <div className="min-w-[1050px]">
          <div className="grid grid-cols-7 border-b bg-muted/35">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground" key={day}>{day}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const key = dateKey(day);
              const entries = eventMap.get(key) ?? [];
              const outside = monthMode && day.getMonth() !== cursor.getMonth();
              return (
                <div className={`min-h-36 border-b border-r p-2 last:border-r-0 ${outside ? "bg-muted/35 text-muted-foreground" : "bg-card"} ${sameDay(day, today) ? "bg-blue-50/60" : ""}`} key={key}>
                  <div className="mb-2 flex justify-end">
                    <span className={`flex size-7 items-center justify-center rounded-full text-sm font-medium ${sameDay(day, today) ? "bg-primary text-primary-foreground" : ""}`}>{day.getDate()}</span>
                  </div>
                  <div className="space-y-1.5">
                    {entries.map((event) => <CalendarEventButton event={event} key={event.key} onSelect={onSelect} />)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CalendarEventButton({ event, onSelect }: { event: CreddyCalendarEvent; onSelect: (event: CreddyCalendarEvent) => void }) {
  return (
    <button className={`w-full rounded-md border px-2 py-1.5 text-left shadow-sm transition hover:-translate-y-px hover:shadow ${statusStyles[event.status]}`} onClick={() => onSelect(event)} type="button">
      <div className="flex items-center gap-1 text-[11px] font-semibold">
        <span>{formatTime(event.calendarAt)}</span>
        <PlatformIcon platform={event.platform} />
        <span className="ml-auto rounded-full bg-white/70 px-1.5 py-0.5 uppercase tracking-wide">{statusLabels[event.status]}</span>
      </div>
      <div className="mt-1 line-clamp-2 text-xs font-medium leading-tight">{event.hook}</div>
    </button>
  );
}

function AgendaList({ events, onSelect }: { events: CreddyCalendarEvent[]; onSelect: (event: CreddyCalendarEvent) => void }) {
  if (events.length === 0) return <EmptyCalendar />;
  return <Card><CardContent className="divide-y p-0">{events.map((event) => <AgendaRow event={event} key={event.key} onSelect={onSelect} />)}</CardContent></Card>;
}

function DayList({ day, events, onSelect }: { day: Date; events: CreddyCalendarEvent[]; onSelect: (event: CreddyCalendarEvent) => void }) {
  if (events.length === 0) return <EmptyCalendar label={`No delivery activity on ${day.toLocaleDateString("en-US", { month: "long", day: "numeric" })}.`} />;
  return <Card><CardContent className="divide-y p-0">{events.map((event) => <AgendaRow event={event} key={event.key} onSelect={onSelect} />)}</CardContent></Card>;
}

function AgendaRow({ event, onSelect }: { event: CreddyCalendarEvent; onSelect: (event: CreddyCalendarEvent) => void }) {
  return (
    <button className="grid w-full gap-3 p-4 text-left transition hover:bg-muted/40 sm:grid-cols-[170px_minmax(0,1fr)_auto] sm:items-center" onClick={() => onSelect(event)} type="button">
      <div className="text-sm text-muted-foreground"><div className="font-medium text-foreground">{new Date(event.calendarAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>{formatTime(event.calendarAt)}</div>
      <div className="min-w-0"><div className="truncate font-medium">{event.hook}</div><div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><PlatformIcon platform={event.platform} />{event.platform === "instagram" ? "Instagram" : "TikTok"} · account {event.account}</div></div>
      <Badge className={statusStyles[event.status]} variant="outline">{statusLabels[event.status]}</Badge>
    </button>
  );
}

function EmptyCalendar({ label = "No scheduled or delivered Creddy posts match these filters." }: { label?: string }) {
  return <Card className="border-dashed"><CardContent className="flex min-h-52 flex-col items-center justify-center text-center"><CalendarDays className="mb-3 size-8 text-muted-foreground" /><p className="font-medium">Nothing here yet</p><p className="mt-1 text-sm text-muted-foreground">{label}</p></CardContent></Card>;
}

function EventDetails({ event, onClose }: { event: CreddyCalendarEvent; onClose: () => void }) {
  return (
    <div aria-modal="true" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" onMouseDown={(click) => { if (click.currentTarget === click.target) onClose(); }} role="dialog">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border bg-card p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0"><div className="mb-2 flex items-center gap-2"><StatusIcon status={event.status} /><Badge className={statusStyles[event.status]} variant="outline">{statusLabels[event.status]}</Badge></div><h3 className="text-xl font-semibold tracking-tight">{event.hook}</h3></div>
          <Button aria-label="Close details" onClick={onClose} size="icon" type="button" variant="ghost"><X className="size-4" /></Button>
        </div>
        <dl className="mt-5 grid gap-4 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2">
          <Detail label="Platform" value={event.platform === "instagram" ? "Instagram" : "TikTok"} />
          <Detail label="Account" value={event.account} />
          <Detail label="Delivery mode" value={event.mode === "publish_now" ? "Post now" : event.mode === "tiktok_draft" ? "TikTok draft" : "Scheduled"} />
          <Detail label="Format" value={event.format === "text_music" ? "Slideshow / text + music" : "Narrated"} />
          <Detail label="Scheduled for" value={formatFull(event.scheduledFor)} />
          {event.submittedAt && <Detail label="Submitted" value={formatFull(event.submittedAt)} />}
          {event.publishedAt && <Detail label="Published" value={formatFull(event.publishedAt)} />}
          {event.lastCheckedAt && <Detail label="Status checked" value={formatFull(event.lastCheckedAt)} />}
          {event.submissionId && <Detail label="Submission ID" mono value={event.submissionId} />}
        </dl>
        {event.error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><strong>Delivery error:</strong> {event.error}</div>}
        <div className="mt-5 flex flex-wrap gap-2">
          {event.publishedUrl && <a className={cn(buttonVariants())} href={event.publishedUrl} rel="noreferrer" target="_blank">Open published post <ExternalLink className="size-4" /></a>}
          <Button onClick={onClose} type="button" variant="outline">Close</Button>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0"><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt><dd className={`mt-1 break-words text-sm ${mono ? "font-mono text-xs" : ""}`}>{value}</dd></div>;
}
