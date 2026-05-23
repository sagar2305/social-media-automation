/**
 * Shared render helpers used by every creator-facing View component.
 *
 *   <Heading tokens={section.headingTypography} fallbackLevel="h2">
 *     {section.heading}
 *   </Heading>
 *
 *   <CustomSections list={content.customSections} />
 */

import * as React from "react";
import Image from "next/image";
import { Md } from "@/lib/markdown";
import type { CustomSection, TypographyTokens } from "@/lib/cms-schemas";

/**
 * Render a heading using a configurable semantic level + typography
 * tokens that override the level's default size/weight/color. If no
 * tokens are supplied, falls back to `fallbackLevel`'s default styling
 * (h1=large, h2=section, h3=subsection).
 */
export function Heading({
  tokens,
  fallbackLevel = "h2",
  className = "",
  children,
}: {
  tokens?: TypographyTokens;
  fallbackLevel?: "h1" | "h2" | "h3" | "h4";
  className?: string;
  children: React.ReactNode;
}) {
  const Level = (tokens?.level ?? fallbackLevel) as keyof React.JSX.IntrinsicElements;
  const style: React.CSSProperties = {};
  if (tokens?.size) style.fontSize = tokens.size;
  if (tokens?.weight) style.fontWeight = tokens.weight;
  if (tokens?.color) style.color = tokens.color;

  // Sensible base class for each fallback level. Token-driven CSS
  // overrides win when tokens are set.
  const base =
    fallbackLevel === "h1"
      ? "text-4xl sm:text-5xl font-semibold tracking-tight"
      : fallbackLevel === "h2"
        ? "text-2xl font-semibold"
        : fallbackLevel === "h3"
          ? "text-lg font-semibold"
          : "text-base font-semibold";

  return (
    <Level className={`${base} ${className}`.trim()} style={style}>
      {children}
    </Level>
  );
}

/**
 * Render any number of admin-defined custom blocks below the standard
 * sections of a page. Each block: heading (with typography), markdown
 * body, optional image. Hidden blocks are skipped.
 */
export function CustomSections({ list }: { list?: CustomSection[] }) {
  const visible = (list ?? []).filter((s) => !s.hidden);
  if (visible.length === 0) return null;
  return (
    <div className="space-y-6">
      {visible.map((s, i) => (
        <section
          key={i}
          className="rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.06] to-emerald-500/[0.01] p-6 sm:p-8 space-y-3"
        >
          <Heading tokens={typeof s.heading === "string" ? undefined : s.heading.typography} fallbackLevel="h2">
            {typeof s.heading === "string" ? s.heading : s.heading.text}
          </Heading>
          {s.imageUrl && (
            <div className="relative w-full overflow-hidden rounded-lg bg-muted/40" style={{ aspectRatio: "16 / 9" }}>
              <Image
                src={s.imageUrl}
                alt=""
                fill
                sizes="(max-width: 768px) 100vw, 768px"
                className="object-cover"
                unoptimized
              />
            </div>
          )}
          <div className="text-sm text-foreground/80 leading-relaxed">
            <Md>{s.body}</Md>
          </div>
        </section>
      ))}
    </div>
  );
}
