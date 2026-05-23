"use client";

/**
 * <Editable> — thin per-text style applicator.
 *
 *   <Editable styles={c.styles} path={["hero", "heading"]}>
 *     <h1>{c.hero.heading}</h1>
 *   </Editable>
 *
 * Looks up `styles[path.join(".")]` and, if present, wraps `children`
 * with `<span style={...}>` so the saved typography tokens (size /
 * weight / color / font / italic / align / case / line-height /
 * letter-spacing) apply at render time — for both admin and public
 * visitors.
 *
 * Inline pencil-to-edit was an earlier iteration; all editing now lives
 * in /signup-control. The remaining props (isAdmin, slug, value, kind,
 * label, rows) are kept in the signature so the View call sites don't
 * need to be rewritten — they're ignored at runtime.
 */

import { Fragment } from "react";
import { toCssStyle, type Path } from "@/lib/cms-inline-helpers";
import type { CmsSlug, StylesMap } from "@/lib/cms-schemas";

export type EditableKind =
  | "text"
  | "textarea"
  | "markdown"
  | "url"
  | "image"
  | "loom"
  | "youtube";

interface EditableProps {
  isAdmin: boolean;
  slug: CmsSlug;
  path: Path;
  value: string;
  kind?: EditableKind;
  label?: string;
  rows?: number;
  /** Page-level styles map keyed by dot-joined path. */
  styles?: StylesMap;
  children: React.ReactNode;
}

export function Editable({ styles, path, children }: EditableProps) {
  const tokens = styles?.[path.map(String).join(".")];
  if (!tokens) return <Fragment>{children}</Fragment>;
  return <span style={toCssStyle(tokens)}>{children}</span>;
}
