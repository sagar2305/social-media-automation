/**
 * Calendar / Gantt-style view of campaigns.
 *
 * Each campaign with a start AND end date renders as a horizontal bar on
 * a shared time axis. Campaigns with no dates fall into a "No timeline"
 * footer list. Today is marked with a vertical guide line so the
 * "where am I in this campaign" answer is one glance away.
 *
 * Time range = min(start_date) − 7d  to  max(end_date) + 7d, clamped to
 * a minimum 60-day visible window so a single short campaign doesn't
 * collapse to a sliver.
 */

import Link from "next/link";
import Image from "next/image";
import type { CampaignSummary } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Image as ImageIcon } from "lucide-react";

const DAY_MS = 86_400_000;

function statusBarClass(status: CampaignSummary["status"]): string {
  switch (status) {
    case "active":
      return "bg-[#16a34a] hover:bg-[#16a34a]/90";
    case "paused":
      return "bg-[#bf4800] hover:bg-[#bf4800]/90";
    case "archived":
      return "bg-muted-foreground/40 hover:bg-muted-foreground/50";
  }
}

function formatMonth(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Position on the timeline as a 0-1 fraction. */
function fraction(d: Date, startMs: number, totalMs: number): number {
  return Math.max(0, Math.min(1, (d.getTime() - startMs) / totalMs));
}

export function CampaignCalendar({ campaigns }: { campaigns: CampaignSummary[] }) {
  const dated = campaigns.filter((c) => c.start_date && c.end_date);
  const undated = campaigns.filter((c) => !c.start_date || !c.end_date);

  if (dated.length === 0) {
    return (
      <div className="space-y-4">
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <p className="text-base font-medium mb-1">No timelines yet</p>
            <p className="text-sm text-muted-foreground">
              Add a Start and End date to a campaign to see it on the calendar.
            </p>
          </CardContent>
        </Card>
        {undated.length > 0 && (
          <UndatedSection campaigns={undated} />
        )}
      </div>
    );
  }

  // Compute axis range: min start − 7d, max end + 7d, with a 60-day floor.
  const minStartMs = Math.min(
    ...dated.map((c) => new Date(c.start_date!).getTime()),
  );
  const maxEndMs = Math.max(
    ...dated.map((c) => new Date(c.end_date!).getTime()),
  );
  const padding = 7 * DAY_MS;
  let axisStartMs = minStartMs - padding;
  let axisEndMs = maxEndMs + padding;
  const floorMs = 60 * DAY_MS;
  if (axisEndMs - axisStartMs < floorMs) {
    const center = (axisStartMs + axisEndMs) / 2;
    axisStartMs = center - floorMs / 2;
    axisEndMs = center + floorMs / 2;
  }
  const totalMs = axisEndMs - axisStartMs;

  // Build month tick marks across the axis.
  const ticks: { date: Date; left: number }[] = [];
  const cursor = new Date(axisStartMs);
  cursor.setDate(1);
  if (cursor.getTime() < axisStartMs) cursor.setMonth(cursor.getMonth() + 1);
  while (cursor.getTime() <= axisEndMs) {
    ticks.push({
      date: new Date(cursor),
      left: fraction(cursor, axisStartMs, totalMs) * 100,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  // Today marker (only if it falls within the visible range)
  const now = new Date();
  const showToday = now.getTime() >= axisStartMs && now.getTime() <= axisEndMs;
  const todayLeft = showToday ? fraction(now, axisStartMs, totalMs) * 100 : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 pb-2">
          {/* Axis */}
          <div className="relative h-6 mb-2 select-none">
            {ticks.map((t, i) => (
              <div
                key={i}
                className="absolute top-0 h-full flex flex-col items-center"
                style={{ left: `${t.left}%`, transform: "translateX(-50%)" }}
              >
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {formatMonth(t.date)}
                </span>
                <span className="block w-px h-2 bg-border mt-0.5" />
              </div>
            ))}
            {showToday && (
              <div
                className="absolute top-0 h-full"
                style={{ left: `${todayLeft}%`, transform: "translateX(-50%)" }}
              >
                <span className="block w-0.5 h-full bg-primary" />
              </div>
            )}
          </div>

          {/* Rows */}
          <div className="space-y-1.5">
            {dated.map((c) => {
              const startMs = new Date(c.start_date!).getTime();
              const endMs = new Date(c.end_date!).getTime();
              const left = fraction(new Date(startMs), axisStartMs, totalMs) * 100;
              const right = fraction(new Date(endMs), axisStartMs, totalMs) * 100;
              const width = Math.max(1, right - left); // minimum 1% width so single-day campaigns are still clickable

              const progress = c.posts_target_total > 0
                ? Math.min(100, (c.posts_count / c.posts_target_total) * 100)
                : null;

              return (
                <Link
                  key={c.id}
                  href={`/campaigns/${c.slug}`}
                  className="group relative grid grid-cols-[200px_1fr] gap-3 items-center py-1.5 hover:bg-muted/40 rounded-lg px-2 -mx-2 transition-colors"
                >
                  {/* Left label cell */}
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="relative h-7 w-7 rounded-md bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                      {c.image_url ? (
                        <Image
                          src={c.image_url}
                          alt={c.name}
                          fill
                          className="object-cover"
                          sizes="28px"
                        />
                      ) : (
                        <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/50" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                        {c.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        {formatDate(new Date(startMs))} → {formatDate(new Date(endMs))}
                      </p>
                    </div>
                  </div>

                  {/* Bar lane */}
                  <div className="relative h-6">
                    {/* Today guide repeats per row so it's visible behind every bar */}
                    {showToday && (
                      <div
                        className="absolute top-0 h-full w-px bg-primary/30"
                        style={{ left: `${todayLeft}%` }}
                      />
                    )}
                    {/* The bar itself */}
                    <div
                      className={`absolute top-1 h-4 rounded-sm transition-colors ${statusBarClass(c.status)}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${c.posts_count}/${c.posts_target_total} posts · ${c.status}`}
                    >
                      {progress !== null && progress > 0 && (
                        <div
                          className="absolute top-0 left-0 h-full bg-white/30 rounded-sm"
                          style={{ width: `${progress}%` }}
                        />
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border/60 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-sm bg-[#16a34a]" />
              Active
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-sm bg-[#bf4800]" />
              Paused
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-sm bg-muted-foreground/40" />
              Archived
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-3 bg-white/30 rounded-sm border border-border" />
              = posts progress
            </span>
            {showToday && (
              <span className="inline-flex items-center gap-1.5 ml-auto">
                <span className="block w-0.5 h-3 bg-primary" />
                Today
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {undated.length > 0 && <UndatedSection campaigns={undated} />}
    </div>
  );
}

function UndatedSection({ campaigns }: { campaigns: CampaignSummary[] }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-sm font-medium mb-3">No timeline set</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {campaigns.map((c) => (
            <Link
              key={c.id}
              href={`/campaigns/${c.slug}`}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
            >
              <div className="relative h-7 w-7 rounded-md bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                {c.image_url ? (
                  <Image src={c.image_url} alt={c.name} fill className="object-cover" sizes="28px" />
                ) : (
                  <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/50" />
                )}
              </div>
              <span className="text-sm truncate">{c.name}</span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
