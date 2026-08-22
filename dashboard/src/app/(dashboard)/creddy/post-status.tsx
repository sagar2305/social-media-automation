import { Badge } from "@/components/ui/badge";
import type { CreddyBankItemDto } from "@/lib/creddy-file-store";

export type DisplayPostStatus = "pending_review" | "changes_requested" | "approved" | "draft_sent" | "blotato_draft" | "scheduled" | "publishing" | "published" | "partially_published" | "rejected";

export function displayPostStatus(item: CreddyBankItemDto): DisplayPostStatus {
  if (item.status === "rejected") return "rejected";
  const destinations = item.destinations;
  const publishedCount = destinations.filter((destination) => destination.status === "published").length;
  if (destinations.length > 0 && publishedCount === destinations.length) return "published";
  if (publishedCount > 0) return "partially_published";
  if (destinations.some((destination) => destination.status === "submitted" || destination.status === "publishing")) return "publishing";
  if (destinations.some((destination) => destination.status === "scheduled" || destination.status === "pending")) return "scheduled";
  if (destinations.some((destination) => destination.status === "blotato_draft")) return "blotato_draft";
  if (destinations.some((destination) => destination.status === "draft_sent")) return "draft_sent";
  if (item.status === "changes_requested") return "changes_requested";
  if (item.status === "approved") return "approved";
  if (item.status === "published") return "published";
  if (item.status === "scheduled") return "scheduled";
  return "pending_review";
}

export function PostStatusBadge({ item }: { item: CreddyBankItemDto }) {
  const status = displayPostStatus(item);
  const label = status === "partially_published"
    ? "Partially Published"
    : status === "draft_sent"
      ? "TikTok Draft Sent"
      : status === "blotato_draft"
        ? "Blotato Draft"
        : humanizeStatus(status);
  const className = status === "scheduled"
    ? "border-blue-200 bg-blue-50 text-blue-700"
    : status === "publishing"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : status === "blotato_draft" || status === "draft_sent"
        ? "border-violet-200 bg-violet-50 text-violet-700"
      : status === "pending_review"
        ? "border-violet-200 bg-violet-50 text-violet-700"
        : undefined;
  return <Badge className={className} variant={status === "rejected" ? "destructive" : status === "published" ? "default" : "secondary"}>Status: {label}</Badge>;
}

export function postStatusDetail(item: CreddyBankItemDto): string {
  const status = displayPostStatus(item);
  if (status === "scheduled") {
    const dates = item.destinations
      .filter((destination) => destination.status === "scheduled" || destination.status === "pending")
      .map((destination) => destination.scheduledFor)
      .filter(Boolean)
      .sort();
    return dates[0] ? `Scheduled for ${formatStatusDate(dates[0])}` : "Scheduled for delivery";
  }
  if (status === "published" || status === "partially_published") {
    const dates = item.destinations.map((destination) => destination.publishedAt).filter((date): date is string => Boolean(date)).sort();
    return dates.at(-1) ? `${status === "published" ? "Published" : "Partially published"} ${formatStatusDate(dates.at(-1)!)}` : humanizeStatus(status);
  }
  if (status === "publishing") return "Submitted and awaiting confirmation from Blotato";
  if (status === "draft_sent") return "Sent to the selected TikTok account as a draft";
  if (status === "blotato_draft") return "Removed from Blotato's live schedule and retained as a remote draft";
  if (status === "pending_review") return "Pending human review";
  if (status === "changes_requested") return "Waiting for requested changes";
  if (status === "approved") return "Approved and ready for delivery";
  if (status === "rejected") return item.rejectedAt ? `Rejected ${formatStatusDate(item.rejectedAt)}` : "Stored in Rejected";
  return humanizeStatus(status);
}

function humanizeStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatStatusDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
