import { createClient } from "@/lib/supabase";
import { AutoresearchPanel, type AutoresearchRun } from "@/components/autoresearch-panel";

export const dynamic = "force-dynamic";

export default async function AutoresearchPage() {
  const supabase = await createClient();

  const [runsRes, userRes] = await Promise.all([
    supabase
      .from("autoresearch_runs")
      .select("*")
      .order("occurred_at", { ascending: false })
      .limit(30)
      .returns<AutoresearchRun[]>(),
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

  return <AutoresearchPanel initial={runsRes.data ?? []} isAdmin={role === "admin"} />;
}
