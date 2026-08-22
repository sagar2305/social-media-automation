import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/lib/auth";
import { listCreddyBankItems, type CreddyBankItemDto } from "@/lib/creddy-file-store";
import { CreddyContentInventory } from "../../content-inventory";

export const dynamic = "force-dynamic";

const views = {
  scheduled: {
    title: "Scheduled Posts",
    description: "Posts queued for future Instagram or TikTok delivery.",
    empty: "No posts are currently scheduled.",
    matches: (item: CreddyBankItemDto) => item.status !== "rejected" && (item.status === "scheduled" || item.destinations.some((destination) => ["pending", "scheduled"].includes(destination.status))),
  },
  publishing: {
    title: "Publishing Posts",
    description: "Posts submitted to the delivery provider and currently being processed.",
    empty: "No posts are currently publishing.",
    matches: (item: CreddyBankItemDto) => item.status !== "rejected" && item.destinations.some((destination) => ["submitted", "publishing"].includes(destination.status)),
  },
  published: {
    title: "Published Posts",
    description: "Posts confirmed live on their selected social platforms.",
    empty: "No posts have been confirmed as published yet.",
    matches: (item: CreddyBankItemDto) => item.status !== "rejected" && (item.status === "published" || item.destinations.some((destination) => destination.status === "published")),
  },
  rejected: {
    title: "Rejected Posts",
    description: "Content removed from the active workflow and retained for audit history.",
    empty: "No content has been rejected.",
    matches: (item: CreddyBankItemDto) => item.status === "rejected",
  },
} as const;

export default async function CreddyStatusPage({ params }: { params: Promise<{ view: string }> }) {
  await requireRole("viewer");
  const { view } = await params;
  if (!(view in views)) notFound();
  const config = views[view as keyof typeof views];
  const items = (await listCreddyBankItems()).filter(config.matches);

  return (
    <div className="space-y-6">
      <div>
        <Badge variant="outline">{items.length} {items.length === 1 ? "post" : "posts"}</Badge>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">{config.title}</h1>
        <p className="mt-2 text-muted-foreground">{config.description}</p>
      </div>
      <CreddyContentInventory items={items} emptyMessage={config.empty} />
    </div>
  );
}
