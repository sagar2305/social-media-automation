"use client";

/**
 * Creator-portal card for managing payment-receiving info: a typed
 * UPI ID + a screenshot of the creator's PhonePe/GPay/etc. The
 * screenshot uploads directly to Supabase Storage from the browser
 * — RLS policies on `storage.objects` scope each creator to their
 * own folder, so a malicious creator can't overwrite somebody else's
 * file even if they fish the bucket name out of the bundle.
 *
 * After a successful upload, we call `updateMyPaymentInfo` (server
 * action gated by assertCreator) to record the new storage path on
 * the creators row + stamp uploaded_at. Admin views resolve the
 * stored path to a short-lived signed URL — the image is never
 * publicly accessible.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, CheckCircle2, Trash2, AlertCircle, CreditCard, RotateCcw } from "lucide-react";
import { updateMyPaymentInfo } from "../../(dashboard)/payouts/actions";

const BUCKET = "creator-payment-info";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

interface Props {
  creatorId: string;
  initialUpiId: string | null;
  initialScreenshotPath: string | null;
  initialUploadedAt: string | null;
}

export function PaymentInfoCard({
  creatorId,
  initialUpiId,
  initialScreenshotPath,
  initialUploadedAt,
}: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [upiId, setUpiId] = useState(initialUpiId ?? "");
  const [screenshotPath, setScreenshotPath] = useState(initialScreenshotPath);
  const [uploadedAt, setUploadedAt] = useState(initialUploadedAt);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [busy, setBusy] = useState<"idle" | "uploading" | "saving" | "deleting">("idle");
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Fetch a signed URL for the existing screenshot on mount + whenever
  // screenshotPath changes. Signed URLs expire (we ask for 1h) which
  // is plenty for a session; we re-fetch on refocus to be safe.
  useEffect(() => {
    if (!screenshotPath) { setPreviewUrl(null); return; }
    let cancelled = false;
    (async () => {
      const sb = createBrowserSupabase();
      const { data } = await sb.storage.from(BUCKET).createSignedUrl(screenshotPath, 60 * 60);
      if (!cancelled) setPreviewUrl(data?.signedUrl ?? null);
    })();
    return () => { cancelled = true; };
  }, [screenshotPath]);

  // Local mirror of "what's on the server" so we can update the
  // unsaved hint without depending on the prop changing (props only
  // refresh on a hard page reload, not after router.refresh()).
  const [savedUpiId, setSavedUpiId] = useState(initialUpiId ?? "");
  const reallyDirty = (upiId || "") !== (savedUpiId || "");

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    // Client-side guards. The bucket also enforces these at the
    // storage layer (file_size_limit + allowed_mime_types) but
    // failing early gives the creator a clearer message.
    if (!ALLOWED.includes(file.type)) {
      setError(`Pick a JPG, PNG, or WebP. Got ${file.type || "unknown type"}.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`Screenshot is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 5 MB.`);
      return;
    }

    setBusy("uploading");
    try {
      const sb = createBrowserSupabase();
      // Single-file convention: always overwrite at `<creator_id>/screenshot.<ext>`.
      // upsert=true so re-uploads replace cleanly without a name collision.
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${creatorId}/screenshot.${ext}`;
      const { error: upErr } = await sb.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      // Persist the path on the creator row so the admin views can find it.
      const r = await updateMyPaymentInfo({ screenshot_path: path });
      if (!r.ok) throw new Error(r.error);

      setScreenshotPath(path);
      setUploadedAt(new Date().toISOString());
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("idle");
      // Reset the input so the same file can be re-picked if needed.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function onSaveUpi() {
    // No-op when nothing changed — avoids spurious server calls on
    // blur after a save or when focus moves through the input without
    // edits. Also short-circuits when we're already saving.
    if (!reallyDirty || busy === "saving") return;
    setError(null);
    setBusy("saving");
    const r = await updateMyPaymentInfo({ upi_id: upiId });
    setBusy("idle");
    if (!r.ok) { setError(r.error); return; }
    setSavedUpiId(upiId);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
    router.refresh();
  }

  // Save when the user navigates away from the input — covers the
  // common "typed it and forgot to click Save" mistake. Also handles
  // Enter so the form feels native to keyboard users.
  function onUpiKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onSaveUpi();
    }
  }

  async function onDeleteScreenshot() {
    if (!screenshotPath) return;
    if (!confirm("Remove your saved screenshot?\n\nYour admin won't see it anymore until you upload a new one.")) return;
    setError(null);
    setBusy("deleting");
    // Soft-delete from the DB only — leave the storage object so the
    // admin keeps a record. (RLS prevents the creator from physically
    // deleting it anyway.)
    const r = await updateMyPaymentInfo({ cleared_screenshot: true });
    setBusy("idle");
    if (!r.ok) { setError(r.error); return; }
    setScreenshotPath(null);
    setUploadedAt(null);
    setPreviewUrl(null);
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-5">
      <div className="flex items-center gap-2">
        <CreditCard className="h-3.5 w-3.5 text-emerald-700/80 dark:text-emerald-400/80" />
        <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-700/80 dark:text-emerald-400/80">
          Your payment details
        </p>
        {savedFlash && (
          <span className="ml-auto text-xs text-emerald-600 font-medium inline-flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground -mt-3">
        Your admin uses this to actually send your payments. They&apos;ll see your UPI ID and the screenshot below.
      </p>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      {/* UPI ID — saves on blur, on Enter, or on Save click. Multiple
          save triggers so the value never gets lost to a forgotten click. */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium" htmlFor="upi">UPI ID</label>
        <div className="flex gap-2">
          <Input
            id="upi"
            value={upiId}
            onChange={(e) => setUpiId(e.target.value)}
            onBlur={onSaveUpi}
            onKeyDown={onUpiKeyDown}
            placeholder="yourname@oksbi or 9876543210@paytm"
          />
          <Button
            type="button"
            onClick={onSaveUpi}
            disabled={!reallyDirty || busy !== "idle"}
            size="sm"
          >
            {busy === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
          </Button>
        </div>
        <p className={`text-[11px] ${reallyDirty ? "text-amber-700 dark:text-amber-400 font-medium" : "text-muted-foreground"}`}>
          {reallyDirty
            ? "Unsaved changes — click Save, press Enter, or click away to save."
            : <>The handle your admin types into their banking app. e.g. <code className="font-mono">name@oksbi</code>.</>}
        </p>
      </div>

      {/* Screenshot upload + preview */}
      <div className="space-y-2 pt-2 border-t border-border/60">
        <label className="text-xs font-medium">Payment screenshot</label>
        <p className="text-[11px] text-muted-foreground">
          A clear screenshot of your PhonePe / GPay / Paytm showing your UPI ID + QR. PNG, JPG, or WebP. Max 5 MB.
        </p>

        {previewUrl ? (
          <div className="space-y-2">
            <div className="relative rounded-lg border border-border bg-muted/30 overflow-hidden max-w-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="Your saved payment screenshot"
                className="block w-full h-auto"
              />
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {uploadedAt && (
                <>Uploaded {new Date(uploadedAt).toLocaleDateString("en-US")}</>
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy !== "idle"}
                className="inline-flex items-center gap-1 text-foreground hover:underline disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" /> Replace
              </button>
              <button
                type="button"
                onClick={onDeleteScreenshot}
                disabled={busy !== "idle"}
                className="inline-flex items-center gap-1 text-destructive hover:underline disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" /> Remove
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy !== "idle"}
            className="w-full max-w-xs inline-flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border/60 bg-muted/20 hover:bg-muted/40 transition-colors py-8 px-4 text-sm disabled:opacity-50"
          >
            {busy === "uploading" ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <Upload className="h-5 w-5 text-muted-foreground" />
            )}
            <span className="font-medium">
              {busy === "uploading" ? "Uploading…" : "Click to upload screenshot"}
            </span>
            <span className="text-[11px] text-muted-foreground">PNG / JPG / WebP · max 5 MB</span>
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED.join(",")}
          className="hidden"
          onChange={onPickFile}
        />
      </div>
    </div>
  );
}
