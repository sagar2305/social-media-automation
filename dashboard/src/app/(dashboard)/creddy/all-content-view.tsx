import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/lib/auth";
import { listCreddyBankItems } from "@/lib/creddy-file-store";
import { CreddyContentInventory } from "./content-inventory";

export async function AllCreddyContentBankPage({ mediaType }: { mediaType: "slideshow" | "video" }) {
  await requireRole("viewer");
  const items = await listCreddyBankItems();
  const slideshows = items.filter((item) => item.mediaType === "slideshow");
  const videos = items.filter((item) => item.mediaType === "video");
  const visible = mediaType === "slideshow" ? slideshows : videos;
  const scheduled = items.filter((item) => item.status !== "rejected" && (item.status === "scheduled" || item.destinations.some((destination) => ["pending", "scheduled"].includes(destination.status)))).length;
  const published = items.filter((item) => item.status !== "rejected" && (item.status === "published" || item.destinations.some((destination) => destination.status === "published"))).length;
  const rejected = items.filter((item) => item.status === "rejected").length;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">Creddy · US market</Badge><Badge variant="secondary">Generated content library</Badge></div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">All Content</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">A compact library of every post produced by the pipeline. Open a card to inspect its copy, sources, delivery history, or reject an unapproved item. Use Review Queue when you want to edit or deliver content.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total generated" value={items.length} />
        <Metric label="Scheduled" value={scheduled} />
        <Metric label="Published" value={published} />
        <Metric label="Rejected" value={rejected} />
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border bg-card p-3">
        <Link className={`rounded-lg px-4 py-2 text-sm font-medium ${mediaType === "slideshow" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"}`} href="/creddy/all-content/slideshows">
          Slideshows &amp; images ({slideshows.length})
        </Link>
        <Link className={`rounded-lg px-4 py-2 text-sm font-medium ${mediaType === "video" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"}`} href="/creddy/all-content/videos">
          Videos ({videos.length})
        </Link>
      </div>

      <section className="space-y-4">
        <div className="flex flex-col gap-1 border-b pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{mediaType === "slideshow" ? "Slideshow library" : "Video library"}</h2>
            <p className="text-sm text-muted-foreground">Select a post to inspect its saved content and status.</p>
          </div>
          <Badge variant="outline">{visible.length} stored</Badge>
        </div>
        <CreddyContentInventory items={visible} emptyMessage={`No ${mediaType === "slideshow" ? "slideshows" : "videos"} have been generated yet.`} />
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <Card><CardContent className="py-4"><div className="text-2xl font-semibold">{value}</div><div className="text-sm text-muted-foreground">{label}</div></CardContent></Card>;
}
