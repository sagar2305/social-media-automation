import { createClient } from "@/lib/supabase";
import { AddCompetitorForm } from "@/components/add-competitor-form";
import { CompetitorsTable } from "@/components/competitors-table";

export const revalidate = 300;

export default async function CompetitorsPage() {
  const supabase = await createClient();
  const { data: competitors } = await supabase
    .from("competitors")
    .select("*")
    .order("added_at", { ascending: false });

  const all = competitors ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-5xl font-semibold tracking-tight">Competitors</h1>
        <p className="text-lg text-muted-foreground mt-2">
          Track competitor accounts and benchmark performance.
          {all.length > 0 && ` ${all.length} competitor${all.length !== 1 ? "s" : ""} tracked.`}
        </p>
      </div>

      <AddCompetitorForm />
      <CompetitorsTable competitors={all} />
    </div>
  );
}
