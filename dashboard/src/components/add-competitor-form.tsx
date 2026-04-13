"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const supabase = createBrowserSupabase();

export function AddCompetitorForm() {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [platform, setPlatform] = useState("tiktok");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = handle.trim().replace(/^@/, "");
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    const { error: err } = await supabase
      .from("competitors")
      .insert({ handle: trimmed, platform });

    if (err) {
      setError(err.message);
    } else {
      setHandle("");
      router.refresh();
    }
    setLoading(false);
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="flex items-end gap-3">
          <div className="flex-1">
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
              Handle
            </label>
            <Input
              placeholder="@competitor_handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
          </div>
          <div className="w-32">
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
              Platform
            </label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="tiktok">TikTok</option>
              <option value="instagram">Instagram</option>
              <option value="youtube">YouTube</option>
            </select>
          </div>
          <Button type="submit" disabled={loading || !handle.trim()}>
            {loading ? "Adding…" : "Add"}
          </Button>
        </form>
        {error && (
          <p className="text-sm text-destructive mt-2">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
