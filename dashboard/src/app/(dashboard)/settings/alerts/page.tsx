import { createClient } from "@/lib/supabase";
import { AlertConfigForm } from "@/components/alert-config-form";
import { AlertConfigCard } from "@/components/alert-config-card";
import type { AlertConfig } from "@/lib/types";

export const revalidate = 300;

export default async function AlertsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("alert_config")
    .select("*")
    .order("created_at", { ascending: false });

  const configs = (data ?? []) as AlertConfig[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-5xl font-semibold tracking-tight">Alerts</h1>
        <p className="text-lg text-muted-foreground mt-2">
          Configure Slack and Discord notifications for performance milestones.
        </p>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">Add new alert</h2>
        <AlertConfigForm />
      </div>

      {configs.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">
            Active configurations ({configs.length})
          </h2>
          <div className="grid gap-5 md:grid-cols-2">
            {configs.map((config) => (
              <AlertConfigCard key={config.id} config={config} />
            ))}
          </div>
        </div>
      )}

      {configs.length === 0 && (
        <p className="text-muted-foreground text-center py-8">
          No alerts configured yet. Add a webhook above to get started.
        </p>
      )}
    </div>
  );
}
