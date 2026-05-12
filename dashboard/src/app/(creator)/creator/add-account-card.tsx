"use client";

/**
 * "Add your own account" card on /creator.
 *
 * The creator has a personal TikTok handle they want to use for a
 * campaign they're on. This card submits a request the admin will
 * review. The admin's side handles the Blotato setup; once approved,
 * the account becomes part of the campaign and posts on it auto-
 * attribute to this creator (because the new accounts.id gets added
 * to their owned_account_ids).
 *
 * Lists the creator's current requests (pending + past) so they see
 * the lifecycle: submitted → approved (active) / rejected.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Plus, Send, AlertCircle, CheckCircle2, XCircle, Clock3, Loader2, KeyRound,
  Eye, EyeOff, Lock,
} from "lucide-react";
import { requestCreatorAccount } from "../../(dashboard)/payouts/actions";

export interface CreatorAccountRequest {
  id: string;
  handle: string;
  display_name: string | null;
  campaign_id: string | null;
  campaign_name?: string | null;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  rejection_reason: string | null;
}

interface Props {
  /** Campaigns this creator is on — drives the campaign select. */
  campaigns: Array<{ id: string; slug: string; name: string }>;
  /** Requests the creator has filed (any status). Sorted newest first. */
  requests: CreatorAccountRequest[];
}

export function AddAccountCard({ campaigns, requests }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [campaignId, setCampaignId] = useState<string>(
    campaigns[0]?.id ?? "",
  );
  const [notes, setNotes] = useState("");
  // TikTok login email/phone + password. Required so the admin can
  // sign in on Blotato's side without a separate DM round-trip.
  // Password is encrypted at-rest server-side (see credential-vault)
  // and wiped on approve/reject + after 7 days. We never send it back
  // down to the client after submission, only up.
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  function reset() {
    setHandle("");
    setDisplayName("");
    setNotes("");
    setLoginIdentifier("");
    setPassword("");
    setShowPassword(false);
    setError(null);
    setSuccess(null);
  }

  function onSubmit() {
    setError(null);
    setSuccess(null);
    if (!handle.trim()) { setError("Enter your TikTok handle."); return; }
    if (!loginIdentifier.trim()) {
      setError("Enter the email or phone you use to log into TikTok.");
      return;
    }
    if (!password) {
      setError("Enter your TikTok password.");
      return;
    }
    startSubmit(async () => {
      const r = await requestCreatorAccount({
        handle,
        display_name: displayName || null,
        campaign_id: campaignId || null,
        notes: notes || null,
        login_identifier: loginIdentifier,
        password,
      });
      if (!r.ok) { setError(r.error); return; }
      setSuccess("Request submitted — your admin will review it shortly.");
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold">Add your own account</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Have a personal TikTok handle you&apos;d like to use for a campaign
              you&apos;re on? Submit it here — your admin will set up the Blotato
              connection and add it to the campaign. You&apos;ll need your TikTok
              login and 2FA device handy when they reach out to finish setup.
            </p>
          </div>
          {!open && (
            <Button type="button" size="sm" onClick={() => setOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add account
            </Button>
          )}
        </div>

        {success && (
          <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{success}</span>
          </div>
        )}

        {open && (
          <div className="rounded-md border border-border bg-muted/20 p-4 space-y-3">
            {/*
              "Before you submit" briefing. Adding a TikTok account to
              Blotato isn't an OAuth flow — Blotato logs into TikTok as
              the creator using the real password + a 2FA code at sign-
              in time. The creator submits their login + password here
              (encrypted at rest, auto-wiped); the live 2FA code still
              has to come over a side channel because it's time-bound
              and per-attempt. Front-loading this expectation up front
              cuts the back-and-forth and the "wait, why do you need
              my password?" surprise once the request lands.
            */}
            <div className="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200/90">
              <KeyRound className="h-4 w-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
              <div className="space-y-2 min-w-0">
                <p className="font-semibold text-amber-800 dark:text-amber-300">
                  Before you submit
                </p>
                <p>
                  Adding a TikTok account to Blotato uses your real login — not
                  an &ldquo;authorize this app&rdquo; popup. To set things up your
                  admin needs:
                </p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>
                    The <span className="font-medium">email or phone</span> you
                    use to log into TikTok
                  </li>
                  <li>
                    Your <span className="font-medium">TikTok password</span>
                  </li>
                  <li>
                    A live <span className="font-medium">2-factor code</span> at
                    sign-in time — your admin will message you when they&apos;re
                    ready, so keep your phone or authenticator app handy
                  </li>
                </ul>
                <p>
                  You&apos;ll enter the login and password below. The 2FA code is
                  short-lived and per-attempt, so it can&apos;t be saved up front —
                  your admin will ping you on your agreed channel (DM / WhatsApp /
                  Signal) to read it back when they hit sign-in.
                </p>
                <p>
                  <span className="font-medium">2FA tip:</span> if your 2-step
                  verification is set to SMS or an authenticator app, switching
                  it to <span className="font-medium">email</span> for setup
                  makes the handoff one-shot — the admin can read the code
                  themselves once you share the inbox. TikTok →{" "}
                  <span className="whitespace-nowrap">Settings &amp; privacy</span>{" "}
                  →{" "}
                  <span className="whitespace-nowrap">Security &amp; permissions</span>{" "}
                  → 2-step verification. Switch back after setup is done.
                </p>
                <p className="flex items-start gap-1.5 text-[11px] text-amber-800/80 dark:text-amber-200/70">
                  <Lock className="h-3 w-3 shrink-0 mt-0.5" />
                  <span>
                    Your password is encrypted before it&apos;s saved, only
                    your admin can decrypt it, and it&apos;s automatically
                    deleted once the account is approved (and after 7 days
                    regardless).
                  </span>
                </p>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">TikTok handle *</label>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-muted-foreground">@</span>
                  <Input
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    placeholder="maya_studies"
                    className="flex-1"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Just the handle — no @ prefix.
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Display name</label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Maya — Study Tips"
                />
                <p className="text-[10px] text-muted-foreground">
                  Optional, shown on the admin&apos;s dashboard.
                </p>
              </div>
            </div>

            {/*
              Credentials block. Visually grouped + a tiny lock chip so
              the creator clocks "this is the sensitive bit" before
              typing. Password input uses type=password by default and
              flips to text only via the eye toggle — handy on mobile
              where mis-typing a long password is otherwise unrecoverable.
            */}
            <div className="rounded-md border border-border bg-background/40 p-3 space-y-3">
              <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <Lock className="h-3 w-3" />
                TikTok login
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Login email or phone *</label>
                  <Input
                    value={loginIdentifier}
                    onChange={(e) => setLoginIdentifier(e.target.value)}
                    placeholder="you@example.com  or  +1 555 123 4567"
                    autoComplete="off"
                    inputMode="email"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Whatever you actually type into TikTok&apos;s login screen.
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">TikTok password *</label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="•••••••••••"
                      autoComplete="off"
                      className="pr-9 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-0 right-0 px-2.5 inline-flex items-center text-muted-foreground hover:text-foreground"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Encrypted before save. Auto-deleted on approval &amp; after 7 days.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">Campaign</label>
              <select
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">(no campaign yet)</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground">
                Pick the campaign you want this account attached to. You can change later by asking your admin.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Anything your admin should know — e.g. 'studying-focused, 12k followers'"
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <p>
                Once approved, posts on this handle will count toward your
                earnings at the same rate as the campaign&apos;s other posts.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setOpen(false); reset(); }}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={onSubmit}
                disabled={
                  submitting ||
                  !handle.trim() ||
                  !loginIdentifier.trim() ||
                  !password
                }
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                )}
                Submit request
              </Button>
            </div>
          </div>
        )}

        {/* Existing requests (any status) so the creator sees the
            lifecycle. Most recent first. */}
        {requests.length > 0 && (
          <div className="pt-3 border-t border-border/60 space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
              Your requests
            </p>
            <div className="space-y-1.5">
              {requests.map((r) => (
                <RequestRow key={r.id} req={r} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RequestRow({ req }: { req: CreatorAccountRequest }) {
  const meta =
    req.status === "approved" ? { Icon: CheckCircle2, label: "Approved", className: "text-emerald-700 dark:text-emerald-400" } :
    req.status === "rejected" ? { Icon: XCircle, label: "Rejected", className: "text-destructive" } :
                                { Icon: Clock3, label: "Pending review", className: "text-amber-700 dark:text-amber-400" };
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border/40 bg-card px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium flex items-center gap-1.5">
          @{req.handle}
          {req.display_name && (
            <span className="text-xs text-muted-foreground font-normal">· {req.display_name}</span>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Submitted {new Date(req.created_at).toLocaleDateString("en-US")}
          {req.campaign_name && <> · for {req.campaign_name}</>}
        </p>
        {req.rejection_reason && (
          <p className="text-[11px] text-destructive mt-1">
            Reason: {req.rejection_reason}
          </p>
        )}
      </div>
      <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${meta.className} shrink-0`}>
        <meta.Icon className="h-3 w-3" />
        {meta.label}
      </span>
    </div>
  );
}
