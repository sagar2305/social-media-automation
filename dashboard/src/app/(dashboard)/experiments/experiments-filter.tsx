"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function ExperimentsFilter({
  accounts,
  selected,
}: {
  accounts: string[];
  selected: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleFilter(account: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (account) {
      params.set("account", account);
    } else {
      params.delete("account");
    }
    router.push(`/experiments?${params.toString()}`);
  }

  if (accounts.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm text-muted-foreground mr-1">Account:</span>
      <button
        onClick={() => handleFilter(null)}
        className={`inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
          !selected
            ? "bg-foreground text-background"
            : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
        }`}
      >
        All
      </button>
      {accounts.map((acc) => (
        <button
          key={acc}
          onClick={() => handleFilter(acc)}
          className={`inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
            selected === acc
              ? "bg-foreground text-background"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
          }`}
        >
          @{acc}
        </button>
      ))}
    </div>
  );
}
