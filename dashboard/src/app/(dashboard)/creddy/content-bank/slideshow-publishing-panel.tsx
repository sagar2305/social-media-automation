"use client";

import { CalendarClock, Camera, Save, Send, Upload } from "lucide-react";
import { FormEvent, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BlotatoAccount } from "@/lib/blotato";
import { rejectCreddyAction, saveCreddyDraftAction, submitCreddySlideshowAction } from "./actions";

type Props = {
  id: string;
  instagramCaption: string;
  tiktokCaption: string;
  hashtags: string[];
  accounts: BlotatoAccount[];
  accountError?: string;
  defaultScheduledFor: string;
  returnTo?: string;
  requiresExternalRejectAcknowledgement?: boolean;
};

function accountLabel(account: BlotatoAccount) {
  return `@${account.username || account.fullname || account.id} · ${account.id}`;
}

export function SlideshowPublishingPanel(props: Props) {
  const publishModeRef = useRef<HTMLInputElement>(null);
  const [instagramEnabled, setInstagramEnabled] = useState(true);
  const [tiktokEnabled, setTiktokEnabled] = useState(false);
  const instagramAccounts = props.accounts.filter((account) => account.platform === "instagram");
  const tiktokAccounts = props.accounts.filter((account) => account.platform === "tiktok");
  const defaultTikTokAccount = tiktokAccounts.find((account) => account.username?.toLowerCase() === "creddyapp")?.id || "";

  const confirmExternalAction = (event: FormEvent<HTMLFormElement>) => {
    const mode = publishModeRef.current?.value;
    if (!mode || mode === "save") return;
    const label = mode === "now" ? "publish this post now" : mode === "schedule" ? "schedule this post" : "send this post to TikTok drafts";
    if (!window.confirm(`Confirm you want to ${label} through Blotato. This is an external action and may not be reversible.`)) {
      event.preventDefault();
    }
  };

  return <>
    <form className="space-y-5 rounded-xl border bg-muted/20 p-4" onSubmit={confirmExternalAction}>
      <input name="id" type="hidden" value={props.id} />
      {props.returnTo && <input name="return_to" type="hidden" value={props.returnTo} />}
      <input name="publish_mode" ref={publishModeRef} type="hidden" value="save" />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="font-semibold">Edit and deliver</div>
          <p className="text-xs text-muted-foreground">Edit each platform caption and hashtags before choosing a destination.</p>
        </div>
        <Badge variant={props.accountError ? "destructive" : "outline"}>{props.accountError ? "Blotato unavailable" : `${props.accounts.length} live connections`}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="space-y-2 text-sm font-medium">
          <span className="flex items-center gap-2"><Camera className="size-4" /> Instagram caption</span>
          <textarea className="min-h-40 w-full rounded-md border bg-background px-3 py-2 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring" defaultValue={props.instagramCaption} maxLength={2200} name="instagram_caption" required />
        </label>
        <label className="space-y-2 text-sm font-medium">
          <span className="flex items-center gap-2"><Send className="size-4" /> TikTok caption</span>
          <textarea className="min-h-40 w-full rounded-md border bg-background px-3 py-2 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring" defaultValue={props.tiktokCaption} maxLength={2200} name="tiktok_caption" required />
        </label>
      </div>

      <label className="block space-y-2 text-sm font-medium">
        <span>Hashtags</span>
        <Input defaultValue={props.hashtags.map((tag) => `#${tag.replace(/^#+/, "")}`).join(" ")} name="hashtags" placeholder="#AwardTravel #PointsAndMiles #Creddy" />
        <span className="block text-xs font-normal text-muted-foreground">Separate hashtags with spaces or commas. They are appended to the relevant platform caption.</span>
      </label>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-background p-3">
        <Button formAction={saveCreddyDraftAction} onClick={() => { if (publishModeRef.current) publishModeRef.current.value = "save"; }} type="submit"><Save className="size-4" />Save captions &amp; hashtags</Button>
        <p className="text-xs text-muted-foreground">Saves these exact Instagram and TikTok captions locally. The saved version reloads here and is used when you later schedule or post.</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <fieldset className="space-y-3 rounded-lg border bg-background p-3">
          <label className="flex items-center gap-2 font-medium"><input checked={instagramEnabled} name="instagram_enabled" onChange={(event) => setInstagramEnabled(event.target.checked)} type="checkbox" />Instagram</label>
          <select className="h-10 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-50" defaultValue={instagramAccounts[0]?.id || ""} disabled={!instagramEnabled} name="instagram_account" required={instagramEnabled}>
            <option value="">Select connected Instagram account</option>
            {instagramAccounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
          </select>
        </fieldset>
        <fieldset className="space-y-3 rounded-lg border bg-background p-3">
          <label className="flex items-center gap-2 font-medium"><input checked={tiktokEnabled} name="tiktok_enabled" onChange={(event) => setTiktokEnabled(event.target.checked)} type="checkbox" />TikTok</label>
          <select className="h-10 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-50" defaultValue={defaultTikTokAccount} disabled={!tiktokEnabled} name="tiktok_account" required={tiktokEnabled}>
            <option value="">Select connected TikTok account</option>
            {tiktokAccounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
          </select>
        </fieldset>
      </div>

      {props.accountError && <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{props.accountError}</p>}

      <label className="block max-w-sm space-y-2 text-sm font-medium">
        <span>Calendar date and time</span>
        <Input defaultValue={props.defaultScheduledFor} name="scheduled_for" type="datetime-local" />
      </label>

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button disabled={Boolean(props.accountError)} formAction={submitCreddySlideshowAction} onClick={() => { if (publishModeRef.current) publishModeRef.current.value = "schedule"; }} type="submit"><CalendarClock className="size-4" />Schedule on calendar</Button>
        <Button disabled={Boolean(props.accountError)} formAction={submitCreddySlideshowAction} onClick={() => { if (publishModeRef.current) publishModeRef.current.value = "now"; }} type="submit"><Upload className="size-4" />Post now</Button>
        <Button disabled={Boolean(props.accountError) || !tiktokEnabled || instagramEnabled} formAction={submitCreddySlideshowAction} onClick={() => { if (publishModeRef.current) publishModeRef.current.value = "tiktok_draft"; }} type="submit" variant="secondary"><Save className="size-4" />Send to TikTok drafts</Button>
      </div>
      <p className="text-xs text-muted-foreground">Local draft never contacts Blotato. Schedule, Post now, and TikTok draft always ask for confirmation before any external submission. Instagram drafts remain local because Blotato documents draft delivery only for TikTok.</p>
    </form>
    <form
      action={rejectCreddyAction}
      className="rounded-xl border border-destructive/30 bg-destructive/5 p-4"
      onSubmit={(event) => {
        if (!window.confirm("Reject this post and move it to the Rejected section?")) event.preventDefault();
      }}
    >
      <input name="id" type="hidden" value={props.id} />
      <input name="return_to" type="hidden" value={props.returnTo || "/creddy/content-bank/slideshows"} />
      <div className="font-semibold text-destructive">Reject this post</div>
      <p className="mt-1 text-xs text-muted-foreground">The post and all six images remain stored and move to the Rejected section.</p>
      {props.requiresExternalRejectAcknowledgement && <label className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/25 bg-background p-3 text-sm">
        <input className="mt-0.5" name="external_delivery_cleared" required type="checkbox" />
        <span><strong>External-delivery check:</strong> I removed or canceled this delivery in Blotato/TikTok. Rejecting here cannot cancel an already-submitted Blotato schedule.</span>
      </label>}
      <textarea className="mt-3 min-h-24 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" maxLength={2000} minLength={5} name="reason" placeholder="Enter the reason for rejection" required />
      <Button className="mt-2" type="submit" variant="destructive">Reject and move to Rejected</Button>
    </form>
  </>;
}
