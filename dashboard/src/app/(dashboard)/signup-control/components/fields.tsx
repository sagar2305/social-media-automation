"use client";

/**
 * Form field primitives used by every CMS editor. All emerald-themed so
 * the editors feel like one product with the creator-facing pages.
 */

import { useId, useRef, useState } from "react";
import { ExternalLink, Upload, Loader2, X, Eye, EyeOff, Type } from "lucide-react";
import { uploadCmsImage } from "../actions";
import type { TypographyTokens, StylesMap } from "@/lib/cms-schemas";

/* ─── Shared per-text style controls ────────────────────────────── */

interface StyleableProps {
  /** Dot-joined path that this field's style belongs to (e.g. "hero.heading"). */
  stylePath?: string;
  /** Page-level styles map. */
  styles?: StylesMap;
  /** Setter for the styles map. Called with the next styles object. */
  onStylesChange?: (next: StylesMap | undefined) => void;
}

function FieldStyleToggle({ stylePath, styles, onStylesChange }: StyleableProps) {
  if (!stylePath || !onStylesChange) return null;
  // Capture into consts so closures keep the narrowed string types.
  const path: string = stylePath;
  const setStyles = onStylesChange;
  const value = styles?.[path] ?? {};
  function update(next: TypographyTokens) {
    const map = { ...(styles ?? {}) };
    const hasAny =
      next.size || next.weight || next.color || next.fontFamily ||
      next.fontStyle || next.textAlign || next.textTransform ||
      next.lineHeight || next.letterSpacing || next.level;
    if (hasAny) map[path] = next;
    else delete map[path];
    setStyles(Object.keys(map).length > 0 ? map : undefined);
  }
  function set<K extends keyof TypographyTokens>(k: K, raw: string) {
    const n: TypographyTokens = { ...value };
    if (raw === "") delete n[k];
    else (n as Record<string, unknown>)[k as string] = raw;
    update(n);
  }
  const has =
    !!value.size || !!value.weight || !!value.color || !!value.fontFamily ||
    !!value.fontStyle || !!value.textAlign || !!value.textTransform ||
    !!value.lineHeight || !!value.letterSpacing;
  return (
    <details open={has} className="mt-1 rounded-md border border-emerald-500/20 bg-emerald-500/[0.03] [&_summary::-webkit-details-marker]:hidden">
      <summary className="cursor-pointer select-none px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1">
        <Type className="h-3 w-3" />
        Style {has && <span className="text-emerald-600 ml-0.5">●</span>}
      </summary>
      <div className="px-2.5 pb-2.5 pt-1 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        <StylePick label="Size" value={value.size ?? ""} onChange={(v) => set("size", v)} options={[
          ["", "Default"], ["0.75rem", "Tiny (12)"], ["0.875rem", "Small (14)"], ["1rem", "Base (16)"], ["1.125rem", "Lg (18)"], ["1.25rem", "Xl (20)"], ["1.5rem", "2xl (24)"], ["1.875rem", "3xl (30)"], ["2.25rem", "4xl (36)"], ["3rem", "5xl (48)"], ["3.75rem", "6xl (60)"], ["4.5rem", "7xl (72)"],
        ]} />
        <StylePick label="Weight" value={value.weight ?? ""} onChange={(v) => set("weight", v)} options={[
          ["", "Default"], ["300", "Light"], ["400", "Regular"], ["500", "Medium"], ["600", "Semibold"], ["700", "Bold"], ["800", "Extra bold"],
        ]} />
        <StylePick label="Font" value={value.fontFamily ?? ""} onChange={(v) => set("fontFamily", v)} options={[
          ["", "Default"], ["system-ui, sans-serif", "System sans"], ["Georgia, serif", "Serif"], ['"Courier New", monospace', "Monospace"], ['"Brush Script MT", cursive', "Cursive"], ["Impact, sans-serif", "Display (Impact)"],
        ]} />
        <div className="space-y-0.5">
          <label className="text-[10px] font-medium block text-foreground/70">Color</label>
          <div className="flex items-center gap-1">
            <input type="color" value={value.color || "#000000"} onChange={(e) => set("color", e.target.value)} className="h-7 w-9 rounded border border-emerald-500/30 cursor-pointer p-0" />
            <input type="text" value={value.color ?? ""} onChange={(e) => set("color", e.target.value)} placeholder="default" className="flex-1 h-7 px-1.5 rounded border border-emerald-500/30 bg-white text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-500/50" />
          </div>
        </div>
        <StylePick label="Italic" value={value.fontStyle ?? ""} onChange={(v) => set("fontStyle", v)} options={[["", "Default"], ["normal", "Normal"], ["italic", "Italic"]]} />
        <StylePick label="Align" value={value.textAlign ?? ""} onChange={(v) => set("textAlign", v)} options={[["", "Default"], ["left", "Left"], ["center", "Center"], ["right", "Right"], ["justify", "Justify"]]} />
        <StylePick label="Case" value={value.textTransform ?? ""} onChange={(v) => set("textTransform", v)} options={[["", "Default"], ["uppercase", "UPPER"], ["lowercase", "lower"], ["capitalize", "Capital"], ["none", "None"]]} />
        <div className="space-y-0.5">
          <label className="text-[10px] font-medium block text-foreground/70">Line height</label>
          <input type="text" value={value.lineHeight ?? ""} onChange={(e) => set("lineHeight", e.target.value)} placeholder="1.5" className="w-full h-7 px-1.5 rounded border border-emerald-500/30 bg-white text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-500/50" />
        </div>
        <div className="space-y-0.5">
          <label className="text-[10px] font-medium block text-foreground/70">Letter spacing</label>
          <input type="text" value={value.letterSpacing ?? ""} onChange={(e) => set("letterSpacing", e.target.value)} placeholder="0.05em" className="w-full h-7 px-1.5 rounded border border-emerald-500/30 bg-white text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-500/50" />
        </div>
      </div>
      {has && (
        <div className="px-2.5 pb-2 -mt-1">
          <button type="button" onClick={() => update({})} className="text-[10px] text-rose-700 hover:underline">Reset to default</button>
        </div>
      )}
    </details>
  );
}

function StylePick({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <div className="space-y-0.5">
      <label className="text-[10px] font-medium block text-foreground/70">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full h-7 px-1.5 rounded border border-emerald-500/30 bg-white text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-500/50">
        {options.map(([v, label]) => (
          <option key={v} value={v}>{label}</option>
        ))}
      </select>
    </div>
  );
}

interface BaseProps {
  label?: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}

export function TextField({ label, hint, value, onChange, placeholder, required, stylePath, styles, onStylesChange }: BaseProps & StyleableProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} required={required}>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-10 px-3 rounded-lg border border-emerald-500/30 bg-white text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60 transition-shadow"
      />
      <FieldStyleToggle stylePath={stylePath} styles={styles} onStylesChange={onStylesChange} />
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  rows = 3,
  required,
  stylePath,
  styles,
  onStylesChange,
}: BaseProps & { rows?: number } & StyleableProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} required={required}>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full px-3 py-2 rounded-lg border border-emerald-500/30 bg-white text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60 transition-shadow resize-y"
      />
      <FieldStyleToggle stylePath={stylePath} styles={styles} onStylesChange={onStylesChange} />
    </FieldShell>
  );
}

export function UrlField({ label, hint, value, onChange, placeholder, required }: BaseProps) {
  const id = useId();
  const looksLikeUrl = !value || /^https?:\/\//.test(value) || value.startsWith("/") || value.startsWith("mailto:");
  return (
    <FieldShell id={id} label={label} hint={hint} required={required}>
      <div className="relative">
        <input
          id={id}
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "https://…"}
          className={`w-full h-10 pl-3 pr-9 rounded-lg border bg-white text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition-shadow ${
            looksLikeUrl
              ? "border-emerald-500/30 focus:border-emerald-500/60"
              : "border-amber-500/50 focus:ring-amber-500/40"
          }`}
        />
        {value && /^https?:\/\//.test(value) && (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40"
            title="Open in new tab"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      {!looksLikeUrl && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
          Doesn&apos;t look like a URL. Use http://, https://, or a path starting with /.
        </p>
      )}
    </FieldShell>
  );
}

/**
 * Loom or YouTube share URL → extract the embed id and store just the id.
 * For Loom: stores the share-id. For YouTube: stores the 11-char video id.
 * Accepts either a bare id or a full share URL, and falls back to storing
 * the raw input if neither pattern matches (the admin can paste anything).
 */
export function LoomIdField({
  label,
  hint,
  value,
  onChange,
}: {
  label?: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  function handle(raw: string) {
    const trimmed = raw.trim();
    // Try to pull a Loom share/embed id from a URL like
    // https://www.loom.com/share/<id> or https://www.loom.com/embed/<id>.
    const m = trimmed.match(/loom\.com\/(?:share|embed)\/([a-z0-9]+)/i);
    onChange(m ? m[1] : trimmed);
  }
  return (
    <FieldShell id={id} label={label} hint={hint ?? "Paste a Loom share URL — we'll extract the id."}>
      <div className="relative">
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => handle(e.target.value)}
          placeholder="loom share URL or id"
          className="w-full h-10 pl-3 pr-9 rounded-lg border border-emerald-500/30 bg-white text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60 transition-shadow"
        />
        {value && (
          <a
            href={`https://www.loom.com/share/${value}`}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40"
            title="Preview Loom video"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </FieldShell>
  );
}

export function YouTubeIdField({
  label,
  hint,
  value,
  onChange,
}: {
  label?: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  function handle(raw: string) {
    const trimmed = raw.trim();
    // Match: youtube.com/watch?v=ID  •  youtu.be/ID  •  youtube.com/shorts/ID
    const m =
      trimmed.match(/[?&]v=([A-Za-z0-9_-]{6,})/) ||
      trimmed.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/) ||
      trimmed.match(/youtube\.com\/(?:shorts|embed)\/([A-Za-z0-9_-]{6,})/);
    onChange(m ? m[1] : trimmed);
  }
  return (
    <FieldShell id={id} label={label} hint={hint ?? "Paste a YouTube URL — we'll extract the video id."}>
      <div className="relative">
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => handle(e.target.value)}
          placeholder="youtube URL or id"
          className="w-full h-10 pl-3 pr-9 rounded-lg border border-emerald-500/30 bg-white text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60 transition-shadow"
        />
        {value && (
          <a
            href={`https://www.youtube.com/watch?v=${value}`}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40"
            title="Preview YouTube video"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </FieldShell>
  );
}

export function SelectField<T extends string>({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label?: string;
  hint?: string;
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint}>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full h-10 px-3 rounded-lg border border-emerald-500/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60 transition-shadow"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

/**
 * MarkdownField — same UX as TextAreaField, with a hint about supported
 * markdown syntax displayed below the textarea. The actual rendering
 * happens on the live page via the `<Md>` component.
 */
export function MarkdownField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  rows = 5,
  required,
  stylePath,
  styles,
  onStylesChange,
}: BaseProps & { rows?: number } & StyleableProps) {
  const id = useId();
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint ?? "Supports **bold**, *italic*, [links](url), `code`, ## H2, - bullet lists."}
      required={required}
    >
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full px-3 py-2 rounded-lg border border-emerald-500/30 bg-white text-sm font-mono placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60 transition-shadow resize-y"
      />
      <FieldStyleToggle stylePath={stylePath} styles={styles} onStylesChange={onStylesChange} />
    </FieldShell>
  );
}

/**
 * ImageUploadField — drag/drop or click to upload. Uploads the file
 * via the `uploadCmsImage` server action and stores the resulting
 * public URL via onChange. Also accepts manual URL paste in a smaller
 * input below the preview.
 */
export function ImageUploadField({
  label,
  hint,
  value,
  onChange,
}: {
  label?: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadCmsImage(fd);
      if (res.ok) {
        onChange(res.data.url);
      } else {
        setError(res.error);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <FieldShell id={id} label={label} hint={hint}>
      <div className="space-y-2">
        {value ? (
          <div className="relative inline-block">
            <div className="relative h-24 w-24 rounded-lg overflow-hidden bg-muted ring-1 ring-emerald-500/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={value}
                alt="Preview"
                className="absolute inset-0 w-full h-full object-cover"
              />
            </div>
            <button
              type="button"
              onClick={() => onChange("")}
              className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-rose-600 text-white flex items-center justify-center shadow hover:bg-rose-700"
              title="Clear image"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-dashed border-emerald-500/40 bg-emerald-500/[0.04] hover:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? "Uploading…" : "Upload image"}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="…or paste an image URL"
          className="w-full h-9 px-2.5 rounded-md border border-emerald-500/20 bg-white text-xs text-muted-foreground focus:text-foreground focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </FieldShell>
  );
}

const TYPOGRAPHY_SIZES = [
  { value: "", label: "Default" },
  { value: "0.875rem", label: "Small (14px)" },
  { value: "1rem", label: "Base (16px)" },
  { value: "1.125rem", label: "Lg (18px)" },
  { value: "1.25rem", label: "Xl (20px)" },
  { value: "1.5rem", label: "2xl (24px)" },
  { value: "1.875rem", label: "3xl (30px)" },
  { value: "2.25rem", label: "4xl (36px)" },
  { value: "3rem", label: "5xl (48px)" },
  { value: "3.75rem", label: "6xl (60px)" },
] as const;

const TYPOGRAPHY_WEIGHTS = [
  { value: "", label: "Default" },
  { value: "300", label: "Light" },
  { value: "400", label: "Regular" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semibold" },
  { value: "700", label: "Bold" },
  { value: "800", label: "Extra Bold" },
] as const;

const TYPOGRAPHY_LEVELS = [
  { value: "", label: "Default" },
  { value: "h1", label: "H1" },
  { value: "h2", label: "H2" },
  { value: "h3", label: "H3" },
  { value: "h4", label: "H4" },
] as const;

/**
 * Per-heading typography editor. All four sub-fields are optional — if
 * the admin leaves them on "Default", the page renders the heading at
 * its baked-in style. This makes the feature opt-in: existing rows
 * without typography tokens look identical to before.
 */
export function TypographyTokensField({
  label = "Heading style (optional)",
  value,
  onChange,
}: {
  label?: string;
  value?: TypographyTokens;
  onChange: (next: TypographyTokens | undefined) => void;
}) {
  const v = value ?? {};
  function set<K extends keyof TypographyTokens>(key: K, raw: string) {
    const next: TypographyTokens = { ...v };
    if (raw === "") delete next[key];
    else (next as Record<string, string>)[key] = raw;
    // If all keys cleared, return undefined to keep the JSON tidy.
    const hasAny = next.level || next.size || next.weight || next.color;
    onChange(hasAny ? next : undefined);
  }
  return (
    <details className="rounded-lg border border-emerald-500/20 bg-white/40 [&_summary::-webkit-details-marker]:hidden">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
        ▸ {label}
      </summary>
      <div className="px-3 pb-3 pt-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <SelectField
          label="Level"
          value={v.level ?? ""}
          onChange={(val) => set("level", val)}
          options={TYPOGRAPHY_LEVELS}
        />
        <SelectField
          label="Size"
          value={v.size ?? ""}
          onChange={(val) => set("size", val)}
          options={TYPOGRAPHY_SIZES}
        />
        <SelectField
          label="Weight"
          value={v.weight ?? ""}
          onChange={(val) => set("weight", val)}
          options={TYPOGRAPHY_WEIGHTS}
        />
        <div className="space-y-1">
          <label className="text-xs font-medium block text-foreground/80">Color</label>
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              value={v.color || "#000000"}
              onChange={(e) => set("color", e.target.value)}
              className="h-10 w-10 rounded-md border border-emerald-500/30 cursor-pointer"
            />
            <input
              type="text"
              value={v.color ?? ""}
              onChange={(e) => set("color", e.target.value)}
              placeholder="default"
              className="flex-1 h-10 px-2 rounded-md border border-emerald-500/30 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
          </div>
        </div>
      </div>
    </details>
  );
}

/** Small "Hidden on live page" toggle used in section editor headers. */
export function HiddenToggle({
  value,
  onChange,
}: {
  value: boolean | undefined;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
        value
          ? "bg-rose-500/10 text-rose-700 ring-1 ring-rose-500/30 hover:bg-rose-500/15"
          : "bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/25 hover:bg-emerald-500/15"
      }`}
      title={value ? "This section is hidden on the live page — click to show" : "Click to hide this section on the live page"}
    >
      {value ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      {value ? "Hidden" : "Visible"}
    </button>
  );
}

function FieldShell({
  id,
  label,
  hint,
  required,
  children,
}: {
  id: string;
  label?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={id} className="text-xs font-medium block text-foreground/80">
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </label>
      )}
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
