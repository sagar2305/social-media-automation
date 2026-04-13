"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

const presets = [
  { label: "7d", value: "7" },
  { label: "30d", value: "30" },
  { label: "90d", value: "90" },
  { label: "All", value: "all" },
] as const;

export function DateRangeFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("range") || "all";

  function handleSelect(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("range");
    } else {
      params.set("range", value);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex gap-1">
      {presets.map((p) => {
        const isActive = current === p.value || (current === "all" && p.value === "all");
        return (
          <button
            key={p.value}
            onClick={() => handleSelect(p.value)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
              isActive
                ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

