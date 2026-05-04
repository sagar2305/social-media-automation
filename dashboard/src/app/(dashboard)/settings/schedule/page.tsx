import { createClient } from "@/lib/supabase";
import { ScheduleForm } from "@/components/schedule-form";
import { BatchManager, type CycleBatch } from "@/components/batch-manager";
import type { ManagedAccount } from "@/components/account-manager";

export const revalidate = 0;

interface ScheduleSettings {
  enabled: boolean;
  run_time: string;
  timezone: string;
  last_run_date: string | null;
  last_run_at: string | null;
}

export default async function SchedulePage() {
  const supabase = await createClient();

  const [settingsRes, batchesRes, accountsRes, userRes] = await Promise.all([
    supabase.from("schedule_settings").select("*").eq("id", 1).single<ScheduleSettings>(),
    supabase
      .from("cycle_batches")
      .select("*")
      .order("order_index", { ascending: true })
      .returns<CycleBatch[]>(),
    supabase
      .from("accounts")
      .select("id, name, handle, active, notes")
      .eq("active", true)
      .order("created_at", { ascending: true })
      .returns<ManagedAccount[]>(),
    supabase.auth.getUser(),
  ]);

  const userId = userRes.data?.user?.id;
  let role = "viewer";
  if (userId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();
    role = profile?.role ?? "viewer";
  }

  return (
    <div className="space-y-12">
      <ScheduleForm
        enabled={settingsRes.data?.enabled ?? true}
        runTime={settingsRes.data?.run_time ?? "19:00"}
        timezone={settingsRes.data?.timezone ?? "Asia/Kolkata"}
        lastRunDate={settingsRes.data?.last_run_date ?? null}
        lastRunAt={settingsRes.data?.last_run_at ?? null}
      />

      <BatchManager
        initial={batchesRes.data ?? []}
        accounts={accountsRes.data ?? []}
        isAdmin={role === "admin"}
      />
    </div>
  );
}
