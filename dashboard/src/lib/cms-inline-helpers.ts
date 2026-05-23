/**
 * Helpers shared between the inline `<Editable>` UI and the
 * `updateCmsField` server action.
 *
 *   setAtPath(obj, ["hero", "heading"], "New title")
 *   setAtPath(arr, [2, "title"], "Edited")
 *
 * Returns a deep-cloned root so the caller can safely diff / validate
 * the result with zod.
 */

import type React from "react";

export type Path = ReadonlyArray<string | number>;

export function setAtPath<T>(root: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T;
  // structuredClone is available in Node 17+ and modern browsers — Next 16
  // / React 19 runs on Node 18+ so this is safe.
  const next = structuredClone(root) as unknown;
  let cursor: unknown = next;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (cursor == null || typeof cursor !== "object") {
      throw new Error(`setAtPath: cannot traverse non-object at index ${i} (key=${String(key)})`);
    }
    // Coerce array index strings to numbers when the cursor is an array.
    // Reject NaN (e.g. path traversal accidentally hit a non-numeric
    // segment while the cursor is an array — would otherwise create a
    // string property on the array instead of writing to an index).
    let k: string | number;
    if (Array.isArray(cursor)) {
      const idx = Number(key);
      if (!Number.isInteger(idx) || idx < 0) {
        throw new Error(`setAtPath: invalid array index at segment ${i} (key=${String(key)})`);
      }
      k = idx;
    } else {
      k = key as string;
    }
    cursor = (cursor as Record<string | number, unknown>)[k];
  }
  if (cursor == null || typeof cursor !== "object") {
    throw new Error(`setAtPath: parent at ${path.slice(0, -1).join(".")} is not an object`);
  }
  const last = path[path.length - 1];
  let lastKey: string | number;
  if (Array.isArray(cursor)) {
    const idx = Number(last);
    if (!Number.isInteger(idx) || idx < 0) {
      throw new Error(`setAtPath: invalid final array index (key=${String(last)})`);
    }
    lastKey = idx;
  } else {
    lastKey = last as string;
  }
  (cursor as Record<string | number, unknown>)[lastKey] = value;
  return next as T;
}

/** Quick lookup used by editors that need to read a path back out for previews. */
export function getAtPath<T = unknown>(root: unknown, path: Path): T | undefined {
  let cursor: unknown = root;
  for (const key of path) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string | number, unknown>)[key as string | number];
  }
  return cursor as T;
}

/**
 * Look up per-text typography tokens by path and return a CSSProperties
 * object ready to spread onto a `style={...}` attribute. Returns an
 * empty object (not undefined) so callers can blindly spread.
 */
export function styleAtPath(
  styles: Record<string, StylesValue> | undefined,
  path: Path,
): React.CSSProperties {
  if (!styles) return {};
  const key = path.map(String).join(".");
  const t = styles[key];
  if (!t) return {};
  return toCssStyle(t);
}

/** Convert one TypographyTokens object into the equivalent React style object. */
export function toCssStyle(t: StylesValue): React.CSSProperties {
  const css: React.CSSProperties = {};
  if (t.size) css.fontSize = t.size;
  if (t.weight) css.fontWeight = t.weight as React.CSSProperties["fontWeight"];
  if (t.color) css.color = t.color;
  if (t.fontFamily) css.fontFamily = t.fontFamily;
  if (t.fontStyle) css.fontStyle = t.fontStyle;
  if (t.textAlign) css.textAlign = t.textAlign;
  if (t.textTransform) css.textTransform = t.textTransform;
  if (t.lineHeight) css.lineHeight = t.lineHeight;
  if (t.letterSpacing) css.letterSpacing = t.letterSpacing;
  return css;
}

type StylesValue = {
  size?: string;
  weight?: string;
  color?: string;
  fontFamily?: string;
  fontStyle?: "normal" | "italic";
  textAlign?: "left" | "center" | "right" | "justify";
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  lineHeight?: string;
  letterSpacing?: string;
  level?: string;
};

/** Loom share URL or bare id → bare id. Used by both inline + bulk editors. */
export function extractLoomId(raw: string): string {
  const t = raw.trim();
  const m = t.match(/loom\.com\/(?:share|embed)\/([a-z0-9]+)/i);
  return m ? m[1] : t;
}

/** YouTube share URL or bare id → bare id. */
export function extractYouTubeId(raw: string): string {
  const t = raw.trim();
  const m =
    t.match(/[?&]v=([A-Za-z0-9_-]{6,})/) ||
    t.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/) ||
    t.match(/youtube\.com\/(?:shorts|embed)\/([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : t;
}
