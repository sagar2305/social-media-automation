import { Suspense } from "react";
import { createClient } from "@/lib/supabase";
import { AccountsTable } from "@/components/accounts-table";
import { DateRangeFilter } from "@/components/date-range-filter";
import { ExportButton } from "@/components/export-button";
import { getDateFilter } from "@/lib/utils";
import type { AccountSummary } from "@/lib/types";

export const revalidate = 300;

async function getAccountSummaries(dateFrom: string | null) {
  const supabase = await createClient();
  let postsQuery = supabase
    .from("posts")
    .select("*")
    .eq("status", "published")
    .order("date", { ascending: false });

  if (dateFrom) {
    postsQuery = postsQuery.gte("date", dateFrom);
  }

  const [postsRes, statsRes] = await Promise.all([
    postsQuery,
    supabase
      .from("account_stats")
      .select("*")
      .order("date", { ascending: false }),
  ]);

  const posts = postsRes.data ?? [];
  const stats = statsRes.data ?? [];

  // Latest stats per account
  const latestStats = new Map<string, (typeof stats)[0]>();
  for (const s of stats) {
    if (!latestStats.has(s.account)) latestStats.set(s.account, s);
  }

  // Aggregate posts per account
  const accountMap = new Map<string, { views: number; likes: number; saves: number; saveRates: number[]; count: number; lastDate: string | null }>();
  for (const p of posts) {
    const acc = p.account || "unknown";
    const existing = accountMap.get(acc) || { views: 0, likes: 0, saves: 0, saveRates: [], count: 0, lastDate: null };
    existing.views += p.views || 0;
    existing.likes += p.likes || 0;
    existing.saves += p.saves || 0;
    if (p.save_rate) existing.saveRates.push(Number(p.save_rate));
    existing.count++;
    if (!existing.lastDate || (p.date && p.date > existing.lastDate)) {
      existing.lastDate = p.date;
    }
    accountMap.set(acc, existing);
  }

  // Merge all known accounts
  const allAccounts = new Set([...accountMap.keys(), ...latestStats.keys()]);
  const summaries: AccountSummary[] = [];

  for (const account of allAccounts) {
    const agg = accountMap.get(account);
    const stat = latestStats.get(account);
    summaries.push({
      account,
      followers: stat?.followers || 0,
      views: agg?.views || 0,
      likes: agg?.likes || 0,
      saves: agg?.saves || 0,
      avg_save_rate:
        agg && agg.saveRates.length > 0
          ? agg.saveRates.reduce((a, b) => a + b, 0) / agg.saveRates.length
          : 0,
      posts: agg?.count || 0,
      last_posted: agg?.lastDate || null,
    });
  }

  return summaries;
}

export default async function AccountsPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = await props.searchParams;
  const range = typeof searchParams.range === "string" ? searchParams.range : undefined;
  const dateFrom = getDateFilter(range);
  const accounts = await getAccountSummaries(dateFrom);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-5xl font-semibold tracking-tight">Accounts</h1>
          <p className="text-lg text-muted-foreground mt-2">
            {accounts.length} account{accounts.length !== 1 ? "s" : ""} tracked
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ExportButton
            data={accounts as unknown as Record<string, unknown>[]}
            filename="accounts"
            columns={[
              { key: "account", label: "Account" },
              { key: "followers", label: "Followers" },
              { key: "views", label: "Views" },
              { key: "likes", label: "Likes" },
              { key: "saves", label: "Saves" },
              { key: "avg_save_rate", label: "Avg Save %" },
              { key: "posts", label: "Posts" },
              { key: "last_posted", label: "Last Posted" },
            ]}
          />
          <Suspense>
            <DateRangeFilter />
          </Suspense>
        </div>
      </div>
      <AccountsTable accounts={accounts} />
    </div>
  );
}
