import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { BankPostButton } from "@/components/bank-post-button";
import { BankSchedulePanel } from "@/components/bank-schedule-panel";
import { getActiveCampaignFilter } from "@/lib/campaign-filter";
import { IST_OFFSET_MIN, formatIst } from "@/lib/bank-schedule";

export const revalidate = 0;

type Meta = {
  title?: string;
  caption?: string;
  slideCount?: number;
  slideUrls?: string[];
  scheduledAt?: string;
};

/** Tomorrow in IST — the default start date for a bulk schedule. */
function tomorrowIst(): string {
  const ist = new Date(Date.now() + IST_OFFSET_MIN * 60_000 + 86_400_000);
  return ist.toISOString().slice(0, 10);
}

export default async function BankPage() {
  const supabase = await createClient();
  const activeCampaign = await getActiveCampaignFilter();

  let q = supabase
    .from("posts")
    .select("*")
    .in("status", ["banked", "scheduled"])
    .order("created_at", { ascending: false });
  if (activeCampaign) q = q.eq("campaign_id", activeCampaign.id);

  const { data, error } = await q;
  if (error) {
    throw new Error(`Failed to load banked posts: ${error.message}`);
  }
  const all = (data ?? []).map((p) => {
    let m: Meta = {};
    try {
      m = JSON.parse(p.failure_resolution_note || "{}");
    } catch {
      /* ignore */
    }
    return {
      id: p.id as string,
      account: p.account as string,
      flow: p.flow as string,
      status: p.status as string,
      thumbnail_url: p.thumbnail_url as string | null,
      title: m.title,
      caption: m.caption,
      slideCount: m.slideCount ?? m.slideUrls?.length ?? 0,
      scheduledAt: m.scheduledAt,
    };
  });

  const posts = all.filter((p) => p.status === "banked");
  const scheduled = all
    .filter((p) => p.status === "scheduled" && p.scheduledAt)
    .sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-5xl font-semibold tracking-tight">Content Bank</h1>
        <p className="text-lg text-muted-foreground mt-2">
          {posts.length} ready-to-post {posts.length === 1 ? "post" : "posts"}. Post one immediately,
          or schedule the whole bank across daily slots.
        </p>
      </div>

      <BankSchedulePanel defaultStartDate={tomorrowIst()} />

      {scheduled.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h2 className="text-xl font-semibold mb-3">Scheduled · {scheduled.length}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-1 text-sm">
              {scheduled.map((p) => (
                <div key={p.id} className="flex gap-2 truncate">
                  <span className="text-muted-foreground tabular-nums shrink-0">
                    {formatIst(p.scheduledAt!)}
                  </span>
                  <span className="font-medium shrink-0">@{p.account}</span>
                  <span className="text-muted-foreground truncate">{p.title}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {posts.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            No banked posts yet. Generated posts appear here once uploaded.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {posts.map((p) => (
            <Card key={p.id} className="overflow-hidden">
              <CardContent className="p-0">
                {p.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.thumbnail_url}
                    alt={p.title || "slide preview"}
                    className="w-full aspect-[3/4] object-cover bg-muted"
                  />
                )}
                <div className="p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium">@{p.account}</span>
                    <span>·</span>
                    <span>{p.flow}</span>
                    <span>·</span>
                    <span>{p.slideCount} slides</span>
                  </div>
                  <h3 className="font-semibold leading-snug line-clamp-2">{p.title || "Untitled"}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-3">{p.caption}</p>
                  <div className="pt-2 flex justify-end">
                    <BankPostButton id={p.id} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
