/**
 * Card grid presentation of campaigns. Extracted from page.tsx so the
 * calendar view can live alongside it and the page just picks one to
 * render based on `?view=`.
 */

import Link from "next/link";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { Image as ImageIcon, Eye, Heart, Bookmark } from "lucide-react";
import type { Campaign, CampaignSummary } from "@/lib/types";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function StatusPill({ status }: { status: Campaign["status"] }) {
  const styles: Record<Campaign["status"], string> = {
    active: "bg-[#16a34a]/10 text-[#16a34a]",
    paused: "bg-[#bf4800]/10 text-[#bf4800]",
    archived: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}

export function CampaignCards({ campaigns }: { campaigns: CampaignSummary[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {campaigns.map((c) => {
        const progress = c.posts_target_total > 0
          ? Math.min(100, (c.posts_count / c.posts_target_total) * 100)
          : null;

        return (
          <Link key={c.id} href={`/campaigns/${c.slug}`} className="group block">
            <Card className="overflow-hidden hover:ring-2 hover:ring-primary/30 transition-all">
              <div className="relative h-32 bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
                {c.image_url ? (
                  <Image
                    src={c.image_url}
                    alt={c.name}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 100vw, 33vw"
                  />
                ) : (
                  <ImageIcon className="h-10 w-10 text-muted-foreground/40" />
                )}
              </div>

              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold truncate group-hover:text-primary transition-colors">
                      {c.name}
                    </h3>
                    <p className="text-xs text-muted-foreground font-mono">{c.slug}</p>
                  </div>
                  <StatusPill status={c.status} />
                </div>

                {progress !== null ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {c.posts_count}/{c.posts_target_total} posts
                      </span>
                      <span className="font-medium tabular-nums">
                        {progress.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{c.posts_count} posts</p>
                )}

                <div className="flex items-center gap-4 text-xs pt-2 border-t border-border/60">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Eye className="h-3 w-3" />
                    <span className="tabular-nums font-medium text-foreground">
                      {formatNumber(c.total_views)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Heart className="h-3 w-3" />
                    <span className="tabular-nums font-medium text-foreground">
                      {formatNumber(c.total_likes)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Bookmark className="h-3 w-3" />
                    <span className="tabular-nums font-medium text-foreground">
                      {c.avg_save_rate.toFixed(2)}%
                    </span>
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/60">
                  <span>
                    {c.account_count} account{c.account_count === 1 ? "" : "s"}
                  </span>
                  {c.days_left !== null && (
                    <span className="font-medium">
                      {c.days_left === 0
                        ? "Ends today"
                        : c.days_left === 1
                          ? "1 day left"
                          : `${c.days_left} days left`}
                    </span>
                  )}
                  {c.days_left === null && c.start_date === null && (
                    <span className="italic">No end date</span>
                  )}
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
