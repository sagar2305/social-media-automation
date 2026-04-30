import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorsTable, type AutoFixEvent } from "./errors-table";

export const revalidate = 60;

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
            was resolved. Click a row to expand.
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
          <ErrorsTable events={all} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Data refreshes every 60s. Source: <code>data/auto-fix-log.md</code> via{" "}
        <code>npm run refresh</code>.
      </p>
    </div>
  );
}
