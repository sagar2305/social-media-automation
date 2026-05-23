"use client";

/**
 * Version history viewer for the CMS editor.
 *
 * Lists up to 15 most-recent snapshots of the page's content (every
 * save creates one). Clicking "Restore" pulls that snapshot back into
 * the form so the admin can review/save it again. No automatic
 * restore-to-DB — the admin still has to click Save to commit.
 */

import { useEffect, useState } from "react";
import { History, Loader2, RotateCcw, AlertTriangle } from "lucide-react";
import { Section } from "./editor-shell";
import {
  listVersions,
  getVersionContent,
  type VersionRow,
} from "../actions";
import type { CmsSlug } from "@/lib/cms-schemas";

export function HistoryPanel<T>({
  slug,
  // Load a snapshot back into the editor form. The parent owns the
  // form state and decides whether to keep it (admin clicks Save) or
  // discard (admin clicks Revert).
  onRestore,
}: {
  slug: CmsSlug;
  onRestore: (content: T) => void;
}) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  async function refresh() {
    setError(null);
    try {
      const res = await listVersions(slug);
      if (res.ok) setVersions(res.data);
      else setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history.");
    }
  }

  useEffect(() => {
    // Intentional fetch-on-mount pattern. The async refresh() calls
    // setState after `await listVersions(slug)` — that's the standard
    // "load data when the component mounts / slug changes" idiom. The
    // React 19 lint rule flags this as a possible cascading render,
    // but the cascade is bounded to a single re-render per slug change.
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function handleRestore(id: number) {
    if (!confirm("Load this version back into the form? You still need to click Save to commit it.")) return;
    setRestoring(id);
    try {
      const res = await getVersionContent(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onRestore(res.data.content as T);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to restore version.");
    } finally {
      // Always clear the per-row spinner, even on error / catch — otherwise
      // the restore button stays as a perpetual spinner.
      setRestoring(null);
    }
  }

  return (
    <Section title="Version history" hint="Every save creates a snapshot. Restore an earlier version anytime.">
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive inline-flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}
      {!versions ? (
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </p>
      ) : versions.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No saved versions yet. Your first Save will start the history.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {versions.map((v) => (
            <li
              key={v.id}
              className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-white px-3 py-2 text-xs"
            >
              <History className="h-3.5 w-3.5 text-emerald-700/70 dark:text-emerald-300/70 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">
                  <time dateTime={v.saved_at} suppressHydrationWarning>
                    {new Date(v.saved_at).toLocaleString()}
                  </time>
                </p>
                {v.saved_by_email && (
                  <p className="text-[11px] text-muted-foreground truncate">{v.saved_by_email}</p>
                )}
              </div>
              <button
                type="button"
                disabled={restoring === v.id}
                onClick={() => handleRestore(v.id)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-emerald-500/30 bg-white hover:bg-emerald-50 text-emerald-700 dark:text-emerald-300 font-semibold disabled:opacity-50 shrink-0"
              >
                {restoring === v.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RotateCcw className="h-3 w-3" />
                )}
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
