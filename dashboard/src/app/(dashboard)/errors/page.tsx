import { createClient } from "@/lib/supabase";
import { getUser } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorsTable, type AutoFixEvent } from "./errors-table";

export const revalidate = 60;

export default async function ErrorsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; tier?: string; handled?: string }>;
}) {
  const { source, tier, handled } = await searchParams;
  const user = await getUser();
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

  // Closed: anything where handling is complete — auto-fixed, manually resolved
  // by an admin, or RETRY-tier events (handled inline in api-client).
  const isClosed = (e: AutoFixEvent) =>
    e.handled === "auto-fixed" ||
    e.handled === "resolved" ||
    (e.tier === "RETRY" && e.handled === "pending");

  // Open: any non-closed event. These are the rows that legitimately need
  // attention or a follow-up. The detail panel offers a Mark Resolved button
  // for admin events (HUMAN-ONLY escalated, gave-up, plain pending non-retry).
  const open = all.filter((e) => !isClosed(e));
  const closed = all.filter(isClosed);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Errors & Auto-Fix</h1>
          <p className="text-muted-foreground mt-1">
            Live feed of API errors, what the auto-fixer tried, and how it was
            resolved. Click any row to expand. Admins can mark a row resolved
            once the underlying issue is fixed.
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
            <p className="text-[11px] text-muted-foreground mt-0.5">events recorded</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Closed
            </p>
            <p className="text-3xl font-semibold tabular-nums mt-1 text-[#248a3d]">
              {closed.length}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              auto-fixed, auto-retried, or marked resolved
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Open
            </p>
            <p className={`text-3xl font-semibold tabular-nums mt-1 ${open.length === 0 ? "text-[#248a3d]" : "text-destructive"}`}>
              {open.length}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {open.length === 0 ? "all clear" : "click rows to resolve"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Total tracked
            </p>
            <p className="text-3xl font-semibold tabular-nums mt-1">
              {all.length}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">all-time event count</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent events table */}
      <Card>
        <CardContent className="pt-6">
          <ErrorsTable events={all} isAdmin={user?.role === "admin"} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Data refreshes every 60s. Source: <code>data/auto-fix-log.md</code> via{" "}
        <code>npm run refresh</code>.
      </p>
    </div>
  );
}
