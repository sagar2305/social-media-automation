"use client";

import { Card, CardContent } from "@/components/ui/card";

interface AccountStat {
  account: string;
  followers: number;
  total_likes: number;
  views: number;
  videos: number;
}

export function AccountCards({ stats }: { stats: AccountStat[] }) {
  if (stats.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No account data yet.</p>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
      {stats.map((stat) => (
        <Card key={stat.account}>
          <CardContent className="pt-5 space-y-3">
            <p className="text-base font-semibold truncate">{stat.account}</p>
            <div className="space-y-2.5">
              <div className="flex justify-between items-baseline">
                <span className="text-sm text-muted-foreground">Followers</span>
                <span className="text-lg font-semibold tabular-nums">
                  {stat.followers.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-sm text-muted-foreground">Likes</span>
                <span className="text-lg font-semibold tabular-nums">
                  {stat.total_likes.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-sm text-muted-foreground">Videos</span>
                <span className="text-lg font-semibold tabular-nums">
                  {stat.videos}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
