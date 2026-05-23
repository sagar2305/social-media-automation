"use client";

/**
 * Shared shell for every CMS editor: header strip, accordion sections,
 * dirty-tracking save bar. Children compose this to build the actual
 * form for a given page.
 *
 *   <EditorShell
 *     slug="brief"
 *     baseline={baselineContent}
 *     value={content}
 *     onChange={setContent}
 *     livePath="/creator/brief"
 *     onSave={async () => savePageContent("brief", content)}
 *   >
 *     <Section title="Hero">…</Section>
 *     <Section title="FAQ">…</Section>
 *   </EditorShell>
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ExternalLink,
  ChevronRight,
  Save,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { HiddenToggle } from "./fields";

interface EditorShellProps<T> {
  title: string;
  livePath: string;
  baseline: T;
  value: T;
  onChange: (next: T) => void;
  onSave: () => Promise<{ ok: true } | { ok: false; error: string }>;
  children: React.ReactNode;
}

export function EditorShell<T>({
  title,
  livePath,
  baseline,
  value,
  onChange,
  onSave,
  children,
}: EditorShellProps<T>) {
  const router = useRouter();
  const [savedSnapshot, setSavedSnapshot] = useState<T>(baseline);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  // Cache-bust query param appended to the "View live →" link. Updated on
  // every successful save so opening the live page in a new tab always
  // bypasses any browser-side HTTP cache.
  const [livePathStamp, setLivePathStamp] = useState<number | null>(null);

  // Dirty = current value differs from the last saved snapshot. Cheap
  // structural equality check via JSON — both sides are POJO content.
  const dirty = useMemo(
    () => JSON.stringify(value) !== JSON.stringify(savedSnapshot),
    [value, savedSnapshot],
  );

  // Reset "Saved ✓" flash after a moment.
  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => setStatus("idle"), 1800);
    return () => clearTimeout(t);
  }, [status]);

  // Browser warning if the admin tries to leave with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  async function handleSave() {
    setStatus("saving");
    setError(null);
    const res = await onSave();
    if (res.ok) {
      setSavedSnapshot(value);
      setStatus("saved");
      setLivePathStamp(Date.now());
      // Re-runs the server component so the "Last saved …" timestamp
      // above the form reflects the row we just wrote.
      router.refresh();
    } else {
      setError(res.error);
      setStatus("error");
    }
  }

  const liveHref = livePathStamp ? `${livePath}?_=${livePathStamp}` : livePath;

  function handleRevert() {
    if (!confirm("Discard unsaved changes and reset to the last saved version?")) return;
    onChange(savedSnapshot);
  }

  return (
    <div className="p-6 sm:p-8 max-w-4xl space-y-6 pb-28">
      {/* Header */}
      <header className="space-y-3">
        <Link
          href="/signup-control"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back to Signup Control
        </Link>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="text-xs text-muted-foreground">
              Edits show up on the live page the moment you save.
            </p>
          </div>
          <a
            href={liveHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 px-3 rounded-lg border border-emerald-500/30 bg-white hover:bg-emerald-50 text-emerald-700 dark:text-emerald-300 text-xs font-semibold transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View live · {livePath}
          </a>
        </div>
      </header>

      {/* Section content (sectioned form) */}
      <div className="space-y-3">{children}</div>

      {/* Sticky save bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-emerald-500/25 bg-white/85 dark:bg-card/85 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 sm:px-8 py-3 flex items-center justify-between gap-3">
          <div className="text-sm min-w-0 flex-1">
            {status === "error" ? (
              <span className="inline-flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="truncate">{error}</span>
              </span>
            ) : status === "saved" ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 font-medium">
                <CheckCircle2 className="h-4 w-4" />
                Saved
              </span>
            ) : dirty ? (
              <span className="text-amber-700 dark:text-amber-400 font-medium">
                Unsaved changes
              </span>
            ) : (
              <span className="text-muted-foreground">All changes saved</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRevert}
              disabled={!dirty || status === "saving"}
              className="inline-flex h-10 items-center gap-1.5 px-3 rounded-lg border border-emerald-500/30 bg-white hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed text-emerald-800 dark:text-emerald-200 text-sm font-semibold transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Revert
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || status === "saving"}
              className="inline-flex h-10 items-center gap-1.5 px-4 rounded-lg bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-500 hover:to-emerald-700 disabled:from-emerald-500/40 disabled:to-emerald-600/40 disabled:cursor-not-allowed text-white text-sm font-semibold ring-1 ring-inset ring-white/15 shadow-[0_4px_14px_-2px_rgba(16,185,129,0.45)] hover:shadow-[0_8px_22px_-4px_rgba(16,185,129,0.55)] transition-all"
            >
              {status === "saving" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {status === "saving" ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Collapsible section. Defaults to open since editors are linear forms;
 * the accordion is mostly for jump-navigation in long pages.
 *
 * Supply `meta` to expose per-section controls in the section header:
 * a visibility toggle (hide on live page) and an optional
 * heading-typography editor.
 */
export function Section({
  title,
  hint,
  children,
  defaultOpen = true,
  meta,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  meta?: {
    hidden?: boolean;
    onHiddenChange?: (v: boolean) => void;
  };
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.06] to-emerald-500/[0.01] [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex items-center gap-2 px-5 py-3 cursor-pointer select-none">
        <ChevronRight className="h-4 w-4 text-emerald-700/70 dark:text-emerald-300/70 transition-transform group-open:rotate-90" />
        <span className="text-sm font-semibold flex-1">{title}</span>
        {hint && <span className="text-[11px] text-muted-foreground mr-2">{hint}</span>}
        {meta?.onHiddenChange && (
          <span onClick={(e) => e.preventDefault()}>
            <HiddenToggle value={meta.hidden} onChange={meta.onHiddenChange} />
          </span>
        )}
      </summary>
      <div className="px-5 pb-5 pt-1 space-y-4 border-t border-emerald-500/15">
        {children}
      </div>
    </details>
  );
}

/**
 * Two-column grid that collapses on mobile. Convenience wrapper used by
 * editors that want side-by-side fields without each editor reinventing
 * a grid utility.
 */
export function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid sm:grid-cols-2 gap-3">{children}</div>;
}
