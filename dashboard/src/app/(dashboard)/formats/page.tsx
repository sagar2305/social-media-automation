import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { FormatChart } from "@/components/format-chart";
import { ExportButton } from "@/components/export-button";

export const revalidate = 300;

export default async function FormatsPage() {
  const supabase = await createClient();
  const { data: rankings } = await supabase
    .from("format_rankings")
    .select("*")
    .order("rank", { ascending: true });

  const allRankings = rankings ?? [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-5xl font-semibold tracking-tight">
            Format Rankings
          </h1>
          <p className="text-lg text-muted-foreground mt-2">
            Hook style performance ranked by average views.
          </p>
        </div>
        <ExportButton
          data={allRankings.map((f) => ({
            rank: f.rank,
            hook_style: f.hook_style,
            avg_views: Number(f.avg_views).toFixed(0),
            avg_save_rate: f.avg_save_rate,
            post_count: f.post_count,
            last_used: f.last_used,
          }))}
          filename="format-rankings"
          columns={[
            { key: "rank", label: "Rank" },
            { key: "hook_style", label: "Hook Style" },
            { key: "avg_views", label: "Avg Views" },
            { key: "avg_save_rate", label: "Avg Save %" },
            { key: "post_count", label: "Posts" },
            { key: "last_used", label: "Last Used" },
          ]}
        />
      </div>

      {allRankings.length === 0 && (
        <p className="text-lg text-muted-foreground">No format data yet.</p>
      )}

      {allRankings.length > 0 && (
        <>
          <Card>
            <CardContent className="pt-6">
              <FormatChart data={allRankings} />
            </CardContent>
          </Card>

          <div className="grid gap-5 md:grid-cols-2">
            {allRankings.map((f) => (
              <Link key={f.id} href="/posts">
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-4 mb-6">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-base font-semibold">
                        {f.rank}
                      </span>
                      <span className="text-lg font-semibold">
                        {f.hook_style}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-3xl font-semibold tabular-nums">
                          {Number(f.avg_views).toFixed(0)}
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Avg Views
                        </p>
                      </div>
                      <div>
                        <p className="text-3xl font-semibold tabular-nums">
                          {f.avg_save_rate}%
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Save Rate
                        </p>
                      </div>
                      <div>
                        <p className="text-3xl font-semibold tabular-nums">
                          {f.post_count}
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Posts
                        </p>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mt-5 pt-4 border-t border-border/50">
                      Last used {f.last_used || "N/A"}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
