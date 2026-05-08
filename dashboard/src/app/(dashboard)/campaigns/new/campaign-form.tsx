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
import { ArrowLeft, Upload, Loader2 } from "lucide-react";
import { createCampaignAction } from "./actions";

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

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const fd = new FormData(e.currentTarget);
      const result = await createCampaignAction(fd);
      if (!result.ok) {
        setError(result.error);
        setSubmitting(false);
        return;
      }
      router.push(`/campaigns/${result.slug}`);
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
                End Date
              </label>
              <Input id="end_date" name="end_date" type="date" />
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

      {/* Posting goals + branding */}
      <Card>
        <CardContent className="pt-6 space-y-5">
          <div>
            <p className="text-base font-semibold">Posting Goals & Branding</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Targets and brand-level tagging that apply to every generated post.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="target_posts_per_week">
                Target posts / week (per account)
              </label>
              <Input
                id="target_posts_per_week"
                name="target_posts_per_week"
                type="number"
                min={1}
                max={50}
                defaultValue={3}
              />
            </div>

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
