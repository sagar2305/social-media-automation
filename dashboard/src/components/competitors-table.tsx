"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ExportButton } from "@/components/export-button";
import { Trash2 } from "lucide-react";
import type { Competitor } from "@/lib/types";

const supabase = createBrowserSupabase();

type SortKey = keyof Pick<Competitor, "followers" | "views" | "likes" | "videos">;

export function CompetitorsTable({ competitors }: { competitors: Competitor[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("followers");
  const [sortAsc, setSortAsc] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    await supabase.from("competitors").delete().eq("id", id);
    router.refresh();
    setDeleting(null);
  }

  const filtered = competitors.filter((c) =>
    c.handle.toLowerCase().includes(search.toLowerCase())
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
          placeholder="Search competitors…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <ExportButton
          data={sorted as unknown as Record<string, unknown>[]}
          filename="competitors"
          columns={[
            { key: "handle", label: "Handle" },
            { key: "platform", label: "Platform" },
            { key: "followers", label: "Followers" },
            { key: "views", label: "Views" },
            { key: "likes", label: "Likes" },
            { key: "videos", label: "Videos" },
            { key: "last_checked", label: "Last Checked" },
          ]}
        />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Handle</TableHead>
            <TableHead>Platform</TableHead>
            <SortableHead k="followers" current={sortKey} label="Followers" indicator={sortIndicator} onClick={handleSort} />
            <SortableHead k="views" current={sortKey} label="Views" indicator={sortIndicator} onClick={handleSort} />
            <SortableHead k="likes" current={sortKey} label="Likes" indicator={sortIndicator} onClick={handleSort} />
            <SortableHead k="videos" current={sortKey} label="Videos" indicator={sortIndicator} onClick={handleSort} />
            <TableHead className="text-right">Last Checked</TableHead>
            <TableHead className="w-10"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium">@{c.handle}</TableCell>
              <TableCell>
                <Badge variant="secondary">{c.platform}</Badge>
              </TableCell>
              <TableCell className="tabular-nums text-right">
                {c.followers.toLocaleString()}
              </TableCell>
              <TableCell className="tabular-nums text-right">
                {c.views.toLocaleString()}
              </TableCell>
              <TableCell className="tabular-nums text-right">
                {c.likes.toLocaleString()}
              </TableCell>
              <TableCell className="tabular-nums text-right">
                {c.videos}
              </TableCell>
              <TableCell className="tabular-nums text-right text-muted-foreground">
                {c.last_checked
                  ? new Date(c.last_checked).toLocaleDateString()
                  : "—"}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => handleDelete(c.id)}
                  disabled={deleting === c.id}
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                {search ? "No competitors match your search." : "No competitors added yet."}
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
