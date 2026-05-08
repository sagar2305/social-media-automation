"use client";

/**
 * Campaign share menu — replaces the disabled placeholder Share button
 * in the hero. Pops a dropdown with three actions:
 *
 *   - Copy gallery link    → creates / reuses a share_links row with
 *                            link_type='gallery' for this campaign
 *   - Copy public link     → link_type='dashboard' (legacy default)
 *   - Copy overview link   → link_type='overview'  (briefing view)
 *
 * Each action: insert (or reuse existing) a share_links row, then write
 * the resulting public URL to the clipboard. A short "Copied ✓" badge
 * confirms.
 *
 * Reuse rule: if a non-expired share link of the same (campaign_id,
 * link_type) already exists, we reuse its token instead of generating a
 * new one. Keeps the URL stable so links you've already pasted into
 * Slack don't suddenly 404.
 */

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import {
  Share2, Check, Loader2, Images, BarChart3, FileText, ExternalLink,
} from "lucide-react";

interface Props {
  campaignId: string;
  campaignSlug: string;
  campaignName: string;
}

type LinkType = "gallery" | "dashboard" | "overview";

interface MenuOption {
  type: LinkType;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
}

const OPTIONS: MenuOption[] = [
  {
    type: "gallery",
    Icon: Images,
    label: "Gallery link",
    hint: "Visual grid of every post — for stakeholders / investors",
  },
  {
    type: "dashboard",
    Icon: BarChart3,
    label: "Public dashboard link",
    hint: "Read-only KPIs + Views chart",
  },
  {
    type: "overview",
    Icon: FileText,
    label: "Overview link",
    hint: "Campaign brief — description, branded tags, top performers",
  },
];

function genToken(): string {
  // 16 chars from the URL-safe alphabet; collision probability negligible
  // at our scale and avoids a server round-trip.
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function CampaignShareMenu({ campaignId, campaignSlug, campaignName }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<LinkType | null>(null);
  const [copied, setCopied] = useState<LinkType | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(type: LinkType) {
    setBusy(type);
    setError(null);
    setCopied(null);

    try {
      const sb = createBrowserSupabase();

      // Reuse an existing non-expired link of this (campaign_id, link_type)
      // so the URL stays stable across requests.
      const { data: existing } = await sb
        .from("share_links")
        .select("token, expires_at")
        .eq("campaign_id", campaignId)
        .eq("link_type", type)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let token: string | null = null;
      if (
        existing &&
        (!existing.expires_at || new Date(existing.expires_at) > new Date())
      ) {
        token = existing.token;
      } else {
        // Need to mint a new one.
        const newToken = genToken();
        const { error: insertErr } = await sb.from("share_links").insert({
          token: newToken,
          title:
            type === "gallery" ? `${campaignName} — Gallery` :
            type === "overview" ? `${campaignName} — Overview` :
            `${campaignName} — Dashboard`,
          campaign_id: campaignId,
          link_type: type,
        });
        if (insertErr) throw new Error(insertErr.message);
        token = newToken;
      }

      const url = `${window.location.origin}/share/${token}`;
      await navigator.clipboard.writeText(url);
      setCopied(type);
      setTimeout(() => setCopied(null), 2_000);
      // Don't auto-close on copy so the user can pick another link type
      // in the same session if they want both URLs.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to share");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-xs font-medium hover:bg-muted transition-colors"
      >
        <Share2 className="h-3.5 w-3.5" />
        Share
      </button>

      {open && (
        <>
          {/* Click-away backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 top-full mt-2 w-[300px] rounded-lg border border-border bg-popover shadow-lg z-50 p-1.5">
            {OPTIONS.map(({ type, Icon, label, hint }) => {
              const isBusy = busy === type;
              const isCopied = copied === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => handle(type)}
                  disabled={isBusy}
                  className="w-full flex items-start gap-3 px-3 py-2.5 rounded-md hover:bg-muted/60 transition-colors text-left disabled:opacity-60"
                >
                  <span className="h-7 w-7 rounded-md bg-muted flex items-center justify-center shrink-0 mt-0.5">
                    {isBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : isCopied ? (
                      <Check className="h-3.5 w-3.5 text-[#16a34a]" />
                    ) : (
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {isCopied ? "Copied to clipboard" : label}
                    </span>
                    <span className="block text-[11px] text-muted-foreground mt-0.5">
                      {hint}
                    </span>
                  </span>
                </button>
              );
            })}

            {error && (
              <div className="mt-1 px-3 py-2 text-[11px] text-destructive bg-destructive/5 rounded-md">
                {error}
              </div>
            )}

            <div className="mt-1 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
              Links open at{" "}
              <code className="font-mono px-1 py-0.5 rounded bg-muted">
                /share/&lt;token&gt;
              </code>
              {" "}— no login required.
            </div>

            {/* Hidden "/" prefetch hint so the popover knows the route exists */}
            <span className="hidden">
              <ExternalLink />
              {campaignSlug}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
