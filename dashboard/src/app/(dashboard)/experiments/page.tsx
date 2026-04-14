import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { ExportButton } from "@/components/export-button";
import { ExperimentsFilter } from "./experiments-filter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const revalidate = 300;

export default async function ExperimentsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const { account: filterAccount } = await searchParams;
  const supabase = await createClient();
  const { data: experiments } = await supabase
    .from("experiments")
    .select("*")
    .order("date", { ascending: false });

  const allExperiments = experiments ?? [];

  // Get unique individual accounts for filter (split comma-separated values)
  const accounts = Array.from(
    new Set(
      allExperiments
        .flatMap((e) =>
          e.account
            ? e.account.split(",").map((a: string) => a.trim())
            : []
        )
        .filter(Boolean)
    )
  ).sort() as string[];

  // Apply filter — match if any of the experiment's accounts contains the filter
  const filtered = filterAccount
    ? allExperiments.filter((e) =>
        e.account
          ?.split(",")
          .map((a: string) => a.trim())
          .includes(filterAccount)
      )
    : allExperiments;

  const winners = filtered.filter((e) =>
    e.status?.toLowerCase().includes("winner")
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Experiments</h1>
          <p className="text-muted-foreground mt-1">
            A/B test history and results — per account.
          </p>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex gap-6 tabular-nums">
            <div className="text-right">
              <p className="text-2xl font-semibold">{filtered.length}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-semibold text-[#248a3d]">
                {winners}
              </p>
              <p className="text-xs text-muted-foreground">Winners</p>
            </div>
          </div>
          <ExportButton
            data={filtered.map((e) => ({
              id: e.id,
              date: e.date,
              account: e.account ?? "",
              variable: e.variable,
              variant_a: e.variant_a,
              variant_b: e.variant_b,
              views_a: e.views_a,
              views_b: e.views_b,
              saves_a: e.saves_a,
              saves_b: e.saves_b,
              save_rate_a: e.save_rate_a,
              save_rate_b: e.save_rate_b,
              status: e.status,
              winner: e.winner,
            }))}
            filename="experiments"
          />
        </div>
      </div>

      <ExperimentsFilter accounts={accounts} selected={filterAccount ?? null} />

      {filtered.length === 0 && (
        <p className="text-muted-foreground">No experiments yet.</p>
      )}

      {filtered.length > 0 && (
        <Card className="shadow-sm border-0 ring-0">
          <CardContent className="pt-4 pb-2">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">ID</TableHead>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Account</TableHead>
                    <TableHead className="text-xs">Variable</TableHead>
                    <TableHead className="text-xs">Variant A</TableHead>
                    <TableHead className="text-xs">Variant B</TableHead>
                    <TableHead className="text-xs text-right">
                      Views A
                    </TableHead>
                    <TableHead className="text-xs text-right">
                      Views B
                    </TableHead>
                    <TableHead className="text-xs text-right">
                      Saves A
                    </TableHead>
                    <TableHead className="text-xs text-right">
                      Saves B
                    </TableHead>
                    <TableHead className="text-xs text-right">
                      Save% A
                    </TableHead>
                    <TableHead className="text-xs text-right">
                      Save% B
                    </TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((exp) => {
                    const isWinner = exp.status
                      ?.toLowerCase()
                      .includes("winner");
                    const isInconclusive = exp.status
                      ?.toLowerCase()
                      .includes("inconclusive");
                    const isCrossAccount = exp.account?.includes(",");

                    return (
                      <TableRow key={exp.id}>
                        <TableCell className="text-xs font-mono font-medium">
                          {exp.id}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {exp.date}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex flex-wrap gap-1">
                            {exp.account
                              ?.split(",")
                              .map((a: string) => (
                                <span
                                  key={a.trim()}
                                  className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-500 whitespace-nowrap"
                                >
                                  @{a.trim()}
                                </span>
                              ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {exp.variable}
                        </TableCell>
                        <TableCell
                          className="text-xs max-w-[140px] truncate"
                          title={exp.variant_a}
                        >
                          {exp.variant_a}
                        </TableCell>
                        <TableCell
                          className="text-xs max-w-[140px] truncate"
                          title={exp.variant_b}
                        >
                          {exp.variant_b}
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {exp.views_a?.toLocaleString() || 0}
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {exp.views_b?.toLocaleString() || 0}
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {exp.saves_a || 0}
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {exp.saves_b || 0}
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {exp.save_rate_a || 0}%
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {exp.save_rate_b || 0}%
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {isCrossAccount && (
                              <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-red-500/10 text-red-500">
                                Cross
                              </span>
                            )}
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${
                                isWinner
                                  ? "bg-[#248a3d]/10 text-[#248a3d]"
                                  : isInconclusive
                                    ? "bg-[#bf4800]/10 text-[#bf4800]"
                                    : "bg-[#16a34a]/10 text-[#16a34a]"
                              }`}
                            >
                              {isWinner
                                ? `Winner ${exp.winner || ""}`
                                : isInconclusive
                                  ? "Inconclusive"
                                  : "Active"}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
