"use client";

/**
 * Danger Zone — bottom of the campaign edit page.
 *
 * Two destructive actions, in order of severity:
 *   1. Archive — soft, reversible. One click + confirm.
 *   2. Delete permanently — requires typing the campaign name to
 *      confirm. Mirrors the GitHub repo-delete pattern: explicit and
 *      hard to do by accident.
 *
 * Both call server actions that handle the actual mutation; this
 * component just owns the UI state machine (idle / archiving /
 * deleting / error).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Archive, Trash2, AlertTriangle, Loader2, X } from "lucide-react";
import { archiveCampaign, deleteCampaign } from "./actions";

interface Props {
  slug: string;
  name: string;
  status: "active" | "paused" | "archived";
}

export function DangerZone({ slug, name, status }: Props) {
  const router = useRouter();
  const [archiving, setArchiving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onArchive() {
    if (!confirm(
      `Archive ${name}?\n\nIt'll be hidden from the default Campaigns list and the top-bar filter, but everything stays intact. You can flip Status back to Active from this same edit page anytime to bring it back.`,
    )) return;
    setArchiving(true);
    setError(null);
    const r = await archiveCampaign({ slug });
    setArchiving(false);
    if (!r.ok) { setError(r.error); return; }
    router.push("/campaigns");
    router.refresh();
  }

  async function onDelete() {
    setDeleting(true);
    setError(null);
    const r = await deleteCampaign({ slug, typedName: confirmName });
    setDeleting(false);
    if (!r.ok) { setError(r.error); return; }
    router.push("/campaigns");
    router.refresh();
  }

  return (
    <Card className="border-destructive/40 bg-destructive/[0.02]">
      <CardContent className="pt-6 space-y-5">
        <div>
          <p className="text-base font-semibold text-destructive">Danger zone</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Archive hides the campaign but keeps the data. Permanent delete is
            irreversible.
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
            <p className="text-sm font-medium">Archive campaign</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {status === "archived"
                ? "Already archived. Switch Status to Active above to bring it back."
                : "Hide from the default Campaigns list and top-bar filter. Reversible from the Status select above."}
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
              <p className="text-sm font-medium">Delete campaign permanently</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Removes the campaign row. Posts/accounts/batches stay in DB
                but become orphaned (campaign_id = NULL). Email send history
                for this campaign is also deleted. Local data files at
                <code className="font-mono mx-1 px-1 py-0.5 rounded bg-muted text-[11px]">
                  data/campaigns/{slug}/
                </code>
                stay on disk so you can recover by recreating the campaign
                with the same slug.
              </p>
            </div>
            {!showDelete && (
              <Button
                variant="outline"
                type="button"
                onClick={() => setShowDelete(true)}
                className="shrink-0 border-destructive text-destructive hover:bg-destructive/10"
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
                  {name}
                </code>
                {" "}to confirm.
              </p>
              <Input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={name}
                autoFocus
                className="font-mono text-sm"
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => {
                    setShowDelete(false);
                    setConfirmName("");
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  onClick={onDelete}
                  disabled={deleting || confirmName.trim() !== name}
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
