import { createClient } from "@/lib/supabase";
import { CreateShareForm } from "@/components/create-share-form";
import { ShareLinksTable } from "@/components/share-links-table";

export const revalidate = 300;

export default async function SharingPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("share_links")
    .select("*")
    .order("created_at", { ascending: false });

  const links = data ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-5xl font-semibold tracking-tight">
          Share Dashboard
        </h1>
        <p className="text-lg text-muted-foreground mt-2">
          Create read-only public links to share performance data.
        </p>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">Create share link</h2>
        <CreateShareForm />
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">
          Active links ({links.length})
        </h2>
        <ShareLinksTable links={links} />
      </div>
    </div>
  );
}
