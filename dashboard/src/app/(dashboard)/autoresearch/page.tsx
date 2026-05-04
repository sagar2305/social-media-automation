import { createClient } from "@/lib/supabase";
import { getUser } from "@/lib/auth";
import { AutoresearchPanel, type AutoresearchRun } from "@/components/autoresearch-panel";

export const dynamic = "force-dynamic";

export default async function AutoresearchPage() {
  // Sequence: auth first, then data, to avoid Supabase auth lock contention.
  const user = await getUser();
  const supabase = await createClient();
  const { data: runs } = await supabase
    .from("autoresearch_runs")
    .select("*")
    .order("occurred_at", { ascending: false })
    .limit(30)
    .returns<AutoresearchRun[]>();

  return <AutoresearchPanel initial={runs ?? []} isAdmin={user?.role === "admin"} />;
}
