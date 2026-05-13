/**
 * /campaigns/[slug]/experiments — A/B test history scoped to one campaign.
 *
 * Mirrors the global /experiments page; filtered by campaign_id so each
 * campaign's autoresearch loop can be inspected independently.
 */

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { ExportButton } from "@/components/export-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Campaign } from "@/lib/types";

export const revalidate = 120;

interface ExperimentRow {
  id: string;
  date: string | null;
  account: string | null;
  variable: string | null;
  variant_a: string | null;
  variant_b: string | null;
  views_a: number | null;
  views_b: number | null;
  saves_a: number | null;
  saves_b: number | null;
  save_rate_a: number | null;
  save_rate_b: number | null;
  status: string | null;
  winner: string | null;
}

export default async function CampaignExperimentsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sb = await createClient();
  const { data: campaign } = await sb
    .from("campaigns")
    .select("id, slug, name")
    .eq("slug", slug)
    .maybeSingle<Pick<Campaign, "id" | "slug" | "name">>();
  if (!campaign) notFound();

  const { data: experimentsData } = await sb
    .from("experiments")
    .select("*")
    .eq("campaign_id", campaign.id)
    .order("date", { ascending: false });

  const experiments: ExperimentRow[] = (experimentsData ?? []) as ExperimentRow[];
  const winners = experiments.filter((e) =>
    e.status?.toLowerCase().includes("winner"),
  ).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {experiments.length} experiment{experiments.length === 1 ? "" : "s"} ·{" "}
          <span className="text-[#248a3d] font-medium">{winners} winners</span>
        </p>
        <ExportButton
          data={experiments.map((e) => ({
            id: e.id,
            date: e.date ?? "",
            account: e.account ?? "",
            variable: e.variable ?? "",
            variant_a: e.variant_a ?? "",
            variant_b: e.variant_b ?? "",
            views_a: e.views_a ?? 0,
            views_b: e.views_b ?? 0,
            saves_a: e.saves_a ?? 0,
            saves_b: e.saves_b ?? 0,
            save_rate_a: e.save_rate_a ?? 0,
            save_rate_b: e.save_rate_b ?? 0,
            status: e.status ?? "",
            winner: e.winner ?? "",
          }))}
          filename={`${campaign.slug}-experiments`}
        />
      </div>

      {experiments.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <p className="text-base font-medium mb-1">No experiments yet</p>
            <p className="text-sm text-muted-foreground">
              Autoresearch will design A/B tests here once enough posts have
              accumulated for this campaign.
            </p>
          </CardContent>
        </Card>
      )}

      {experiments.length > 0 && (
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
                    <TableHead className="text-xs text-right">Views A</TableHead>
                    <TableHead className="text-xs text-right">Views B</TableHead>
                    <TableHead className="text-xs text-right">Save% A</TableHead>
                    <TableHead className="text-xs text-right">Save% B</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {experiments.map((exp) => {
                    const isWinner = exp.status?.toLowerCase().includes("winner");
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
                          {exp.date ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex flex-wrap gap-1">
                            {exp.account
                              ?.split(",")
                              .map((a) => (
                                <span
                                  key={a.trim()}
                                  className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-500 whitespace-nowrap"
                                >
                                  @{a.trim()}
                                </span>
                              ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">{exp.variable ?? "—"}</TableCell>
                        <TableCell
                          className="text-xs max-w-[140px] truncate"
                          title={exp.variant_a ?? undefined}
                        >
                          {exp.variant_a ?? "—"}
                        </TableCell>
                        <TableCell
                          className="text-xs max-w-[140px] truncate"
                          title={exp.variant_b ?? undefined}
                        >
                          {exp.variant_b ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {exp.views_a?.toLocaleString() ?? 0}
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {exp.views_b?.toLocaleString() ?? 0}
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {exp.save_rate_a ?? 0}%
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {exp.save_rate_b ?? 0}%
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
                                ? `Winner ${exp.winner ?? ""}`
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
