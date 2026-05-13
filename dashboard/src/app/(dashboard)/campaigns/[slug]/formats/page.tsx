/**
 * /campaigns/[slug]/formats — format rankings scoped to one campaign.
 *
 * Mirrors the global /formats page with a campaign_id filter so each
 * campaign learns its own winning hook styles. The optimizer (Phase 3
 * pipeline rewire) writes per-campaign rankings via dataPath().
 */

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ExportButton } from "@/components/export-button";
import { FormatChart } from "@/components/format-chart";
import type { Campaign, FormatRanking } from "@/lib/types";

export const revalidate = 120;

export default async function CampaignFormatsPage({
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

  const { data: rankings } = await sb
    .from("format_rankings")
    .select("*")
    .eq("campaign_id", campaign.id)
    .order("rank", { ascending: true });

  const all: FormatRanking[] = (rankings ?? []) as FormatRanking[];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {all.length} ranked format{all.length === 1 ? "" : "s"} — sorted by avg views
        </p>
        <ExportButton
          data={all.map((f) => ({
            rank: f.rank,
            hook_style: f.hook_style,
            avg_views: Number(f.avg_views).toFixed(0),
            avg_save_rate: f.avg_save_rate,
            post_count: f.post_count,
            last_used: f.last_used ?? "",
          }))}
          filename={`${campaign.slug}-formats`}
        />
      </div>

      {all.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <p className="text-base font-medium mb-1">No format rankings yet</p>
            <p className="text-sm text-muted-foreground">
              The optimizer ranks hook styles once enough posts accumulate
              for this campaign. Run a few cycles, then check back.
            </p>
          </CardContent>
        </Card>
      )}

      {all.length > 0 && (
        <>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm font-medium text-muted-foreground mb-3">
                Avg save rate by hook style
              </p>
              <FormatChart data={all} />
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rank</TableHead>
                    <TableHead>Hook style</TableHead>
                    <TableHead className="text-right">Avg views</TableHead>
                    <TableHead className="text-right">Avg save %</TableHead>
                    <TableHead className="text-right">Posts</TableHead>
                    <TableHead>Last used</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {all.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell>
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent text-sm font-bold text-primary">
                          {f.rank}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium">{f.hook_style}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(f.avg_views).toFixed(0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {f.avg_save_rate}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {f.post_count}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        {f.last_used ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
