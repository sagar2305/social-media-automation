import { createClient } from "@/lib/supabase";
import { getUser } from "@/lib/auth";
import { RunsLive } from "@/components/runs-live";
import { RunNowButton } from "@/components/run-now-button";
import type { ManagedAccount } from "@/components/account-manager";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  // Sequence auth + data queries to avoid the Supabase auth-token lock
  // contention that happens when getUser() races against parallel queries.
  const user = await getUser();
  const supabase = await createClient();
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name, handle, active, notes")
    .eq("active", true)
    .order("created_at", { ascending: true })
    .returns<ManagedAccount[]>();

  return (
    <div className="space-y-6">
      <RunNowButton accounts={accounts ?? []} isAdmin={user?.role === "admin"} />
      <RunsLive />
    </div>
  );
}
