"use client";

import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronDown, ChevronRight } from "lucide-react";

export interface AutoFixEvent {
  id: number;
  occurred_at: string;
  source: string;
  tier: string;
  status: number | null;
  signature: string;
  message: string | null;
  action: string | null;
  handled: string;
  resolution: string | null;
  fix_description: string | null;
  verify_duration_ms: number | null;
}

const TIER_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  RETRY: "secondary",
  "AUTO-FIX": "default",
  PROPOSE: "outline",
  ASK: "outline",
  "HUMAN-ONLY": "destructive",
  UNKNOWN: "outline",
};

const HANDLED_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  "auto-fixed": "default",
  retried: "secondary",
  proposed: "outline",
  pending: "outline",
  escalated: "destructive",
  "gave-up": "destructive",
};

const HANDLED_EXPLAIN: Record<string, string> = {
  "auto-fixed":
    "The auto-fixer applied a config/string change, ran TypeScript verify, and the change stuck.",
  retried: "The system backed off and retried the request — the retry succeeded.",
  proposed:
    "A small code change was staged on a branch. Run `npx tsx scripts/auto_fix_proposals.ts list` to review.",
  pending: "Waiting on the next cycle to handle this, or no fix was attempted.",
  escalated:
    "The system stopped because it cannot fix this autonomously (billing cap, banned account, persistent outage). Notify sent if SLACK_ALERT_WEBHOOK is set.",
  "gave-up":
    "The auto-fixer tried but verify failed and the change was rolled back.",
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const ms = now - d.getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toISOString().slice(0, 10);
}

function fmtAbsolute(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ErrorsTable({ events }: { events: AutoFixEvent[] }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        No errors recorded yet. The system will log here when API calls fail
        or the auto-fixer runs.
      </p>
    );
  }

  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[32px]" />
          <TableHead className="w-[100px]">When</TableHead>
          <TableHead className="w-[110px]">Source</TableHead>
          <TableHead className="w-[120px]">Tier</TableHead>
          <TableHead className="w-[70px]">HTTP</TableHead>
          <TableHead className="w-[260px]">What happened</TableHead>
          <TableHead>How to solve / what was done</TableHead>
          <TableHead className="w-[110px]">Result</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((e) => {
          const isOpen = expanded.has(e.id);
          return (
            <Fragment key={e.id}>
              <TableRow
                onClick={() => toggle(e.id)}
                className="cursor-pointer"
                aria-expanded={isOpen}
              >
                <TableCell className="text-muted-foreground">
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </TableCell>
                <TableCell
                  className="text-xs text-muted-foreground tabular-nums"
                  title={e.occurred_at}
                >
                  {fmtTime(e.occurred_at)}
                </TableCell>
                <TableCell className="text-sm font-medium">
                  {e.source}
                </TableCell>
                <TableCell>
                  <Badge variant={TIER_VARIANT[e.tier] ?? "outline"}>
                    {e.tier}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs tabular-nums text-muted-foreground">
                  {e.status ?? "—"}
                </TableCell>
                <TableCell className="font-mono text-xs whitespace-normal break-all">
                  {e.signature}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground whitespace-normal break-words">
                  {e.action || "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={HANDLED_VARIANT[e.handled] ?? "outline"}>
                    {e.handled}
                  </Badge>
                </TableCell>
              </TableRow>

              {isOpen && (
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableCell />
                  <TableCell colSpan={7} className="whitespace-normal py-4">
                    <div className="space-y-4 max-w-4xl">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wide mb-1">
                            When
                          </p>
                          <p className="tabular-nums">{fmtAbsolute(e.occurred_at)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wide mb-1">
                            Source
                          </p>
                          <p className="font-medium">{e.source}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wide mb-1">
                            Tier
                          </p>
                          <Badge variant={TIER_VARIANT[e.tier] ?? "outline"}>
                            {e.tier}
                          </Badge>
                        </div>
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wide mb-1">
                            HTTP Status
                          </p>
                          <p className="tabular-nums">{e.status ?? "—"}</p>
                        </div>
                      </div>

                      <div>
                        <p className="text-muted-foreground uppercase tracking-wide text-xs mb-1">
                          Error signature
                        </p>
                        <code className="block bg-background border border-border/40 rounded p-2 text-xs font-mono break-all">
                          {e.signature}
                        </code>
                      </div>

                      {e.message && (
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wide text-xs mb-1">
                            Raw message
                          </p>
                          <code className="block bg-background border border-border/40 rounded p-2 text-xs font-mono whitespace-pre-wrap break-words max-h-48 overflow-auto">
                            {e.message}
                          </code>
                        </div>
                      )}

                      <div>
                        <p className="text-muted-foreground uppercase tracking-wide text-xs mb-1">
                          Suggested fix (from catalog)
                        </p>
                        <p className="text-sm">
                          {e.action || "No catalog action — this error is unclassified."}
                        </p>
                      </div>

                      {e.fix_description && (
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wide text-xs mb-1">
                            What Claude / the auto-fixer did
                          </p>
                          <p className="text-sm">{e.fix_description}</p>
                          {e.verify_duration_ms != null && (
                            <p className="text-xs text-muted-foreground mt-1">
                              TS verify took {e.verify_duration_ms}ms
                            </p>
                          )}
                        </div>
                      )}

                      <div>
                        <p className="text-muted-foreground uppercase tracking-wide text-xs mb-1">
                          Result
                        </p>
                        <div className="flex items-start gap-3">
                          <Badge variant={HANDLED_VARIANT[e.handled] ?? "outline"}>
                            {e.handled}
                          </Badge>
                          <p className="text-sm text-muted-foreground flex-1">
                            {HANDLED_EXPLAIN[e.handled] ?? "Status unknown."}
                          </p>
                        </div>
                      </div>

                      {e.resolution && (
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wide text-xs mb-1">
                            Resolution notes
                          </p>
                          <p className="text-sm">{e.resolution}</p>
                        </div>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
