"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { ExportButton } from "@/components/export-button";
import type { HashtagSummary } from "@/lib/types";

type SortKey = keyof Pick<
  HashtagSummary,
  "views" | "likes" | "saves" | "avg_save_rate" | "posts"
>;

export function HashtagsTable({ hashtags }: { hashtags: HashtagSummary[] }) {
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

  const filtered = hashtags.filter((h) =>
    h.hashtag.toLowerCase().includes(search.toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) => {
    const diff = (a[sortKey] ?? 0) - (b[sortKey] ?? 0);
    return sortAsc ? diff : -diff;
  });

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <Input
          placeholder="Search hashtags…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <ExportButton
          data={sorted as unknown as Record<string, unknown>[]}
          filename="hashtags"
          columns={[
            { key: "hashtag", label: "Hashtag" },
            { key: "views", label: "Views" },
            { key: "likes", label: "Likes" },
            { key: "saves", label: "Saves" },
            { key: "avg_save_rate", label: "Avg Save %" },
            { key: "posts", label: "Posts" },
          ]}
        />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Hashtag</TableHead>
            <SortableHead k="views" current={sortKey} label="Views" indicator={sortIndicator} onClick={handleSort} />
            <SortableHead k="likes" current={sortKey} label="Likes" indicator={sortIndicator} onClick={handleSort} />
            <SortableHead k="saves" current={sortKey} label="Saves" indicator={sortIndicator} onClick={handleSort} />
            <SortableHead k="avg_save_rate" current={sortKey} label="Avg Save %" indicator={sortIndicator} onClick={handleSort} />
            <SortableHead k="posts" current={sortKey} label="Posts" indicator={sortIndicator} onClick={handleSort} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((h) => (
            <TableRow key={h.hashtag}>
              <TableCell className="font-medium text-[#16a34a]">
                {h.hashtag}
              </TableCell>
              <TableCell className="tabular-nums text-right font-semibold">
                {h.views.toLocaleString()}
              </TableCell>
              <TableCell className="tabular-nums text-right">
                {h.likes.toLocaleString()}
              </TableCell>
              <TableCell className="tabular-nums text-right">
                {h.saves.toLocaleString()}
              </TableCell>
              <TableCell className="tabular-nums text-right">
                {h.avg_save_rate.toFixed(2)}%
              </TableCell>
              <TableCell className="tabular-nums text-right">
                {h.posts}
              </TableCell>
            </TableRow>
          ))}
          {sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                {search ? "No hashtags match your search." : "No hashtag data yet."}
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
