import { createClient } from "@/lib/supabase";
import { RunsLive } from "@/components/runs-live";
import { RunNowButton } from "@/components/run-now-button";
import type { ManagedAccount } from "@/components/account-manager";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const supabase = await createClient();

  const [accountsRes, userRes] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, handle, active, notes")
      .eq("active", true)
      .order("created_at", { ascending: true })
      .returns<ManagedAccount[]>(),
    supabase.auth.getUser(),
  ]);

  let role = "viewer";
  if (userRes.data?.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userRes.data.user.id)
      .single();
    role = profile?.role ?? "viewer";
  }

  return (
    <div className="space-y-6">
      <RunNowButton accounts={accountsRes.data ?? []} isAdmin={role === "admin"} />
      <RunsLive />
    </div>
  );
}
