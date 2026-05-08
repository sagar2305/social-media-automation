"use client";

/**
 * Campaign edit form — minimal, focused on the most-edited fields.
 *
 * Loads the campaign server-side (parent page) and feeds the initial
 * values down. Submits via the updateCampaignAction server action.
 * On success, navigates back to the campaign detail.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2 } from "lucide-react";
import type { Campaign } from "@/lib/types";
import { updateCampaignAction } from "./actions";

export function EditCampaignForm({ campaign }: { campaign: Campaign }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("slug", campaign.slug);
    const result = await updateCampaignAction(fd);
    if (!result.ok) {
      setError(result.error);
      setSubmitting(false);
      return;
    }
    router.push(`/campaigns/${campaign.slug}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/campaigns/${campaign.slug}`}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Back to campaign"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">
            Edit {campaign.name}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/campaigns/${campaign.slug}`}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {/* Basics */}
      <Card>
        <CardContent className="pt-6 space-y-5">
          <Section title="Basics" hint="Identity, lifecycle, and status." />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Campaign Name" required>
              <Input name="name" defaultValue={campaign.name} required />
            </Field>
            <Field label="Slug" hint="Read-only — fixed at creation.">
              <Input value={campaign.slug} disabled />
            </Field>
          </div>
          <Field label="Description (fed to the AI)">
            <textarea
              name="description"
              rows={4}
              defaultValue={campaign.description ?? ""}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
          </Field>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Status">
              <Select name="status" defaultValue={campaign.status}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Start Date">
              <Input name="start_date" type="date" defaultValue={campaign.start_date ?? ""} />
            </Field>
            <Field label="End Date">
              <Input name="end_date" type="date" defaultValue={campaign.end_date ?? ""} />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* Content Generation */}
      <Card>
        <CardContent className="pt-6 space-y-5">
          <Section
            title="Content Generation"
            hint="Hints injected into Gemini for every post."
          />
          <Field label="Visual style prompt">
            <textarea
              name="visual_style_prompt"
              rows={3}
              defaultValue={campaign.visual_style_prompt ?? ""}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
          </Field>
          <Field label="Tone of voice">
            <Select name="tone_of_voice" defaultValue={campaign.tone_of_voice ?? ""}>
              <SelectTrigger>
                <SelectValue placeholder="Default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Default</SelectItem>
                <SelectItem value="educational">Educational</SelectItem>
                <SelectItem value="playful">Playful</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="empathetic">Empathetic</SelectItem>
                <SelectItem value="inspirational">Inspirational</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>

      {/* Hashtags */}
      <Card>
        <CardContent className="pt-6 space-y-5">
          <Section
            title="Hashtags"
            hint="Comma- or newline-separated. # is auto-prefixed."
          />
          <Field label="Branded (always included)">
            <Input
              name="branded_hashtags"
              defaultValue={(campaign.branded_hashtags ?? []).join(", ")}
              placeholder="#MinuteWise, #StudyTips"
            />
          </Field>
          <Field label="Tracked (monitor performance)">
            <Input
              name="tracked_hashtags"
              defaultValue={(campaign.tracked_hashtags ?? []).join(", ")}
              placeholder="#studytok, #ainotetaker"
            />
          </Field>
        </CardContent>
      </Card>

      {/* Posting Goals */}
      <Card>
        <CardContent className="pt-6 space-y-5">
          <Section title="Posting Goals" hint="Per-account weekly target." />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Target posts/week (per account)">
              <Input
                name="target_posts_per_week"
                type="number"
                min={1}
                max={50}
                defaultValue={campaign.target_posts_per_week}
              />
            </Field>
            <Field label="Owner email">
              <Input
                name="owner_email"
                type="email"
                defaultValue={campaign.owner_email ?? ""}
                placeholder="you@example.com"
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* AI Brain */}
      <Card>
        <CardContent className="pt-6 space-y-5">
          <Section
            title="AI Brain"
            hint="Autoresearch designs daily/weekly experiments for this campaign."
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Enabled">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="autoresearch_enabled"
                  defaultChecked={campaign.autoresearch_enabled}
                  className="h-4 w-4 rounded border-input"
                />
                <span className="text-sm">Run autoresearch for this campaign</span>
              </label>
            </Field>
            <Field label="Cadence">
              <Select
                name="autoresearch_cadence"
                defaultValue={campaign.autoresearch_cadence}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="every_2_days">Every 2 days</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* Email Reports */}
      <Card>
        <CardContent className="pt-6 space-y-5">
          <Section
            title="Email Reports"
            hint="Resend-powered digests. Configure RESEND_API_KEY on the server."
          />
          <Field label="Recipients (comma- or newline-separated)">
            <textarea
              name="email_recipients"
              rows={2}
              defaultValue={(campaign.email_recipients ?? []).join(", ")}
              placeholder="you@example.com, team@example.com"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
          </Field>
          <Field label="Frequency">
            <Select name="email_frequency" defaultValue={campaign.email_frequency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Every day</SelectItem>
                <SelectItem value="weekly">Every Monday</SelectItem>
                <SelectItem value="monthly">First of the month</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>
    </form>
  );
}

function Section({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <p className="text-base font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
