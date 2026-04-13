import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExportButton } from "@/components/export-button";

export const revalidate = 300;

const STATUS_COLORS: Record<string, string> = {
  draft: "",
  active: "bg-[#16a34a]/10 text-[#16a34a]",
  completed: "bg-[#248a3d]/10 text-[#248a3d]",
  paused: "bg-[#bf4800]/10 text-[#bf4800]",
};

export default async function CampaignsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaigns")
    .select("*")
    .order("created_at", { ascending: false });

  const campaigns = data ?? [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-5xl font-semibold tracking-tight">Campaigns</h1>
          <p className="text-lg text-muted-foreground mt-2">
            Manage A/B test campaigns across accounts.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ExportButton
            data={campaigns.map((c) => ({
              name: c.name,
              status: c.status,
              variable: c.variable,
              accounts: c.accounts?.join(", "),
              start_date: c.start_date,
              end_date: c.end_date,
              created_at: c.created_at,
            }))}
            filename="campaigns"
          />
          <Link href="/campaigns/new">
            <Button>New campaign</Button>
          </Link>
        </div>
      </div>

      {campaigns.length === 0 && (
        <Card>
          <CardContent className="text-center py-12 text-muted-foreground">
            No campaigns yet. Create your first campaign to start testing.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {campaigns.map((c) => (
          <Card key={c.id}>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-base font-semibold">{c.name}</p>
                  {c.description && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {c.description}
                    </p>
                  )}
                </div>
                <Badge
                  variant="default"
                  className={STATUS_COLORS[c.status] || ""}
                >
                  {c.status}
                </Badge>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Variable</span>
                  <span className="font-medium">
                    {c.variable?.replace(/_/g, " ")}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Variants</span>
                  <span className="font-medium">
                    {Array.isArray(c.variants) ? c.variants.length : 0}
                  </span>
                </div>
                {Array.isArray(c.variants) && c.variants.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {(c.variants as string[]).map((v, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium"
                      >
                        {String.fromCharCode(65 + i)}: {v}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Accounts</span>
                  <span className="font-medium">
                    {c.accounts?.length || "All"}
                  </span>
                </div>
                {c.start_date && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Dates</span>
                    <span className="font-medium tabular-nums">
                      {c.start_date}
                      {c.end_date ? ` → ${c.end_date}` : " → ongoing"}
                    </span>
                  </div>
                )}
              </div>

              <p className="text-xs text-muted-foreground pt-2 border-t border-border/50">
                Created {new Date(c.created_at).toLocaleDateString()}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
