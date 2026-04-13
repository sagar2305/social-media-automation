import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { ExportButton } from "@/components/export-button";
import { ExperimentsFilter } from "./experiments-filter";

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
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-5xl font-semibold tracking-tight">
            Experiments
          </h1>
          <p className="text-lg text-muted-foreground mt-2">
            A/B test history and results — per account.
          </p>
        </div>
        <div className="flex items-center gap-4">
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
        <div className="flex gap-8 tabular-nums">
          <div className="text-right">
            <p className="text-3xl font-semibold">{filtered.length}</p>
            <p className="text-sm text-muted-foreground">Total</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-semibold text-[#248a3d]">{winners}</p>
            <p className="text-sm text-muted-foreground">Winners</p>
          </div>
        </div>
      </div>

      <ExperimentsFilter accounts={accounts} selected={filterAccount ?? null} />

      {filtered.length === 0 && (
        <p className="text-lg text-muted-foreground">No experiments yet.</p>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {filtered.map((exp) => {
          const isWinner = exp.status?.toLowerCase().includes("winner");
          const isInconclusive = exp.status
            ?.toLowerCase()
            .includes("inconclusive");
          const isCrossAccount =
            exp.account?.includes(",") ||
            exp.description?.toLowerCase().includes("cross-account");

          return (
            <Card key={exp.id}>
              <CardContent className="pt-6 space-y-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-base font-semibold">#{exp.id}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {exp.date}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {exp.account &&
                      exp.account.split(",").map((a: string) => (
                        <span
                          key={a.trim()}
                          className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium bg-blue-500/10 text-blue-500"
                        >
                          @{a.trim()}
                        </span>
                      ))}
                    {isCrossAccount && (
                      <span className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium bg-red-500/10 text-red-500">
                        Cross-Account
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
                        isWinner
                          ? "bg-[#248a3d]/10 text-[#248a3d]"
                          : isInconclusive
                            ? "bg-[#bf4800]/10 text-[#bf4800]"
                            : "bg-[#16a34a]/10 text-[#16a34a]"
                      }`}
                    >
                      {isWinner
                        ? "Winner"
                        : isInconclusive
                          ? "Inconclusive"
                          : "Active"}
                    </span>
                  </div>
                </div>

                {exp.description && (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {exp.description}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <VariantCard
                    label="Variant A"
                    value={exp.variant_a}
                    views={exp.views_a}
                    saves={exp.saves_a}
                    saveRate={exp.save_rate_a}
                    isWinner={exp.winner === "A"}
                  />
                  <VariantCard
                    label="Variant B"
                    value={exp.variant_b}
                    views={exp.views_b}
                    saves={exp.saves_b}
                    saveRate={exp.save_rate_b}
                    isWinner={exp.winner === "B"}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function VariantCard({
  label,
  value,
  views,
  saves,
  saveRate,
  isWinner,
}: {
  label: string;
  value: string;
  views: number;
  saves: number;
  saveRate: number;
  isWinner: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-4 ${
        isWinner
          ? "bg-[#248a3d]/5 ring-1 ring-[#248a3d]/15"
          : "bg-secondary/60"
      }`}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
          {label}
        </span>
        {isWinner && (
          <span className="text-xs font-semibold text-[#248a3d]">Winner</span>
        )}
      </div>
      <p className="text-sm font-medium line-clamp-2 mb-3">{value}</p>
      <div className="space-y-1.5 tabular-nums">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Views</span>
          <span className="font-semibold">{views}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Saves</span>
          <span className="font-semibold">{saves}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Save Rate</span>
          <span className="font-semibold">{saveRate}%</span>
        </div>
      </div>
    </div>
  );
}
