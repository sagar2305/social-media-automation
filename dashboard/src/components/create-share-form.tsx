"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const ACCOUNTS = [
  "yournotetaker",
  "grow.withamanda",
  "miniutewise_thomas",
  "grow.with.claudia",
];

export function CreateShareForm() {
  const router = useRouter();
  const [title, setTitle] = useState("Shared Dashboard");
  const [accounts, setAccounts] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleAccount(account: string) {
    setAccounts((prev) =>
      prev.includes(account)
        ? prev.filter((a) => a !== account)
        : [...prev, account]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createBrowserSupabase();
    const { error: err } = await supabase.from("share_links").insert({
      title: title.trim() || "Shared Dashboard",
      accounts: accounts.length > 0 ? accounts : null,
      expires_at: expiresAt || null,
    });

    if (err) {
      setError(err.message);
    } else {
      setTitle("Shared Dashboard");
      setAccounts([]);
      setExpiresAt("");
      router.refresh();
    }
    setLoading(false);
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Title</label>
            <Input
              placeholder="Dashboard title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">
              Accounts to share
            </label>
            <div className="flex flex-wrap gap-2">
              {ACCOUNTS.map((acc) => (
                <button
                  key={acc}
                  type="button"
                  onClick={() => toggleAccount(acc)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    accounts.includes(acc)
                      ? "bg-foreground text-background"
                      : "bg-secondary text-muted-foreground hover:text-foreground"
                  }`}
                >
                  @{acc}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {accounts.length === 0
                ? "All accounts (default)"
                : `${accounts.length} selected`}
            </p>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">
              Expires at (optional)
            </label>
            <Input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" disabled={loading}>
            {loading ? "Creating…" : "Create share link"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
