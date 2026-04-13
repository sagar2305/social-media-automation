"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, X } from "lucide-react";
import type { AlertRule } from "@/lib/types";

const supabase = createBrowserSupabase();

const METRICS = [
  { value: "views", label: "Views" },
  { value: "saves", label: "Saves" },
  { value: "likes", label: "Likes" },
  { value: "save_rate", label: "Save Rate %" },
  { value: "followers", label: "Followers" },
];

const CONDITIONS = [
  { value: "gt", label: "Greater than" },
  { value: "lt", label: "Less than" },
];

export function AlertConfigForm() {
  const router = useRouter();
  const [type, setType] = useState<"slack" | "discord">("slack");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [rules, setRules] = useState<AlertRule[]>([
    { metric: "views", condition: "gt", threshold: 10000, enabled: true },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addRule() {
    setRules([...rules, { metric: "views", condition: "gt", threshold: 1000, enabled: true }]);
  }

  function removeRule(index: number) {
    setRules(rules.filter((_, i) => i !== index));
  }

  function updateRule(index: number, updates: Partial<AlertRule>) {
    setRules(rules.map((r, i) => (i === index ? { ...r, ...updates } : r)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!webhookUrl.trim()) return;

    setLoading(true);
    setError(null);

    const { error: err } = await supabase
      .from("alert_config")
      .insert({
        type,
        webhook_url: webhookUrl.trim(),
        enabled: true,
        rules,
      });

    if (err) {
      setError(err.message);
    } else {
      setWebhookUrl("");
      setRules([{ metric: "views", condition: "gt", threshold: 10000, enabled: true }]);
      router.refresh();
    }
    setLoading(false);
  }

  const selectClass =
    "flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_150px] gap-3">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                Webhook URL
              </label>
              <Input
                placeholder="https://hooks.slack.com/services/..."
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                Type
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as "slack" | "discord")}
                className={selectClass}
              >
                <option value="slack">Slack</option>
                <option value="discord">Discord</option>
              </select>
            </div>
          </div>

          {/* Rules */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-muted-foreground">
                Alert Rules
              </label>
              <Button type="button" variant="ghost" size="sm" onClick={addRule}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add rule
              </Button>
            </div>
            <div className="space-y-2">
              {rules.map((rule, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={rule.metric}
                    onChange={(e) => updateRule(i, { metric: e.target.value })}
                    className={`${selectClass} w-36`}
                  >
                    {METRICS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={rule.condition}
                    onChange={(e) =>
                      updateRule(i, { condition: e.target.value as "gt" | "lt" })
                    }
                    className={`${selectClass} w-40`}
                  >
                    {CONDITIONS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    value={rule.threshold}
                    onChange={(e) =>
                      updateRule(i, { threshold: Number(e.target.value) })
                    }
                    className="w-28"
                  />
                  {rules.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => removeRule(i)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <Button type="submit" disabled={loading || !webhookUrl.trim()}>
            {loading ? "Saving…" : "Save Alert"}
          </Button>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
