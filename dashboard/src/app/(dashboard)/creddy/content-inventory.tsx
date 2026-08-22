"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { CalendarClock, Camera, ExternalLink, Maximize2, RotateCcw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { CreddyBankItemDto, CreddyDestination } from "@/lib/creddy-file-store";
import { cn } from "@/lib/utils";
import { rejectCreddyAction, restoreRejectedCreddyAction } from "./content-bank/actions";
import { PostStatusBadge, postStatusDetail } from "./post-status";

export function CreddyContentInventory({
  items,
  emptyMessage,
}: {
  items: CreddyBankItemDto[];
  emptyMessage: string;
}) {
  const [selected, setSelected] = useState<CreddyBankItemDto | null>(null);

  if (items.length === 0) {
    return <Card><CardContent className="py-14 text-center text-muted-foreground">{emptyMessage}</CardContent></Card>;
  }

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-2">
        {items.map((item, itemIndex) => (
          <button key={item.id} type="button" onClick={() => setSelected(item)} className="text-left">
            <Card className="h-full transition hover:border-primary/40 hover:shadow-md">
              <CardContent className="flex gap-4 p-4">
                <PostPreview eager={itemIndex === 0} item={item} />
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <PostStatusBadge item={item} />
                    <Badge variant="outline">{item.mediaType === "slideshow" ? `${item.slideCount} slides` : "Video"}</Badge>
                  </div>
                  <div>
                    <h2 className="line-clamp-2 font-semibold leading-snug">{item.hook}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">Created {formatDate(item.createdAt)} · Revision {item.revision}</p>
                    <p className="mt-1 text-xs font-medium text-foreground/75">{postStatusDetail(item)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {item.destinations.length === 0
                      ? <Badge variant="secondary">Not delivered yet</Badge>
                      : item.destinations.map((destination, index) => (
                        <Badge key={`${destination.platform}-${destination.account}-${index}`} variant="secondary">
                          {destination.platform} · {humanize(destination.status)}
                        </Badge>
                      ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      {selected && <PostDetail item={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function PostPreview({ item, eager = false }: { item: CreddyBankItemDto; eager?: boolean }) {
  if (item.hasSlideshow) {
    return (
      <Image
        src={`/api/creddy/slides/${encodeURIComponent(item.id)}/1`}
        alt="First slideshow image"
        width={108}
        height={144}
        unoptimized
        loading={eager ? "eager" : "lazy"}
        className="h-36 w-[108px] shrink-0 rounded-lg border object-cover"
      />
    );
  }
  return <div className="flex h-36 w-[108px] shrink-0 items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground">Video post</div>;
}

function PostDetail({ item, onClose }: { item: CreddyBankItemDto; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-label="Content details" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border bg-background shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-background/95 p-5 backdrop-blur">
          <div><PostStatusBadge item={item} /><h2 className="mt-2 text-xl font-semibold">{item.hook}</h2><p className="mt-1 text-xs text-muted-foreground">{postStatusDetail(item)}</p></div>
          <Button type="button" variant="outline" size="icon" onClick={onClose} aria-label="Close details"><X className="size-4" /></Button>
        </div>
        <div className="grid gap-6 p-5 lg:grid-cols-[220px_1fr]">
          {item.hasSlideshow ? <SlideshowDetailPreview item={item} /> : <PostPreview item={item} />}
          <div className={`space-y-5 ${item.hasSlideshow ? "lg:col-span-2" : ""}`}>
            <Detail label="Instagram caption" value={item.instagramCaption} />
            <Detail label="TikTok caption" value={item.tiktokCaption} />
            <Detail label="Hashtags" value={item.hashtags.join(" ")} />
            {item.status === "rejected" && <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3">
              <h3 className="text-sm font-semibold text-destructive">Rejection details</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{item.rejectionReason || "No reason recorded."}</p>
              {item.rejectedAt && <p className="mt-1 text-xs text-muted-foreground">Rejected {formatDate(item.rejectedAt)}</p>}
            </div>}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Delivery history</h3>
              {item.destinations.length === 0 ? <p className="text-sm text-muted-foreground">No delivery has been created for this post.</p> : (
                <div className="space-y-2">{item.destinations.map((destination, index) => <DestinationDetail key={index} destination={destination} />)}</div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link className={buttonVariants()} href={`/creddy/content-bank/${item.mediaType === "slideshow" ? "slideshows" : "videos"}?item=${encodeURIComponent(item.id)}#${encodeURIComponent(item.id)}`}>Open in Review Queue</Link>
              {item.sourceUrls[0] && <a className={cn(buttonVariants({ variant: "outline" }))} href={item.sourceUrls[0]} target="_blank" rel="noreferrer">Open source <ExternalLink className="ml-2 size-4" /></a>}
            </div>
            {item.status === "rejected" && <form action={restoreRejectedCreddyAction} onSubmit={(event) => {
              if (!window.confirm("Undo this rejection and restore the post to the Review Queue?")) event.preventDefault();
            }}>
              <input name="id" type="hidden" value={item.id} />
              <input name="media_type" type="hidden" value={item.mediaType} />
              <Button type="submit"><RotateCcw className="size-4" />Undo rejection and restore</Button>
              <p className="mt-2 text-xs text-muted-foreground">Restores the post and assets to the Review Queue. It does not publish, schedule, or contact Blotato.</p>
            </form>}
            {(item.status === "pending_review" || item.status === "changes_requested") && (
              <form action={rejectCreddyAction} className="rounded-xl border border-destructive/25 bg-destructive/5 p-4">
                <input type="hidden" name="id" value={item.id} />
                <label htmlFor={`reject-${item.id}`} className="text-sm font-semibold">Reject this content</label>
                <p className="mt-1 text-xs text-muted-foreground">The post stays stored with its assets and reason, and moves into the Rejected section.</p>
                <textarea id={`reject-${item.id}`} name="reason" required minLength={5} maxLength={2000} placeholder="Enter the reason for rejection" className="mt-3 min-h-24 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30" />
                <Button type="submit" variant="destructive" className="mt-2">Reject and move to Rejected</Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SlideshowDetailPreview({ item }: { item: CreddyBankItemDto }) {
  const [openSlide, setOpenSlide] = useState<number | null>(null);
  const openSlideUrl = openSlide === null ? "" : `/api/creddy/slides/${encodeURIComponent(item.id)}/${openSlide + 1}`;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-2 lg:grid-cols-6">
        {Array.from({ length: item.slideCount }, (_, index) => (
          <div className="space-y-1" key={index}>
            <button
              aria-label={`Open slide ${index + 1} full size`}
              className="group relative block w-full cursor-zoom-in overflow-hidden rounded-lg border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setOpenSlide(index)}
              type="button"
            >
              <Image
                src={`/api/creddy/slides/${encodeURIComponent(item.id)}/${index + 1}`}
                alt={`Slide ${index + 1} of ${item.hook}`}
                width={180}
                height={240}
                unoptimized
                loading="eager"
                className="aspect-[3/4] w-full object-cover transition group-hover:scale-[1.02]"
              />
              <span className="absolute inset-x-2 bottom-2 flex items-center justify-center gap-1 rounded-md bg-black/70 px-2 py-1 text-xs font-medium text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"><Maximize2 className="size-3.5" />Open image</span>
            </button>
            <p className="text-center text-xs text-muted-foreground">Slide {index + 1}</p>
          </div>
        ))}
      </div>

      {openSlide !== null && <div
        aria-label={`Full-size slide ${openSlide + 1}`}
        aria-modal="true"
        className="fixed inset-0 z-[70] flex flex-col bg-black/95 p-4"
        onMouseDown={(event) => { if (event.target === event.currentTarget) setOpenSlide(null); }}
        role="dialog"
      >
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 pb-3 text-white">
          <div className="font-medium">Slide {openSlide + 1} of {item.slideCount}</div>
          <div className="flex items-center gap-2">
            <a className={cn(buttonVariants({ variant: "secondary" }))} href={openSlideUrl} rel="noreferrer" target="_blank">Open original <ExternalLink className="ml-2 size-4" /></a>
            <Button aria-label="Close full-size image" onClick={() => setOpenSlide(null)} size="icon" type="button" variant="secondary"><X className="size-5" /></Button>
          </div>
        </div>
        <div className="min-h-0 flex-1" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpenSlide(null); }}>
          <Image
            alt={`Full-size slide ${openSlide + 1} of ${item.hook}`}
            className="mx-auto h-full w-auto max-w-full rounded-lg object-contain"
            height={1440}
            priority
            src={openSlideUrl}
            unoptimized
            width={1080}
          />
        </div>
      </div>}
    </>
  );
}

function DestinationDetail({ destination }: { destination: CreddyDestination }) {
  const PlatformIcon = destination.platform === "instagram" ? Camera : CalendarClock;
  const time = destination.publishedAt ?? destination.submittedAt ?? destination.scheduledFor;
  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2"><PlatformIcon className="size-4" /><span className="font-medium capitalize">{destination.platform}</span><Badge variant="secondary">{humanize(destination.status)}</Badge><span className="text-muted-foreground">{destination.account}</span></div>
      {time && <p className="mt-1 text-xs text-muted-foreground">{formatDate(time)}</p>}
      {destination.error && <p className="mt-2 text-destructive">{destination.error}</p>}
      {destination.publishedUrl && <a className="mt-2 inline-flex items-center text-primary hover:underline" href={destination.publishedUrl} target="_blank" rel="noreferrer">View published post <ExternalLink className="ml-1 size-3.5" /></a>}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><h3 className="mb-1 text-sm font-semibold">{label}</h3><p className="whitespace-pre-wrap text-sm text-muted-foreground">{value || "—"}</p></div>;
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
