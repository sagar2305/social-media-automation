import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * ScrollX — horizontal scroll wrapper for content that's wider than
 * a mobile viewport but should NOT shrink (e.g. wide tab strips, wide
 * metric rows). At sm+ it acts as a regular block.
 *
 * Negative margin + matching padding lets the scrolling content bleed
 * to the very edge of the viewport on phones (so the rightmost item
 * has a visible "more →" affordance) while preserving normal margins
 * on tablet+.
 *
 * NOTE: shadcn `<Table>` already provides its own overflow-x-auto, so
 * don't wrap tables in this — wrap everything else that scrolls.
 */
export function ScrollX({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
