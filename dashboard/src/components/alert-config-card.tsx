"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import type { AlertConfig } from "@/lib/types";

const supabase = createBrowserSupabase();

function maskUrl(url: string): string {
  if (url.length <= 20) return "••••••••";
  return url.slice(0, 12) + "••••••" + url.slice(-8);
}

const METRIC_LABELS: Record<string, string> = {
  views: "Views",
  saves: "Saves",
  likes: "Likes",
  save_rate: "Save Rate %",
  followers: "Followers",
};

export function AlertConfigCard({ config }: { config: AlertConfig }) {
  const router = useRouter();
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function toggleEnabled() {
    setToggling(true);
    await supabase
      .from("alert_config")
      .update({ enabled: !config.enabled, updated_at: new Date().toISOString() })
      .eq("id", config.id);
    router.refresh();
    setToggling(false);
  }

  async function handleDelete() {
    setDeleting(true);
    await supabase.from("alert_config").delete().eq("id", config.id);
    router.refresh();
    setDeleting(false);
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Badge
              variant="default"
              className={
                config.type === "slack"
                  ? "bg-[#248a3d]/10 text-[#248a3d]"
                  : "bg-[#5856d6]/10 text-[#5856d6]"
              }
            >
              {config.type}
            </Badge>
            <Badge
              variant={config.enabled ? "default" : "secondary"}
              className={
                config.enabled
                  ? "bg-[#248a3d]/10 text-[#248a3d]"
                  : ""
              }
            >
              {config.enabled ? "Active" : "Disabled"}
            </Badge>
          </div>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleEnabled}
              disabled={toggling}
            >
              {config.enabled ? "Disable" : "Enable"}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handleDelete}
              disabled={deleting}
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
            </Button>
          </div>
        </div>

        <p className="text-sm font-mono text-muted-foreground">
          {maskUrl(config.webhook_url)}
        </p>

        {config.rules && config.rules.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
              Rules
            </p>
            {config.rules.map((rule, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-sm bg-secondary/60 rounded-lg px-3 py-2"
              >
                <span className="font-medium">
                  {METRIC_LABELS[rule.metric] || rule.metric}
                </span>
                <span className="text-muted-foreground">
                  {rule.condition === "gt" ? ">" : "<"}
                </span>
                <span className="font-semibold tabular-nums">
                  {rule.threshold.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Created {new Date(config.created_at).toLocaleDateString()}
        </p>
      </CardContent>
    </Card>
  );
}
