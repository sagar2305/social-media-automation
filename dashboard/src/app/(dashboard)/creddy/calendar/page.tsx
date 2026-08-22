import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/lib/auth";
import { listCreddyBankItems } from "@/lib/creddy-file-store";
import { CreddyPublishingCalendar, type CreddyCalendarEvent } from "./publishing-calendar";

export const dynamic = "force-dynamic";

export default async function CreddyCalendarPage() {
  await requireRole("viewer");
  const items = await listCreddyBankItems();
  const events: CreddyCalendarEvent[] = items.filter((item) => item.status !== "rejected").flatMap((item) => item.destinations.map((destination) => {
    const mode = destination.mode ?? "schedule";
    const calendarAt = destination.status === "pending" || destination.status === "scheduled"
      ? destination.scheduledFor
      : destination.status === "published"
        ? destination.publishedAt ?? destination.lastCheckedAt ?? destination.submittedAt ?? destination.scheduledFor
        : destination.submittedAt ?? destination.lastCheckedAt ?? destination.scheduledFor;
    return {
      key: `${item.id}:${destination.platform}:${destination.account}:${destination.format}`,
      itemId: item.id,
      hook: item.hook,
      platform: destination.platform,
      account: destination.account,
      format: destination.format,
      mode,
      status: destination.status,
      calendarAt,
      scheduledFor: destination.scheduledFor,
      submittedAt: destination.submittedAt,
      publishedAt: destination.publishedAt,
      lastCheckedAt: destination.lastCheckedAt,
      submissionId: destination.submissionId,
      publishedUrl: destination.publishedUrl,
      error: destination.error,
    };
  }));
  const count = (statuses: CreddyCalendarEvent["status"][]) => events.filter((event) => statuses.includes(event.status)).length;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">Creddy · US market</Badge><Badge variant="secondary">Live delivery history</Badge></div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Creddy Calendar</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">See every Creddy post destination by date, platform, account, and delivery state. Calendar entries update from the same records used for scheduling and Blotato status reconciliation.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Scheduled or queued" value={count(["pending", "scheduled"])} tone="blue" />
        <Metric label="Publishing" value={count(["submitted", "publishing"])} tone="amber" />
        <Metric label="Published" value={count(["published"])} tone="green" />
        <Metric label="Drafts or failures" value={count(["draft_sent", "blotato_draft", "failed"])} tone="violet" />
      </div>

      <CreddyPublishingCalendar events={events} initialDate={new Date().toISOString()} />
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: "blue" | "amber" | "green" | "violet" }) {
  const colors = { blue: "bg-blue-500", amber: "bg-amber-500", green: "bg-emerald-500", violet: "bg-violet-500" };
  return <Card><CardContent className="flex items-center gap-3 py-4"><span className={`size-2.5 rounded-full ${colors[tone]}`} /><div><div className="text-2xl font-semibold">{value}</div><div className="text-sm text-muted-foreground">{label}</div></div></CardContent></Card>;
}
