import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const revalidate = 60;

interface AutoFixEvent {
  id: number;
  occurred_at: string;
  source: string;
  tier: string;
  status: number | null;
  signature: string;
  action: string | null;
  handled: string;
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

export default async function ErrorsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; tier?: string; handled?: string }>;
}) {
  const { source, tier, handled } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("auto_fix_events")
    .select("*")
    .order("occurred_at", { ascending: false })
    .limit(500);

  if (source) query = query.eq("source", source);
  if (tier) query = query.eq("tier", tier);
  if (handled) query = query.eq("handled", handled);

  const { data: events } = await query;
  const all = (events ?? []) as AutoFixEvent[];

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const last24h = all.filter((e) => new Date(e.occurred_at).getTime() >= dayAgo);
  const pending = all.filter((e) => e.handled === "pending").length;
  const autoFixed = all.filter((e) => e.handled === "auto-fixed").length;
  const escalated = all.filter(
    (e) => e.handled === "escalated" || e.handled === "gave-up"
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Errors & Auto-Fix</h1>
          <p className="text-muted-foreground mt-1">
            Live feed of API errors, what the auto-fixer tried, and how it
            was resolved.
          </p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Last 24h
            </p>
            <p className="text-3xl font-semibold tabular-nums mt-1">
              {last24h.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Auto-fixed
            </p>
            <p className="text-3xl font-semibold tabular-nums mt-1 text-[#248a3d]">
              {autoFixed}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Pending
            </p>
            <p className="text-3xl font-semibold tabular-nums mt-1">
              {pending}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Needs you
            </p>
            <p className="text-3xl font-semibold tabular-nums mt-1 text-destructive">
              {escalated}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recent events table */}
      <Card>
        <CardContent className="pt-6">
          {all.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">
              No errors recorded yet. The system will log here when API calls
              fail or the auto-fixer runs.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">When</TableHead>
                  <TableHead className="w-[110px]">Source</TableHead>
                  <TableHead className="w-[110px]">Tier</TableHead>
                  <TableHead className="w-[80px]">HTTP</TableHead>
                  <TableHead>What happened</TableHead>
                  <TableHead>How to solve / what was done</TableHead>
                  <TableHead className="w-[110px]">Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {all.map((e) => (
                  <TableRow key={e.id}>
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
                    <TableCell className="text-sm font-mono text-xs">
                      {e.signature}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-md">
                      {e.action || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={HANDLED_VARIANT[e.handled] ?? "outline"}>
                        {e.handled}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Data refreshes every 60s. Source: <code>data/auto-fix-log.md</code> via{" "}
        <code>npm run refresh</code>.
      </p>
    </div>
  );
}
