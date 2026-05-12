"use client";

/**
 * File tabs + content viewer for the /logs page.
 *
 * Renders each AI-brain file's content in a preformatted block —
 * these files are intentionally human-readable markdown / tsv, and a
 * <pre> preserves the table formatting that's the whole point of
 * them. We don't pull in a heavy markdown renderer; tables in
 * react-markdown look worse than the raw source for the kind of
 * tight aligned grids autoresearch writes.
 *
 * Tab switching uses ?file=<key> in the URL so a deep link to e.g.
 * /logs?campaign=minutewise&file=hashtag-bank works the way you'd
 * expect.
 */

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Copy, Check } from "lucide-react";

export interface LogFile {
  key: string;
  filename: string;
  label: string;
  description: string;
  content: string | null;
  error: string | null;
  sizeBytes: number;
}

interface Props {
  files: LogFile[];
  activeKey: string;
  activeSlug: string;
}

export function LogsFileTabs({ files, activeKey, activeSlug }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [copied, setCopied] = useState(false);

  const safeActive = files.find((f) => f.key === activeKey) ?? files[0];

  function pickFile(key: string) {
    // Page now lives at /logs/<slug>; preserve that path and just
    // swap the ?file= param. The activeSlug param is retained for
    // back-compat with the older flat /logs?campaign=… layout.
    void activeSlug;
    const next = new URLSearchParams();
    next.set("file", key);
    router.push(`${pathname}?${next.toString()}`);
  }

  async function copyContent() {
    if (!safeActive.content) return;
    try {
      await navigator.clipboard.writeText(safeActive.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; ignore */
    }
  }

  return (
    <div className="space-y-3">
      {/* Tab strip — file label on top, byte count or "not generated"
          underneath so the operator can see at a glance which files
          actually exist for this campaign. */}
      <div className="flex flex-wrap gap-1.5">
        {files.map((f) => {
          const isActive = f.key === safeActive.key;
          const missing = f.content === null;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => pickFile(f.key)}
              className={`relative px-3 py-2 rounded-md border text-left transition-colors min-w-[120px] ${
                isActive
                  ? "border-emerald-500/40 bg-emerald-500/10 text-foreground"
                  : missing
                    ? "border-dashed border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40"
                    : "border-border bg-background hover:bg-muted/40"
              }`}
            >
              <p className="text-xs font-medium leading-tight">{f.label}</p>
              <p className="text-[10px] text-muted-foreground mt-1 leading-none">
                {missing
                  ? "not yet"
                  : `${(f.sizeBytes / 1024).toFixed(1)} KB`}
              </p>
            </button>
          );
        })}
      </div>

      {/* Header row above the file body: filename + description + copy. */}
      <div className="flex items-baseline justify-between gap-3 pt-1 border-t border-border/40">
        <div className="min-w-0">
          <p className="text-sm font-semibold font-mono">{safeActive.filename}</p>
          <p className="text-xs text-muted-foreground">{safeActive.description}</p>
        </div>
        {safeActive.content && (
          <button
            type="button"
            onClick={copyContent}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {copied ? (
              <><Check className="h-3.5 w-3.5 text-emerald-600" /> Copied</>
            ) : (
              <><Copy className="h-3.5 w-3.5" /> Copy</>
            )}
          </button>
        )}
      </div>

      {/* File body. Markdown stays as plain text in a <pre> to preserve
          the autoresearch tables verbatim; tsv same treatment. */}
      <div className="rounded-md border border-border bg-card overflow-hidden">
        {safeActive.error ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">{safeActive.error}</p>
            <p className="text-[11px] text-muted-foreground/70 mt-2 font-mono">
              {safeActive.filename}
            </p>
          </div>
        ) : safeActive.content ? (
          <pre className="text-xs font-mono px-4 py-3 overflow-x-auto leading-relaxed max-h-[70vh] overflow-y-auto whitespace-pre">
            {safeActive.content}
          </pre>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            (empty)
          </p>
        )}
      </div>
    </div>
  );
}
