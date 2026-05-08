/**
 * Account Progress — Mon-Sun grid per account showing this week's
 * posting cadence vs the campaign target. Mirrors Trackr's
 * "Creator Progress" widget but adapted: each cell is a count of posts
 * for that day-of-week.
 *
 * Visual: small circle per day with a number inside. Filled circle when
 * a post landed; empty ring when the day was zero.
 */

import { Card, CardContent } from "@/components/ui/card";
import { Users } from "lucide-react";

export interface AccountProgressRow {
  handle: string;
  name: string;
  /** Counts indexed Mon=0 … Sun=6 for the current ISO week. */
  thisWeek: number[];
  totalThisWeek: number;
  target: number;
}

interface Props {
  accounts: AccountProgressRow[];
}

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

export function AccountProgress({ accounts }: Props) {
  if (accounts.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Users className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-base font-medium mb-1">No accounts assigned</p>
          <p className="text-sm text-muted-foreground">
            Add an account to this campaign to start posting.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-base font-semibold">Account Progress</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Posts this week (Mon-Sun) per account vs target.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {accounts.map((a) => {
            const onTrack = a.totalThisWeek >= a.target;
            return (
              <div key={a.handle} className="grid grid-cols-[1fr_auto_auto] items-center gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">@{a.handle}</p>
                  <p className="text-xs text-muted-foreground">{a.name}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {a.thisWeek.map((count, i) => (
                    <DayDot key={i} label={DAY_LABELS[i]} count={count} />
                  ))}
                </div>
                <div className="text-right shrink-0 min-w-[80px]">
                  <p className={`text-sm font-semibold tabular-nums ${onTrack ? "text-[#16a34a]" : ""}`}>
                    {a.totalThisWeek}/{a.target}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {onTrack ? "on track" : "posts/week"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function DayDot({ label, count }: { label: string; count: number }) {
  const filled = count > 0;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className={`flex items-center justify-center h-6 w-6 rounded-full text-[10px] font-semibold tabular-nums ${
          filled
            ? "bg-primary text-primary-foreground"
            : "border border-border text-muted-foreground"
        }`}
      >
        {count > 0 ? count : ""}
      </span>
      <span className="text-[9px] text-muted-foreground">{label}</span>
    </div>
  );
}
