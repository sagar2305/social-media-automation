"use client";

/**
 * ChooserToggle — small "Show on chooser" pill that sits at the bottom
 * of each /signup-control tile. Clicking it flips the campaign's
 * show_on_chooser flag and revalidates both /signup-control and
 * /welcome/campaign so the change is immediately visible.
 *
 * The button is rendered as a sibling of the tile's <Link> with
 * stopPropagation so tapping the toggle does NOT navigate to the
 * editor. Pointer-events stay enabled here while the link wraps the
 * tile content underneath.
 */

import { useState, useTransition } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { setChooserVisibility } from "./actions";

export function ChooserToggle({
  slug,
  initial,
}: {
  slug: string;
  initial: boolean;
}) {
  const [show, setShow] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick(e: React.MouseEvent) {
    // The tile is a <Link> sibling — keep the click here and don't let
    // it bubble up to a navigation.
    e.preventDefault();
    e.stopPropagation();

    const next = !show;
    setShow(next); // optimistic
    setError(null);

    startTransition(async () => {
      const result = await setChooserVisibility(slug, next);
      if (!result.ok) {
        setShow(!next); // rollback
        setError(result.error);
      }
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={show}
        title={
          show
            ? "Visible on /welcome/campaign — click to hide"
            : "Hidden from /welcome/campaign — click to show"
        }
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
          show
            ? // Current state: visible. Button label is the action
              // (Hide). Emerald accent reinforces "this one is live".
              "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/30"
            : // Current state: hidden. Brand-color "Show" CTA pops so
              // it's obvious this is the one admin wants to click on
              // a brand-new or unpublished campaign.
              "bg-brand-500/15 text-brand-700 dark:text-brand-300 ring-1 ring-brand-500/30 hover:bg-brand-500/25"
        } ${pending ? "opacity-70" : ""}`}
      >
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : show ? (
          <EyeOff className="h-3 w-3" />
        ) : (
          <Eye className="h-3 w-3" />
        )}
        {show ? "Hide" : "Show"}
      </button>
      {error && (
        <p className="absolute top-full left-0 mt-1 text-[10px] text-red-600 max-w-[200px] leading-tight">
          {error}
        </p>
      )}
    </div>
  );
}
