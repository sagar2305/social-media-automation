"use client";

/**
 * Pending creator-account-requests inbox on /accounts.
 *
 * Each row shows: who requested it, the handle they want to use,
 * which campaign, optional notes. Approve / Reject buttons.
 *
 * Approve opens an inline panel asking for the Blotato account id
 * the admin set up in my.blotato.com. We can't auto-create the
 * Blotato connection — that's a manual step on their side — so the
 * dashboard's job is to take the id once it exists and stitch the
 * accounts row + creator owned_account_ids together.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, XCircle, Loader2, AlertCircle, AtSign,
  Eye, EyeOff, Copy, KeyRound, Lock,
} from "lucide-react";
import {
  approveCreatorAccountRequest,
  rejectCreatorAccountRequest,
  revealAccountRequestPassword,
} from "../payouts/actions";

export interface PendingAccountRequest {
  id: string;
  handle: string;
  display_name: string | null;
  notes: string | null;
  created_at: string;
  creator_name: string;
  creator_email: string;
  creator_id: string;
  campaign_id: string | null;
  campaign_name: string | null;
  /**
   * Email/phone the creator uses to log into TikTok. Plaintext — not
   * a secret, displayed inline on the row.
   */
  login_identifier: string | null;
  /**
   * Whether a (still-decryptable) encrypted password is on file. We
   * pass a boolean rather than the timestamp so this client component
   * has no useful metadata to leak; the actual ciphertext stays
   * server-side and is only fetched on the Reveal click.
   */
  has_password: boolean;
}

interface Props {
  requests: PendingAccountRequest[];
}

export function PendingRequestsPanel({ requests }: Props) {
  if (requests.length === 0) return null;
  return (
    <Card className="border-amber-500/30 bg-amber-500/[0.04]">
      <CardContent className="pt-5 space-y-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-400">
            Pending account requests · {requests.length}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Creators have asked to add personal handles to a campaign. After
            you set up the Blotato connection at my.blotato.com, paste the
            Blotato account id below to approve.
          </p>
        </div>
        <div className="space-y-2">
          {requests.map((r) => (
            <RequestRow key={r.id} req={r} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RequestRow({ req }: { req: PendingAccountRequest }) {
  const router = useRouter();
  const [showApprove, setShowApprove] = useState(false);
  const [blotatoId, setBlotatoId] = useState("");
  const [displayName, setDisplayName] = useState(req.display_name ?? "");
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  // Reveal state for the creator's TikTok password. We never receive
  // the plaintext as a prop — we fetch it lazily on click via an
  // admin-gated server action so it lives in memory only as long as
  // this row is open. `revealError` is shown inline (e.g. when the
  // 7-day TTL already wiped the password).
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealing, startReveal] = useTransition();
  const [revealError, setRevealError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"login" | "password" | null>(null);

  function onReveal() {
    setRevealError(null);
    startReveal(async () => {
      const r = await revealAccountRequestPassword({ requestId: req.id });
      if (!r.ok) { setRevealError(r.error); return; }
      setRevealed(r.data.password);
    });
  }

  function hidePassword() {
    setRevealed(null);
    setRevealError(null);
  }

  async function copyText(value: string, which: "login" | "password") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500);
    } catch {
      // Older browsers / non-secure contexts — silently noop, admin
      // can still select + copy manually.
    }
  }

  function onApprove() {
    setError(null);
    if (!blotatoId.trim()) {
      setError("Paste the Blotato account id first.");
      return;
    }
    startBusy(async () => {
      const r = await approveCreatorAccountRequest({
        requestId: req.id,
        blotato_id: blotatoId,
        display_name: displayName || null,
      });
      if (!r.ok) { setError(r.error); return; }
      router.refresh();
    });
  }

  function onReject() {
    setError(null);
    startBusy(async () => {
      const r = await rejectCreatorAccountRequest({
        requestId: req.id,
        reason: rejectReason || undefined,
      });
      if (!r.ok) { setError(r.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="rounded-md border border-border bg-card px-4 py-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium flex items-center gap-2">
            <AtSign className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono">@{req.handle}</span>
            {req.display_name && (
              <span className="text-xs text-muted-foreground font-normal">· {req.display_name}</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            From <span className="text-foreground font-medium">{req.creator_name}</span>{" "}
            ({req.creator_email})
            {req.campaign_name && <> · for <span className="text-foreground font-medium">{req.campaign_name}</span></>}
            {" · "}
            submitted {new Date(req.created_at).toLocaleDateString("en-US")}
          </p>
          {req.notes && (
            <p className="text-xs text-muted-foreground mt-1.5 italic">
              &ldquo;{req.notes}&rdquo;
            </p>
          )}
        </div>
        {!showApprove && !showReject && (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowReject(true); setError(null); }}
              disabled={busy}
            >
              <XCircle className="h-3.5 w-3.5 mr-1.5" />
              Reject
            </Button>
            <Button
              size="sm"
              onClick={() => { setShowApprove(true); setError(null); }}
              disabled={busy}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              Approve
            </Button>
          </div>
        )}
      </div>

      {/*
        Credentials sub-row. Only renders if the creator actually
        provided a login identifier (older requests pre-dating the
        credentials feature won't have one). Login is shown inline
        in plaintext; password is gated behind a Reveal click that
        round-trips to a server action so the ciphertext never sits
        in the page bundle.
      */}
      {req.login_identifier && (
        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            <KeyRound className="h-3 w-3" />
            TikTok login
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1 min-w-0">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground/80">Login email / phone</p>
              <div className="flex items-center gap-1.5">
                <code className="text-xs font-mono break-all">{req.login_identifier}</code>
                <button
                  type="button"
                  onClick={() => copyText(req.login_identifier!, "login")}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  aria-label="Copy login"
                >
                  {copied === "login" ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>
            <div className="space-y-1 min-w-0">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground/80">Password</p>
              {!req.has_password ? (
                <p className="text-xs text-muted-foreground italic">
                  Not on file (older request or auto-wiped).
                </p>
              ) : revealed ? (
                <div className="flex items-center gap-1.5">
                  <code className="text-xs font-mono break-all">{revealed}</code>
                  <button
                    type="button"
                    onClick={() => copyText(revealed, "password")}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    aria-label="Copy password"
                  >
                    {copied === "password" ? (
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={hidePassword}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    aria-label="Hide password"
                  >
                    <EyeOff className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onReveal}
                  disabled={revealing}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300 disabled:opacity-50"
                >
                  {revealing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Eye className="h-3 w-3" />
                  )}
                  Reveal password
                </button>
              )}
              {revealError && (
                <p className="text-[11px] text-destructive flex items-start gap-1">
                  <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>{revealError}</span>
                </p>
              )}
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground/80 flex items-start gap-1 pt-0.5">
            <Lock className="h-2.5 w-2.5 mt-0.5 shrink-0" />
            <span>
              Encrypted at rest. Wiped on approve/reject and after 7 days.
              Don&apos;t paste this anywhere outside the Blotato sign-in window.
            </span>
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {showApprove && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-3">
          <p className="text-xs font-medium">Approve and create the managed account</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-medium">Blotato account id *</label>
              <Input
                value={blotatoId}
                onChange={(e) => setBlotatoId(e.target.value)}
                placeholder="cmmxd7lo605... or 37043"
                className="font-mono text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                From my.blotato.com after you&apos;ve set up the connection.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium">Display name</label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={`@${req.handle}`}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowApprove(false); setError(null); }} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={onApprove} disabled={busy || !blotatoId.trim()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
              Confirm approval
            </Button>
          </div>
        </div>
      )}

      {showReject && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-3">
          <p className="text-xs font-medium">Reject this request</p>
          <Input
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason (optional — shown to the creator)"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowReject(false); setError(null); }} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={onReject} disabled={busy} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
              {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5 mr-1.5" />}
              Reject
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
