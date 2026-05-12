"use client";

/**
 * /campaigns/new — campaign creation form.
 *
 * Phase 4 scope: the "Basics" section of the full edit page (name, slug,
 * description, status, dates, image + CTA upload, target posts/week,
 * branded hashtags, owner). The full 11-section edit page lands in
 * Phases 5–8 once /campaigns/[id]/edit exists.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Upload, Loader2, X, Brain, DollarSign } from "lucide-react";
import { createCampaignAction } from "./actions";
import {
  PayoutConfigFields,
  DEFAULT_PAYOUT_DRAFT,
  type PayoutConfigDraft,
} from "@/components/payout-config-fields";

// Hard cap on training images uploaded at create time. The full 25-image
// cap from the schema applies on the edit page; in the create form we
// keep it lower to bound the multipart body size (each file can be up to
// 10 MB per the bucket policy, so 15 × 10 MB = 150 MB worst case which
// is why the next.config.ts bodySizeLimit is bumped accordingly). Most
// real-world reference images are 0.5–2 MB so this is comfortable.
const MAX_TRAINING_IMAGES_AT_CREATE = 15;

function autoSlugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function CampaignForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [heroPreview, setHeroPreview] = useState<string | null>(null);
  const [ctaPreview, setCtaPreview] = useState<string | null>(null);
  // Training images live in component state because they need their own
  // file input + preview grid + remove buttons. On submit we re-attach
  // them to the FormData under name="training_images" (the action reads
  // formData.getAll('training_images')).
  const [trainingFiles, setTrainingFiles] = useState<File[]>([]);
  const [trainingPreviews, setTrainingPreviews] = useState<string[]>([]);
  // Payout config draft. Defaults to mode="none" so users who don't
  // care about payouts at create time can ignore the section — only
  // when they switch to a real mode do the validation rules kick in.
  // The draft is JSON-serialized into FormData on submit; the server
  // action upserts a campaign_payout_configs row after the campaign
  // insert lands (so the new row has an id to key by).
  const [payoutDraft, setPayoutDraft] = useState<PayoutConfigDraft>(DEFAULT_PAYOUT_DRAFT);

  // Auto-derive slug from name unless user has typed in the slug box.
  function onNameChange(v: string) {
    setName(v);
    if (!slugTouched) setSlug(autoSlugify(v));
  }

  function onFileChange(
    e: React.ChangeEvent<HTMLInputElement>,
    setPreview: (s: string | null) => void,
  ) {
    const f = e.target.files?.[0];
    if (!f) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(f);
    setPreview(url);
  }

  function onTrainingFilesAdd(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const slotsLeft = MAX_TRAINING_IMAGES_AT_CREATE - trainingFiles.length;
    if (slotsLeft <= 0) {
      setError(
        `Already at the ${MAX_TRAINING_IMAGES_AT_CREATE}-image limit at create time. ` +
        `Add the rest on the campaign's Edit page after creation (limit there is 25).`,
      );
      return;
    }
    const taking = files.slice(0, slotsLeft);
    const newPreviews = taking.map((f) => URL.createObjectURL(f));
    setTrainingFiles((prev) => [...prev, ...taking]);
    setTrainingPreviews((prev) => [...prev, ...newPreviews]);
    // Allow re-selecting the same files later.
    e.currentTarget.value = "";
  }

  function onTrainingFileRemove(idx: number) {
    setTrainingFiles((prev) => prev.filter((_, i) => i !== idx));
    setTrainingPreviews((prev) => {
      // Revoke the object URL we created so the browser can GC it.
      const u = prev[idx];
      if (u) URL.revokeObjectURL(u);
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const fd = new FormData(e.currentTarget);
      // Append every training-image file under the same key so the
      // server action reads them with formData.getAll('training_images').
      // The form's own <input type="file" multiple name="training_images">
      // is intentionally absent — we rely on component state instead so
      // we can render previews + remove buttons.
      for (const f of trainingFiles) {
        fd.append("training_images", f, f.name);
      }
      // Payout config travels as a single JSON blob — the structure
      // (multipliers + milestones as object arrays) doesn't fit
      // FormData's flat key/value model cleanly, and the server action
      // is happy to JSON.parse it once.
      fd.append("payout_config_json", JSON.stringify(payoutDraft));
      const result = await createCampaignAction(fd);
      if (!result.ok) {
        setError(result.error);
        setSubmitting(false);
        return;
      }
      // Partial-success path: the campaign was created but the payout
      // config didn't save (validation or DB error). Drop the user
      // straight on the Edit page so they can fix it without hunting,
      // and alert the reason so it doesn't get missed.
      if (result.warning) {
        // eslint-disable-next-line no-alert
        alert(result.warning);
        router.push(`/campaigns/${result.slug}/edit`);
      } else {
        router.push(`/campaigns/${result.slug}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/campaigns"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Back to campaigns"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">New Campaign</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/campaigns"
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {submitting ? "Creating…" : "Create campaign"}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="py-3">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Basics section */}
      <Card>
        <CardContent className="pt-6 space-y-5">
          <div>
            <p className="text-base font-semibold">Basics</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Campaign identity and lifecycle.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="name">
                Campaign Name <span className="text-destructive">*</span>
              </label>
              <Input
                id="name"
                name="name"
                required
                placeholder="MinuteWise App"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="slug">
                Slug
              </label>
              <Input
                id="slug"
                name="slug"
                placeholder="minutewise"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(autoSlugify(e.target.value));
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                Auto-derived from the name. Used in URLs and file paths.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="description">
              Description{" "}
              <span className="text-muted-foreground font-normal">(fed to the AI)</span>
            </label>
            <textarea
              id="description"
              name="description"
              rows={4}
              placeholder="Describe what the app does, who it's for, and the angle of the content. The AI uses this to generate every post."
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="status">
                Status
              </label>
              <Select name="status" defaultValue="active">
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="start_date">
                Start Date
              </label>
              <Input id="start_date" name="start_date" type="date" />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="end_date">
                End Date{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input id="end_date" name="end_date" type="date" />
              <p className="text-[10px] text-muted-foreground">
                Leave blank for an open-ended campaign.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Images */}
      <Card>
        <CardContent className="pt-6 space-y-5">
          <div>
            <p className="text-base font-semibold">Images</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Hero image shown on the campaign card · CTA image used as the last slide of every post.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FilePicker
              label="Hero Image"
              hint="App icon or banner"
              name="hero_image"
              preview={heroPreview}
              onChange={(e) => onFileChange(e, setHeroPreview)}
            />
            <FilePicker
              label="CTA Image"
              hint='Last-slide "download this app" graphic'
              name="cta_image"
              preview={ctaPreview}
              onChange={(e) => onFileChange(e, setCtaPreview)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Style Training Images — operator's reference set that Gemini
          Vision will distill into a style paragraph after creation.
          We accept up to 15 here at create time (full 25 on the edit
          page) to keep the multipart body within bodySizeLimit. We do
          NOT auto-distill on submit — the user clicks "Train style"
          on the edit page once when ready, per their preference for
          one-time training. */}
      <Card>
        <CardContent className="pt-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-base font-semibold flex items-center gap-2">
                <Brain className="h-4 w-4 text-muted-foreground" />
                Style Training Images <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
                Up to {MAX_TRAINING_IMAGES_AT_CREATE} reference images that show the visual style
                you want for this campaign&apos;s posts. After creating the campaign, click
                <strong> Train style</strong> on its Edit page to have Gemini analyse them once
                — every future cycle will then generate posts in that style at zero extra cost.
                You can add more (up to 25 total) on the Edit page later.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-2">
            {trainingPreviews.map((p, i) => (
              <div
                key={i}
                className="relative aspect-square rounded-md overflow-hidden border border-border/50 bg-muted/30 group"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p} alt="reference" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => onTrainingFileRemove(i)}
                  className="absolute top-1 right-1 h-6 w-6 rounded-full bg-background/90 border border-border/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}

            {trainingFiles.length < MAX_TRAINING_IMAGES_AT_CREATE && (
              <label className="aspect-square rounded-md border-2 border-dashed border-border/60 hover:border-primary/60 hover:bg-muted/40 flex flex-col items-center justify-center gap-1 text-muted-foreground cursor-pointer transition-colors text-center px-2">
                <Upload className="h-5 w-5" />
                <span className="text-[10px] font-medium">Drop / click to add</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  className="hidden"
                  onChange={onTrainingFilesAdd}
                  disabled={submitting}
                />
              </label>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            {trainingFiles.length === 0
              ? "No reference images selected. You can skip this and add them later on the Edit page."
              : `${trainingFiles.length} / ${MAX_TRAINING_IMAGES_AT_CREATE} selected — ${trainingFiles.length === MAX_TRAINING_IMAGES_AT_CREATE ? "limit reached for this form. Add the rest on Edit." : `${MAX_TRAINING_IMAGES_AT_CREATE - trainingFiles.length} slots left.`}`}
          </p>
        </CardContent>
      </Card>

      {/* Posting goals + branding */}
      <Card>
        <CardContent className="pt-6 space-y-5">
          <div>
            <p className="text-base font-semibold">Posting Goals & Branding</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Targets and brand-level tagging that apply to every generated post.
            </p>
          </div>

          {/* Target posts/week intentionally removed from campaign
              creation — defaults to 3 server-side. Adjust later on the
              campaign edit page if needed. */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="owner_email">
              Owner email{" "}
              <span className="text-muted-foreground font-normal">(report routing)</span>
            </label>
            <Input
              id="owner_email"
              name="owner_email"
              type="email"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="branded_hashtags">
              Branded hashtags{" "}
              <span className="text-muted-foreground font-normal">
                (comma-separated, always included)
              </span>
            </label>
            <Input
              id="branded_hashtags"
              name="branded_hashtags"
              placeholder="#MinuteWise, #StudyTips, #StudentLife"
            />
          </div>
        </CardContent>
      </Card>

      {/* Flow selection — exactly one flow per campaign. Cycles and
          batches for this campaign always use this flow; the operator
          doesn't pick again later. Stored in flows_enabled jsonb as
          { thisFlow: true, others: false } so the runner queries
          stay the same shape they always were. */}
      <Card>
        <CardContent className="pt-6 space-y-5">
          <div>
            <p className="text-base font-semibold">Content Flow</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Pick the one flow this campaign always uses. Every cycle and
              batch will generate posts using only this flow.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <FlowRadio
              name="primary_flow"
              value="photorealistic"
              label="Photorealistic"
              hint="Cinematic photo-style slides"
              defaultChecked
            />
            <FlowRadio
              name="primary_flow"
              value="animated"
              label="Animated"
              hint="Illustrated / Pixar / anime"
            />
            <FlowRadio
              name="primary_flow"
              value="emoji_overlay"
              label="Emoji Overlay"
              hint="Narrative arc + emoji reactions"
            />
          </div>
        </CardContent>
      </Card>

      {/* Content Generation hints */}
      <Card>
        <CardContent className="pt-6 space-y-5">
          <div>
            <p className="text-base font-semibold">Content Generation</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Hints injected into Gemini for every post. Optional — leave blank to use defaults.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="visual_style_prompt">
              Visual style prompt
            </label>
            <textarea
              id="visual_style_prompt"
              name="visual_style_prompt"
              rows={3}
              placeholder="Cinematic warm color grading, italic fonts, study-related scenes…"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="tone_of_voice">
              Tone of voice
            </label>
            <Select name="tone_of_voice" defaultValue="">
              <SelectTrigger id="tone_of_voice">
                <SelectValue placeholder="Default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="educational">Educational</SelectItem>
                <SelectItem value="playful">Playful</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="empathetic">Empathetic</SelectItem>
                <SelectItem value="inspirational">Inspirational</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/*
        Payout configuration — same UI as the edit page's payout card,
        but the parent owns the draft so it submits with the rest of
        the create payload. Defaults to mode="none" (calculator skips
        the campaign) so a manager who doesn't care about payouts at
        create time can ignore this card entirely; switching the
        Payout model to flat/cpm/hybrid/milestone reveals the relevant
        fields. The same card is also on the Edit page, so any choice
        made here is editable later — no need to "lock in" anything.
      */}
      <Card>
        <CardContent className="pt-6 space-y-5">
          <div>
            <p className="text-base font-semibold flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              Payout configuration{" "}
              <span className="text-xs font-normal text-muted-foreground">(optional)</span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
              How creators on this campaign get paid. Leave the Payout model on
              &ldquo;None&rdquo; to skip — you can configure it later from the
              campaign&apos;s Edit page.
            </p>
          </div>
          <PayoutConfigFields
            value={payoutDraft}
            onChange={setPayoutDraft}
            disabled={submitting}
          />
        </CardContent>
      </Card>
    </form>
  );
}

function FilePicker({
  label,
  hint,
  name,
  preview,
  onChange,
}: {
  label: string;
  hint: string;
  name: string;
  preview: string | null;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium">{label}</label>
      <label
        htmlFor={name}
        className="relative flex flex-col items-center justify-center w-full h-40 rounded-lg border-2 border-dashed border-border bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer overflow-hidden"
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt={`${label} preview`}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Upload className="h-6 w-6" />
            <span className="text-xs">Click to upload</span>
            <span className="text-[10px]">{hint}</span>
          </div>
        )}
      </label>
      <input
        id={name}
        name={name}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={onChange}
      />
    </div>
  );
}

/**
 * Single-select radio card for the flow picker. Renders as a clickable
 * tile so it reads more naturally than a list of plain radio inputs.
 * Native input keeps the form-data shape simple — `formData.get("primary_flow")`
 * returns the chosen value on submit.
 */
function FlowRadio({
  name,
  value,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  hint: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-start gap-2.5 rounded-md border border-input bg-background p-3 cursor-pointer hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5 transition-colors">
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="mt-1 h-3.5 w-3.5 shrink-0 accent-primary"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">{label}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{hint}</p>
      </div>
    </label>
  );
}
