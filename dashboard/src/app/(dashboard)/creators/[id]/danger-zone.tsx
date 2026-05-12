"use client";

/**
 * Danger Zone — bottom of the creator profile page.
 *
 * Two destructive actions, mirroring the campaign edit pattern:
 *   1. Archive — soft, reversible. Hides from the active list.
 *   2. Delete permanently — requires typing the creator's email to
 *      confirm. Server action refuses if any payouts exist (ledger
 *      sanctity); operator is told to archive in that case.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Archive, Trash2, AlertTriangle, Loader2, X } from "lucide-react";
import { archiveCreator, deleteCreator } from "../../payouts/actions";

interface Props {
  id: string;
  email: string;
  displayLabel: string;     // legal_name or display_name — for the confirm copy
  status: "invited" | "onboarded" | "suspended" | "archived";
  /**
   * True when the creator has at least one pending / approved /
   * processing payout — active money on the books. Terminal payouts
   * (paid / cancelled / failed) don't count: their ledger entries are
   * already settled and reference account codes, not creator_id.
   */
  hasActivePayouts: boolean;
}

export function CreatorDangerZone({ id, email, displayLabel, status, hasActivePayouts }: Props) {
  const router = useRouter();
  const [archiving, setArchiving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onArchive() {
    if (!confirm(
      `Archive ${displayLabel}?\n\nThe creator will be hidden from the active list and no new payouts will accrue. All historical payouts and assignments stay intact. Reversible by an admin.`,
    )) return;
    setArchiving(true);
    setError(null);
    const r = await archiveCreator({ id });
    setArchiving(false);
    if (!r.ok) { setError(r.error); return; }
    router.push("/creators");
    router.refresh();
  }

  async function onDelete() {
    setDeleting(true);
    setError(null);
    const r = await deleteCreator({ id, typedEmail: confirmEmail });
    setDeleting(false);
    if (!r.ok) { setError(r.error); return; }
    router.push("/creators");
    router.refresh();
  }

  return (
    <Card className="border-destructive/40 bg-destructive/[0.02]">
      <CardContent className="pt-6 space-y-5">
        <div>
          <p className="text-base font-semibold text-destructive">Danger zone</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Archive hides the creator but keeps the data. Permanent delete is
            only allowed when the creator has no payouts on the books.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-destructive/70 hover:text-destructive shrink-0"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Archive */}
        <div className="flex items-start justify-between gap-4 py-3 border-t border-border/60">
          <div className="min-w-0">
            <p className="text-sm font-medium">Archive creator</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {status === "archived"
                ? "Already archived. Existing payouts and assignments stay intact."
                : "Hide from the active creators list and stop accruing new payouts. Historical data is preserved."}
            </p>
          </div>
          <Button
            variant="outline"
            type="button"
            onClick={onArchive}
            disabled={archiving || status === "archived"}
            className="shrink-0"
          >
            {archiving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            <Archive className="h-4 w-4 mr-1.5" />
            Archive
          </Button>
        </div>

        {/* Delete */}
        <div className="py-3 border-t border-border/60 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Delete creator permanently</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Removes the creator row, deletes their assignments, detaches
                any tagged posts, and removes paid/cancelled payout records.
                Blocked when the creator still has <strong>active
                payouts</strong> (pending or approved) — cancel or pay those
                first, or archive instead.
                {hasActivePayouts && (
                  <span className="block mt-1 text-amber-600">
                    This creator has active payouts on the books. Cancel or pay
                    them first, or click Archive above.
                  </span>
                )}
              </p>
            </div>
            {!showDelete && (
              <Button
                variant="outline"
                type="button"
                onClick={() => setShowDelete(true)}
                disabled={hasActivePayouts}
                className="shrink-0 border-destructive text-destructive hover:bg-destructive/10 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                Delete…
              </Button>
            )}
          </div>

          {showDelete && (
            <div className="rounded-md border border-destructive/50 bg-destructive/[0.04] p-4 space-y-3">
              <p className="text-xs">
                Type{" "}
                <code className="font-mono px-1.5 py-0.5 rounded bg-background border border-border text-[11px]">
                  {email}
                </code>
                {" "}to confirm.
              </p>
              <Input
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                placeholder={email}
                autoFocus
                className="font-mono text-sm"
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => {
                    setShowDelete(false);
                    setConfirmEmail("");
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  onClick={onDelete}
                  disabled={deleting || confirmEmail.trim().toLowerCase() !== email.toLowerCase()}
                  className="border-destructive bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-40"
                >
                  {deleting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Delete forever
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
