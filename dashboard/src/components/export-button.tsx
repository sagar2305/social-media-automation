"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface Column {
  key: string;
  label: string;
}

function escapeCsvValue(value: unknown): string {
  const str = value == null ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function ExportButton({
  data,
  filename,
  columns,
}: {
  data: Record<string, unknown>[];
  filename: string;
  columns?: Column[];
}) {
  function handleExport() {
    if (data.length === 0) return;

    const cols = columns || Object.keys(data[0]).map((k) => ({ key: k, label: k }));
    const header = cols.map((c) => escapeCsvValue(c.label)).join(",");
    const rows = data.map((row) =>
      cols.map((c) => escapeCsvValue(row[c.key])).join(",")
    );
    const csv = [header, ...rows].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={data.length === 0}
    >
      <Download className="h-4 w-4 mr-1.5" />
      Export CSV
    </Button>
  );
}
