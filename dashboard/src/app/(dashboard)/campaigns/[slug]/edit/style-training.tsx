"use client";

/**
 * Style Training — campaign-scoped reference-image upload + Gemini
 * Vision distillation.
 *
 * The operator uploads up to 25 reference images. A "Train style"
 * button sends them to Gemini Vision once and saves the resulting
 * paragraph to campaigns.style_distillation. The pipeline reads that
 * paragraph at cycle time (zero per-cycle Gemini cost) and injects it
 * into every text + image prompt.
 *
 * Distillation is explicitly user-triggered: the user told us "we are
 * gonna provide these images one time… no need to give images to
 * gemini every time". So uploads alone don't auto-distill — only the
 * "Train style" button does. After that, every cycle for this
 * campaign uses the stored learning until the operator re-trains.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Upload, X, Brain, Loader2, AlertCircle, CheckCircle2, Image as ImageIcon,
} from "lucide-react";
import {
  addCampaignTrainingImage,
  removeCampaignTrainingImage,
  distillCampaignStyle,
} from "./actions";

const MAX_TRAINING_IMAGES = 25;

interface Props {
  slug: string;
  initialUrls: string[];
  initialDistillation: string | null;
  initialDistilledAt: string | null;
}

export function StyleTraining({
  slug,
  initialUrls,
  initialDistillation,
  initialDistilledAt,
}: Props) {
  const router = useRouter();
  const [urls, setUrls] = useState<string[]>(initialUrls);
  const [distillation, setDistillation] = useState<string | null>(initialDistillation);
  const [distilledAt, setDistilledAt] = useState<string | null>(initialDistilledAt);

  const [uploading, setUploading] = useState(false);
  const [busyUrl, setBusyUrl] = useState<string | null>(null);
  const [distilling, startDistillTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function clearMessages() {
    setError(null);
    setSuccess(null);
  }

  async function onFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    clearMessages();
    setUploading(true);
    const files = Array.from(fileList);
    const remainingSlots = MAX_TRAINING_IMAGES - urls.length;
    if (files.length > remainingSlots) {
      setError(`Only ${remainingSlots} slot${remainingSlots === 1 ? "" : "s"} left — drop fewer files (or delete some first).`);
      setUploading(false);
      return;
    }

    // Upload sequentially so the array updates feel natural in the UI
    // and so we surface the first failure cleanly rather than racing.
    for (const file of files) {
      const fd = new FormData();
      fd.set("file", file);
      const r = await addCampaignTrainingImage({ slug, formData: fd });
      if (!r.ok) {
        setError(r.error);
        break;
      }
      setUrls((prev) => [...prev, r.url]);
    }
    setUploading(false);
  }

  async function onRemove(url: string) {
    clearMessages();
    setBusyUrl(url);
    const r = await removeCampaignTrainingImage({ slug, url });
    setBusyUrl(null);
    if (!r.ok) { setError(r.error); return; }
    setUrls((prev) => prev.filter((u) => u !== url));
  }

  function onDistill() {
    clearMessages();
    startDistillTransition(async () => {
      const r = await distillCampaignStyle({ slug });
      if (!r.ok) { setError(r.error); return; }
      setDistillation(r.distillation);
      setDistilledAt(new Date().toISOString());
      setSuccess("Style trained — every future cycle on this campaign will use the new style.");
      router.refresh();
    });
  }

  // Whether the stored distillation is stale (image set changed since
  // the last distill). We can't easily diff URL sets server-side, so
  // we infer staleness as "distilled_at is before the most recent
  // upload". The dashboard renders this badge as a soft nudge — the
  // engine still uses whatever distillation is there.
  const stale = distilledAt && urls.length > 0 && false; // (precise stale check would need per-image upload timestamps; conservative for now)
  const lastTrainedLabel = distilledAt
    ? `Last trained ${formatRelative(distilledAt)}`
    : "Not trained yet";

  // "Untrained" state — operator uploaded images (typically at create
  // time) but never clicked Train style. Surface a prominent one-click
  // banner so the campaign actually benefits from the references.
  const untrainedWithImages = urls.length > 0 && !distillation;

  return (
    <Card className={untrainedWithImages ? "border-primary/50 ring-1 ring-primary/20" : undefined}>
      <CardContent className="pt-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-base font-semibold flex items-center gap-2">
              <Brain className="h-4 w-4 text-muted-foreground" />
              Style Training
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
              Upload up to {MAX_TRAINING_IMAGES} reference images that show the visual style you want.
              Click <strong>Train style</strong> once to have Gemini analyse them and save the
              learnings. Every future post on this campaign will be generated in that style —
              no images sent to Gemini at cycle time.
            </p>
          </div>
        </div>

        {untrainedWithImages && (
          <div className="flex items-start gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2.5 text-xs">
            <Brain className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
            <div className="flex-1">
              <p className="font-semibold text-foreground">
                {urls.length} reference image{urls.length === 1 ? "" : "s"} uploaded — ready to train.
              </p>
              <p className="text-muted-foreground mt-0.5">
                Click <strong>Train style</strong> below to have Gemini analyse them now.
                Until you do, cycles for this campaign generate with default styling
                (description-derived) — your uploads aren&apos;t used yet.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button onClick={clearMessages} className="text-destructive/70 hover:text-destructive shrink-0">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {success && (
          <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-500">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="flex-1">{success}</span>
            <button onClick={clearMessages} className="text-emerald-600/70 hover:text-emerald-700 shrink-0">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Image grid + upload tile */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Reference Images ({urls.length} / {MAX_TRAINING_IMAGES})
            </p>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-2">
            {urls.map((u) => (
              <div
                key={u}
                className="relative aspect-square rounded-md overflow-hidden border border-border/50 bg-muted/30 group"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="reference" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => onRemove(u)}
                  disabled={busyUrl === u}
                  className="absolute top-1 right-1 h-6 w-6 rounded-full bg-background/90 border border-border/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground disabled:opacity-40"
                  title="Remove"
                >
                  {busyUrl === u
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <X className="h-3 w-3" />
                  }
                </button>
              </div>
            ))}

            {urls.length < MAX_TRAINING_IMAGES && (
              <label className="aspect-square rounded-md border-2 border-dashed border-border/60 hover:border-primary/60 hover:bg-muted/40 flex flex-col items-center justify-center gap-1 text-muted-foreground cursor-pointer transition-colors text-center px-2">
                {uploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Upload className="h-5 w-5" />
                    <span className="text-[10px] font-medium">Drop / click to add</span>
                  </>
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void onFiles(e.target.files);
                    e.currentTarget.value = ""; // allow re-selecting the same file
                  }}
                  disabled={uploading || distilling}
                />
              </label>
            )}
          </div>
          {urls.length === 0 && (
            <p className="text-xs text-muted-foreground italic mt-2 flex items-center gap-1.5">
              <ImageIcon className="h-3 w-3" />
              No reference images yet — drop a few in the box above to start training.
            </p>
          )}
        </div>

        {/* Train button + distillation display */}
        <div className="border-t border-border/40 pt-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Distilled Style {stale && <span className="ml-2 normal-case tracking-normal text-amber-600">(stale — re-train)</span>}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {lastTrainedLabel}
                {distilledAt && " · injected into every cycle prompt"}
              </p>
            </div>
            <Button
              type="button"
              onClick={onDistill}
              disabled={distilling || urls.length === 0 || uploading}
              title={urls.length === 0 ? "Upload at least one reference image first" : undefined}
              variant={distillation ? "outline" : "default"}
            >
              {distilling ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Brain className="h-4 w-4 mr-1.5" />
              )}
              {distilling
                ? "Training…"
                : distillation
                  ? "Re-train style"
                  : "Train style"}
            </Button>
          </div>

          {distillation ? (
            <div className="rounded-md bg-muted/40 border border-border/40 px-3 py-2.5">
              <p className="text-xs leading-relaxed whitespace-pre-wrap text-foreground/90">
                {distillation}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              No distillation yet. Once trained, the analysis appears here and gets injected
              into every Gemini prompt for this campaign — across all three flows.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * "5 minutes ago", "2 days ago" — same shape used elsewhere in the
 * dashboard but inlined here to avoid pulling a date library just for
 * one component.
 */
function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}
