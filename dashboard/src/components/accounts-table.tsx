"use client";

import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import type { AccountSummary } from "@/lib/types";

type SortKey = keyof Pick<
  AccountSummary,
  "followers" | "views" | "likes" | "saves" | "avg_save_rate" | "posts"
>;

export function AccountsTable({ accounts }: { accounts: AccountSummary[] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("views");
  const [sortAsc, setSortAsc] = useState(false);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  const filtered = accounts.filter((a) =>
    a.account.toLowerCase().includes(search.toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) => {
    const diff = (a[sortKey] ?? 0) - (b[sortKey] ?? 0);
    return sortAsc ? diff : -diff;
  });

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search accounts…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            <SortableHead k="followers" current={sortKey} label="Followers" indicator={sortIndicator} onClick={handleSort} />
            <SortableHead k="views" current={sortKey} label="Views" indicator={sortIndicator} onClick={handleSort} />
            <SortableHead k="likes" current={sortKey} label="Likes" indicator={sortIndicator} onClick={handleSort} />
            <SortableHead k="saves" current={sortKey} label="Saves" indicator={sortIndicator} onClick={handleSort} />
            <SortableHead k="avg_save_rate" current={sortKey} label="Save %" indicator={sortIndicator} onClick={handleSort} />
            <SortableHead k="posts" current={sortKey} label="Posts" indicator={sortIndicator} onClick={handleSort} />
            <TableHead className="text-right">Last Posted</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((a) => (
            <TableRow key={a.account} className="group">
              <TableCell>
                <Link
                  href={`/accounts/${a.account}`}
                  className="font-medium text-[#16a34a] hover:underline"
                >
                  @{a.account}
                </Link>
              </TableCell>
              <TableCell className="tabular-nums text-right">
                {a.followers.toLocaleString()}
              </TableCell>
              <TableCell className="tabular-nums text-right font-semibold">
                {a.views.toLocaleString()}
              </TableCell>
              <TableCell className="tabular-nums text-right">
                {a.likes.toLocaleString()}
              </TableCell>
              <TableCell className="tabular-nums text-right">
                {a.saves.toLocaleString()}
              </TableCell>
              <TableCell className="tabular-nums text-right">
                {a.avg_save_rate.toFixed(2)}%
              </TableCell>
              <TableCell className="tabular-nums text-right">
                {a.posts}
              </TableCell>
              <TableCell className="tabular-nums text-right text-muted-foreground">
                {a.last_posted || "—"}
              </TableCell>
            </TableRow>
          ))}
          {sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                {search ? "No accounts match your search." : "No account data yet."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function SortableHead({
  k,
  current,
  label,
  indicator,
  onClick,
}: {
  k: SortKey;
  current: SortKey;
  label: string;
  indicator: (key: SortKey) => string;
  onClick: (key: SortKey) => void;
}) {
  return (
    <TableHead className="text-right">
      <button
        onClick={() => onClick(k)}
        className={`hover:text-foreground transition-colors ${
          current === k ? "text-foreground font-semibold" : ""
        }`}
      >
        {label}{indicator(k)}
      </button>
    </TableHead>
  );
}
