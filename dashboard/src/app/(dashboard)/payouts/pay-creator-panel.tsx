"use client";

/**
 * Pay-this-creator panel — rendered inside the expanded payout row
 * on /payouts (and reused on /creators/[id]). Surfaces the three
 * things the admin needs to actually send money externally:
 *
 *   1. The creator's typed UPI ID — click-to-copy.
 *   2. The screenshot the creator uploaded — fetched via signed URL
 *      (the bucket is private; no public URLs ever).
 *   3. The legacy `manual_payout_notes` field (admin-typed) as a
 *      free-form fallback for creators who haven't filled the new
 *      fields yet.
 *
 * When neither UPI ID nor screenshot is set, falls back to a clear
 * "ask the creator to fill in their portal" hint so admins aren't
 * left guessing.
 */

import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Copy, Check, ImageOff, ExternalLink } from "lucide-react";

const BUCKET = "creator-payment-info";

interface Props {
  creator: {
    id: string;
    legal_name: string;
    display_name: string | null;
    preferred_processor: string;
    manual_payout_notes: string | null;
    payment_upi_id: string | null;
    payment_screenshot_path: string | null;
    payment_screenshot_uploaded_at: string | null;
  };
}

export function PayCreatorPanel({ creator }: Props) {
  const [copied, setCopied] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [signedUrlError, setSignedUrlError] = useState<string | null>(null);
  const [enlarged, setEnlarged] = useState(false);

  // Resolve the private storage path to a signed URL the browser can
  // render. 1h expiry keeps it usable for the admin's session without
  // creating a long-lived secret. Re-fetches if the path changes.
  useEffect(() => {
    if (!creator.payment_screenshot_path) {
      setSignedUrl(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const sb = createBrowserSupabase();
      const { data, error } = await sb.storage
        .from(BUCKET)
        .createSignedUrl(creator.payment_screenshot_path!, 60 * 60);
      if (cancelled) return;
      if (error) { setSignedUrlError(error.message); return; }
      setSignedUrl(data?.signedUrl ?? null);
    })();
    return () => { cancelled = true; };
  }, [creator.payment_screenshot_path]);

  async function copyUpi() {
    if (!creator.payment_upi_id) return;
    try {
      await navigator.clipboard.writeText(creator.payment_upi_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; ignore — admin can still read the value */
    }
  }

  const hasUpi = !!creator.payment_upi_id;
  const hasScreenshot = !!creator.payment_screenshot_path;
  const hasNotes = !!creator.manual_payout_notes;
  const hasNothing = !hasUpi && !hasScreenshot && !hasNotes;

  return (
    <div className="px-4 py-3 border-t border-border/50 bg-amber-50/40 dark:bg-amber-500/[0.04]">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-400 mb-2">
        Pay this creator
      </p>

      {hasNothing && (
        <div className="rounded-md border border-dashed border-amber-500/40 bg-amber-500/[0.06] px-3 py-2.5 text-xs text-amber-900 dark:text-amber-200">
          {creator.display_name || creator.legal_name} hasn&apos;t filled in their
          payment info yet. Ask them to add a UPI ID + screenshot on their
          creator portal (/creator).
        </div>
      )}

      {!hasNothing && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Left: typed payment details — UPI ID + admin notes */}
          <div className="space-y-2">
            {hasUpi && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1">
                  UPI ID
                </p>
                <button
                  type="button"
                  onClick={copyUpi}
                  className="group inline-flex items-center gap-2 rounded-md border border-border bg-background hover:bg-muted/60 px-2.5 py-1.5 text-xs font-mono w-full justify-between transition-colors"
                  title="Click to copy"
                >
                  <span className="truncate">{creator.payment_upi_id}</span>
                  {copied ? (
                    <Check className="h-3 w-3 text-emerald-600 shrink-0" />
                  ) : (
                    <Copy className="h-3 w-3 text-muted-foreground group-hover:text-foreground shrink-0" />
                  )}
                </button>
              </div>
            )}

            {hasNotes && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1">
                  Admin notes
                </p>
                <code className="block font-mono text-[11px] bg-muted/60 rounded-md px-2.5 py-1.5 break-all">
                  {creator.manual_payout_notes}
                </code>
              </div>
            )}
          </div>

          {/* Right: screenshot — preview + click-to-enlarge */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1">
              Screenshot from creator
              {creator.payment_screenshot_uploaded_at && (
                <span className="ml-1.5 normal-case tracking-normal text-[10px] text-muted-foreground/80">
                  · uploaded {new Date(creator.payment_screenshot_uploaded_at).toLocaleDateString("en-US")}
                </span>
              )}
            </p>
            {hasScreenshot && signedUrl ? (
              <button
                type="button"
                onClick={() => setEnlarged(true)}
                className="block rounded-md border border-border bg-background overflow-hidden hover:border-amber-500/40 transition-colors w-full max-w-[200px]"
                title="Click to enlarge"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={signedUrl} alt="Payment screenshot" className="block w-full h-auto" />
              </button>
            ) : hasScreenshot && signedUrlError ? (
              <p className="text-[11px] text-destructive">Couldn&apos;t load: {signedUrlError}</p>
            ) : hasScreenshot ? (
              <div className="rounded-md border border-border bg-muted/40 max-w-[200px] aspect-[3/4] flex items-center justify-center">
                <span className="text-[10px] text-muted-foreground">Loading…</span>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border bg-muted/20 max-w-[200px] aspect-[3/4] flex flex-col items-center justify-center gap-1 text-muted-foreground">
                <ImageOff className="h-4 w-4" />
                <span className="text-[10px]">No screenshot uploaded yet</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Enlarged-image overlay. Click anywhere to dismiss. */}
      {enlarged && signedUrl && (
        <div
          className="fixed inset-0 z-50 bg-background/85 backdrop-blur-md flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setEnlarged(false)}
        >
          <div className="relative max-w-3xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={signedUrl}
              alt="Payment screenshot — enlarged"
              className="rounded-lg shadow-2xl max-h-[88vh] w-auto"
            />
            <a
              href={signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute -top-3 -right-3 inline-flex items-center gap-1 rounded-full bg-background border border-border px-2.5 py-1 text-[11px] font-medium shadow-md hover:bg-muted/60"
            >
              Open in new tab <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
