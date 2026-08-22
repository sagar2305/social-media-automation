import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireRole } from "@/lib/auth";
import { listCreddyBankItems } from "@/lib/creddy-file-store";
import { listBlotatoAccounts, type BlotatoAccount } from "@/lib/blotato";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { approveCreddyAction, refreshCreddyDeliveryStatusesAction, rejectCreddyAction } from "./actions";
import { CreddyCalendar } from "./creddy-calendar";
import { SlideGallery } from "./slide-gallery";
import { SlideshowPublishingPanel } from "./slideshow-publishing-panel";
import { SlideshowSlideEditor } from "./slideshow-slide-editor";
import { PostStatusBadge, postStatusDetail } from "../post-status";

export const dynamic = "force-dynamic";

function defaultSchedule(offsetHours: number): string {
  const date = new Date(Date.now() + offsetHours * 60 * 60 * 1000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

const deliveryLabels = {
  pending: "Pending",
  submitted: "Submitted",
  draft_sent: "TikTok draft sent",
  blotato_draft: "Blotato draft",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
} as const;

export async function CreddyContentBankPage({ mediaType, selectedId, updated }: { mediaType: "slideshow" | "video"; selectedId?: string; updated?: string }) {
  await requireRole("viewer");
  const items = await listCreddyBankItems();
  const usingCloudMirror = items.some((item) => item.cloudBacked);
  let blotatoAccounts: BlotatoAccount[] = [];
  let blotatoAccountError: string | undefined;
  const blotatoApiKey = process.env.BLOTATO_API_KEY;
  if (!blotatoApiKey) {
    blotatoAccountError = "BLOTATO_API_KEY is not configured in the dashboard environment.";
  } else {
    try {
      blotatoAccounts = (await listBlotatoAccounts(blotatoApiKey)).filter((account) => account.platform === "instagram" || account.platform === "tiktok");
    } catch (error) {
      blotatoAccountError = error instanceof Error ? error.message : "Blotato account verification failed";
    }
  }
  const pending = items.filter((item) => item.status === "pending_review" || item.status === "changes_requested");
  const scheduled = items.filter((item) => item.status === "scheduled");
  const pendingSlideshows = pending.filter((item) => item.mediaType === "slideshow");
  const pendingVideos = pending.filter((item) => item.mediaType === "video");
  const selectedItem = selectedId ? items.find((item) => item.id === selectedId && item.mediaType === mediaType) : undefined;
  const deliveryActivity = items.flatMap((item) => item.destinations.map((destination) => ({ item, destination })));
  const draftCount = deliveryActivity.filter(({ destination }) => ["draft_sent", "blotato_draft"].includes(destination.status)).length;
  const publishingCount = deliveryActivity.filter(({ destination }) => destination.status === "publishing" || destination.status === "submitted").length;
  const scheduledCount = deliveryActivity.filter(({ destination }) => destination.status === "scheduled" || destination.status === "pending").length;
  const publishedCount = deliveryActivity.filter(({ destination }) => destination.status === "published").length;
  const visiblePending = mediaType === "slideshow" ? pendingSlideshows : pendingVideos;
  const visibleItems = selectedItem && !visiblePending.some((item) => item.id === selectedItem.id)
    ? [selectedItem, ...visiblePending]
    : visiblePending;
  const contentSections = mediaType === "slideshow" ? [
    {
      key: "slideshows",
      title: "Slideshows & images",
      description: "Six-slide Instagram and TikTok carousel posts. Click any image to inspect it at full size.",
      items: visibleItems,
    },
  ] : [
    {
      key: "videos",
      title: "Videos",
      description: "Text + music and narrated Chatterbox video formats.",
      items: visibleItems,
    },
  ];

  return (
    <div className="space-y-6">
      {updated === "slides-regenerated" && <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" /><div><strong>Slide revision saved.</strong><p className="mt-1 text-muted-foreground">All six images were regenerated and validated. The previous revision remains preserved locally.</p></div></div>}
      <div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">Creddy · US market</Badge>
          <Badge variant="secondary">Human approval required</Badge>
        </div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Creddy Content Bank</h1>
        <p className="mt-2 text-muted-foreground">{mediaType === "slideshow"
          ? "Review complete six-image slideshow posts for Instagram and TikTok."
          : "Review text + music and narrated Chatterbox video formats."} Nothing publishes without human approval.</p>
      </div>

      {usingCloudMirror && <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm"><strong>Secure cloud mirror</strong><p className="mt-1 text-muted-foreground">Photos, slideshows, videos, captions, and status are mirrored from the automation Mac. Use Slack or the Mac portal for approval and publishing; this deployed view is review-only.</p></div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card><CardContent className="py-3"><div className="text-2xl font-semibold">{visiblePending.length}</div><div className="text-muted-foreground">Awaiting review on this screen</div></CardContent></Card>
        <Card><CardContent className="py-3"><div className="text-2xl font-semibold">{draftCount}</div><div className="text-muted-foreground">Blotato / TikTok drafts</div></CardContent></Card>
        <Card><CardContent className="py-3"><div className="text-2xl font-semibold">{scheduledCount}</div><div className="text-muted-foreground">Scheduled</div></CardContent></Card>
        <Card><CardContent className="py-3"><div className="text-2xl font-semibold">{publishingCount}</div><div className="text-muted-foreground">Publishing</div></CardContent></Card>
        <Card><CardContent className="py-3"><div className="text-2xl font-semibold">{publishedCount}</div><div className="text-muted-foreground">Published</div></CardContent></Card>
      </div>

      {deliveryActivity.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Delivery status</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Every TikTok draft, scheduled post, immediate publish, failure, and confirmed public post is tracked here.</p>
            </div>
            <form action={refreshCreddyDeliveryStatusesAction}>
              <Button type="submit" variant="outline">Refresh Blotato status</Button>
            </form>
          </CardHeader>
          <CardContent className="space-y-3">
            {deliveryActivity.map(({ item, destination }) => (
              <div className="grid gap-2 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_auto]" key={`${item.id}-${destination.platform}-${destination.account}-${destination.format}`}>
                <div className="min-w-0">
                  <div className="truncate font-medium">{item.hook}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {destination.platform === "tiktok" ? "TikTok" : "Instagram"} · account {destination.account}
                    {destination.mode === "schedule" ? ` · ${new Date(destination.scheduledFor).toLocaleString()}` : destination.submittedAt ? ` · sent ${new Date(destination.submittedAt).toLocaleString()}` : ""}
                  </div>
                  {destination.submissionId && <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">Submission {destination.submissionId}</div>}
                  {destination.lastCheckedAt && <div className="mt-1 text-[11px] text-muted-foreground">Live Blotato check {new Date(destination.lastCheckedAt).toLocaleString()}</div>}
                  {destination.error && <div className="mt-1 text-xs text-destructive">{destination.error}</div>}
                  {destination.publishedUrl && <a className="mt-1 block text-xs underline" href={destination.publishedUrl} rel="noreferrer" target="_blank">Open published post</a>}
                </div>
                <div className="flex items-start gap-2">
                  <Badge variant={destination.status === "failed" ? "destructive" : destination.status === "published" ? "default" : "secondary"}>{deliveryLabels[destination.status]}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2 rounded-xl border bg-card p-3">
        <Link className={`rounded-lg px-4 py-2 text-sm font-medium ${mediaType === "slideshow" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"}`} href="/creddy/content-bank/slideshows">
          Slideshows & images ({pendingSlideshows.length})
        </Link>
        <Link className={`rounded-lg px-4 py-2 text-sm font-medium ${mediaType === "video" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"}`} href="/creddy/content-bank/videos">
          Videos ({pendingVideos.length})
        </Link>
      </div>

      {visibleItems.length === 0 ? (
        <Card><CardContent className="py-14 text-center text-muted-foreground">No {mediaType === "slideshow" ? "slideshows or images" : "videos"} are waiting for approval.</CardContent></Card>
      ) : contentSections.map((section) => (
        <section className="scroll-mt-6 space-y-4" id={section.key} key={section.key}>
          <div className="flex flex-col gap-1 border-b pb-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">{section.title}</h2>
              <p className="text-sm text-muted-foreground">{section.description}</p>
            </div>
            <Badge variant="outline">{section.items.length} awaiting review</Badge>
          </div>
          {section.items.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground">No {section.title.toLowerCase()} are waiting for review.</CardContent></Card>
          ) : section.items.map((item) => (
        <Card className="scroll-mt-28" id={item.id} key={item.id}>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>{item.hook}</CardTitle>
                <div className="mt-1 text-xs text-muted-foreground">Revision {item.revision} · {new Date(item.createdAt).toLocaleString()}</div>
              </div>
              <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                <PostStatusBadge item={item} />
                <div className="text-xs text-muted-foreground">{postStatusDetail(item)}</div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {item.mediaType === "slideshow" ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="font-medium">Instagram + TikTok slideshow</div>
                  <Badge variant="secondary">{item.slideCount}/6 slides ready · 1080×1440</Badge>
                </div>
                <SlideGallery itemId={item.id} hook={item.hook} revision={item.revision} slideCount={item.slideCount} />
                {item.slideEditor && <SlideshowSlideEditor editor={item.slideEditor} hook={item.hook} id={item.id} revision={item.revision} />}
              </div>
            ) : <div className="grid gap-4 lg:grid-cols-2">
              {(["text_music", "narrated"] as const).map((format) => {
                const available = format === "text_music" ? item.hasTextMusicVideo : item.hasNarratedVideo;
                return (
                  <div key={format} className="space-y-2">
                    <div className="font-medium">{format === "text_music" ? "Text + music account" : "Narrated Chatterbox account"}</div>
                    {available ? (
                      <video controls preload="metadata" className="aspect-[9/16] max-h-[520px] w-full rounded-lg bg-muted object-contain" src={`/api/creddy/media/${encodeURIComponent(item.id)}/${format}`} />
                    ) : <div className="flex aspect-[9/16] max-h-[520px] items-center justify-center rounded-lg bg-muted text-muted-foreground">Render missing</div>}
                  </div>
                );
              })}
            </div>}

            <div className="grid gap-4 lg:grid-cols-2">
              <div><div className="mb-1 font-medium">Script</div><ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">{item.scriptLines.map((line, index) => <li key={index}>{line}</li>)}</ol></div>
              <div className="space-y-3">
                <div><div className="mb-1 font-medium">Instagram caption</div><p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.instagramCaption}</p></div>
                <div><div className="mb-1 font-medium">TikTok caption</div><p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.tiktokCaption}</p></div>
                {item.cta && <div><div className="mb-1 font-medium">App CTA</div><p className="text-sm text-muted-foreground">{item.cta.label} → <span className="font-mono text-xs">{item.cta.deepLink}</span></p></div>}
                <div className="flex flex-wrap gap-1">{item.hashtags.map((tag) => <Badge key={tag} variant="secondary">#{tag.replace(/^#/, "")}</Badge>)}</div>
              </div>
            </div>
            {item.mediaType === "slideshow" && !item.cloudBacked && item.status !== "published" && item.status !== "rejected" && <SlideshowPublishingPanel
              accountError={blotatoAccountError}
              accounts={blotatoAccounts}
              defaultScheduledFor={defaultSchedule(24)}
              hashtags={item.hashtags}
              id={item.id}
              instagramCaption={item.instagramCaption}
              requiresExternalRejectAcknowledgement={item.destinations.some((destination) => ["pending", "submitted", "draft_sent", "blotato_draft", "scheduled", "publishing"].includes(destination.status))}
              returnTo={`/creddy/content-bank/${mediaType === "slideshow" ? "slideshows" : "videos"}`}
              tiktokCaption={item.tiktokCaption}
            />}
            <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Brief, factual claims, and evidence</summary><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.brief}</p><div className="mt-3 font-medium">Factual claims</div><ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">{item.factualClaims.map((claim, index) => <li key={`${claim.field}-${index}`}>{claim.field}: {String(claim.value)} · confidence {claim.confidence}{claim.conflict ? ` · conflict: ${claim.conflict}` : ""}</li>)}</ul><div className="mt-3 font-medium">Sources</div><ul className="mt-1 list-disc pl-5 text-sm">{item.sourceUrls.map((url) => <li key={url}><a className="underline" href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul></details>

            {item.mediaType === "video" && !item.cloudBacked ? <form action={approveCreddyAction} className="space-y-3 rounded-lg border p-4">
              <input type="hidden" name="id" value={item.id} />
              <div><div className="font-medium">Approve and schedule</div><p className="text-xs text-muted-foreground">Times use the Mac mini/dashboard timezone. Select only configured Blotato accounts.</p></div>
              <div className="grid gap-3 lg:grid-cols-2">
                {(["text_music", "narrated"] as const).flatMap((format, formatIndex) =>
                  (["instagram", "tiktok"] as const).map((platform, platformIndex) => {
                    const prefix = `${format}_${platform}`;
                    return (
                      <fieldset key={prefix} className="rounded-lg bg-muted/50 p-3">
                        <label className="flex items-center gap-2 font-medium"><input type="checkbox" name={`${prefix}_enabled`} />{platform === "instagram" ? "Instagram" : "TikTok"} · {format === "text_music" ? "text + music" : "narrated"}</label>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2"><Input name={`${prefix}_account`} placeholder="Blotato account name or ID" /><Input name={`${prefix}_scheduled_for`} type="datetime-local" defaultValue={defaultSchedule(24 + (formatIndex * 2 + platformIndex) * 3)} /></div>
                      </fieldset>
                    );
                  }),
                )}
              </div>
              <Button type="submit">Approve selected destinations</Button>
            </form> : null}

            {item.mediaType === "video" && !item.cloudBacked && item.status !== "published" && item.status !== "rejected" && (
              <form action={rejectCreddyAction} className="rounded-lg border border-destructive/25 bg-destructive/5 p-4">
                <input name="id" type="hidden" value={item.id} />
                <input name="return_to" type="hidden" value={`/creddy/content-bank/${mediaType === "slideshow" ? "slideshows" : "videos"}`} />
                <label className="text-sm font-medium" htmlFor={`review-reject-${item.id}`}>Reject this post</label>
                <p className="mt-1 text-xs text-muted-foreground">The complete post and its assets remain stored in the Rejected section.</p>
                {item.destinations.some((destination) => ["pending", "submitted", "draft_sent", "blotato_draft", "scheduled", "publishing"].includes(destination.status)) && <label className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/25 bg-background p-3 text-sm">
                  <input className="mt-0.5" name="external_delivery_cleared" required type="checkbox" />
                  <span><strong>External-delivery check:</strong> I removed or canceled this delivery in Blotato/TikTok.</span>
                </label>}
                <textarea className="mt-3 min-h-24 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" id={`review-reject-${item.id}`} maxLength={2000} minLength={5} name="reason" placeholder="Enter the reason for rejection" required />
                <Button className="mt-2" type="submit" variant="destructive">Reject and move to Rejected</Button>
              </form>
            )}

          </CardContent>
        </Card>
          ))}
        </section>
      ))}

      {scheduled.length > 0 && (
        <Card><CardHeader><CardTitle>Upcoming Creddy calendar</CardTitle></CardHeader><CardContent className="overflow-x-auto"><CreddyCalendar entries={scheduled.flatMap((item) => item.destinations.filter((destination) => destination.mode === "schedule" || destination.status === "pending" || destination.status === "scheduled").map((destination) => ({ id: item.id, hook: item.hook, ...destination })))} /></CardContent></Card>
      )}
    </div>
  );
}
