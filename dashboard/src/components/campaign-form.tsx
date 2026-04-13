"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, X } from "lucide-react";

const ACCOUNTS = [
  "yournotetaker",
  "grow.withamanda",
  "miniutewise_thomas",
  "grow.with.claudia",
];

const VARIABLES = [
  "hook_style",
  "format",
  "slide_count",
  "flow",
  "cta_style",
  "caption_style",
];

export function CampaignForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [variable, setVariable] = useState(VARIABLES[0]);
  const [variants, setVariants] = useState(["", ""]);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addVariant() {
    setVariants([...variants, ""]);
  }

  function removeVariant(i: number) {
    if (variants.length <= 2) return;
    setVariants(variants.filter((_, idx) => idx !== i));
  }

  function updateVariant(i: number, value: string) {
    setVariants(variants.map((v, idx) => (idx === i ? value : v)));
  }

  function toggleAccount(account: string) {
    setAccounts((prev) =>
      prev.includes(account)
        ? prev.filter((a) => a !== account)
        : [...prev, account]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || variants.filter(Boolean).length < 2) {
      setError("Name and at least 2 variants are required");
      return;
    }

    setLoading(true);
    setError(null);

    const supabase = createBrowserSupabase();
    const { error: err } = await supabase.from("campaigns").insert({
      name: name.trim(),
      description: description.trim() || null,
      variable,
      variants: variants.filter(Boolean),
      accounts: accounts.length > 0 ? accounts : ACCOUNTS,
      start_date: startDate || null,
      end_date: endDate || null,
    });

    if (err) {
      setError(err.message);
      setLoading(false);
    } else {
      router.push("/campaigns");
      router.refresh();
    }
  }

  const selectClass =
    "flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="text-sm font-medium mb-1.5 block">
              Campaign name
            </label>
            <Input
              placeholder="e.g. Hook style experiment Q2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">
              Description
            </label>
            <Input
              placeholder="What are you testing?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">
              Variable to test
            </label>
            <select
              value={variable}
              onChange={(e) => setVariable(e.target.value)}
              className={selectClass}
            >
              {VARIABLES.map((v) => (
                <option key={v} value={v}>
                  {v.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Variants</label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addVariant}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add variant
              </Button>
            </div>
            <div className="space-y-2">
              {variants.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground w-5">
                    {String.fromCharCode(65 + i)}
                  </span>
                  <Input
                    placeholder={`Variant ${String.fromCharCode(65 + i)}`}
                    value={v}
                    onChange={(e) => updateVariant(i, e.target.value)}
                  />
                  {variants.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => removeVariant(i)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">
              Accounts
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Start date
              </label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                End date
              </label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" disabled={loading}>
            {loading ? "Creating…" : "Create campaign"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
