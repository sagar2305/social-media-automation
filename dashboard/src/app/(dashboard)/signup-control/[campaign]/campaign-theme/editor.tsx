"use client";

/**
 * Brand-theme picker for a single campaign.
 *
 * Top of the form lets the admin pick one of 4 preset themes
 * (Emerald / Rose / Blue / Amber) or a fully custom hex color.
 * Below that, a live Preview pane renders sample UI elements in
 * the currently selected theme + custom color — admins can see
 * the result before they click Save.
 *
 * Save flow reuses the generic CMS pipeline: dirty-tracked via
 * <EditorShell>, persisted with savePageContent(campaign, slug, c).
 * No new server actions needed — the slug "campaign-theme" plugs
 * into the existing reader / writer / version-history infra.
 */

import { useState, type CSSProperties } from "react";
import { Check, Pipette } from "lucide-react";
import { EditorShell, Section } from "../../components/editor-shell";
import { HistoryPanel } from "../../components/history-panel";
import { savePageContent } from "../../actions";
import {
  THEME_PRESETS,
  type CampaignThemeContent,
  type ThemePreset,
} from "@/lib/cms-schemas";

/** Display metadata for each theme card. */
const THEME_META: Record<ThemePreset, { label: string; description: string }> = {
  emerald: {
    label: "Emerald",
    description: "Calm, growth-oriented. The project default.",
  },
  rose: {
    label: "Rose",
    description: "Playful, warm. Pairs well with conversational apps.",
  },
  blue: {
    label: "Blue",
    description: "Trust, utility, professional. Good for tools.",
  },
  amber: {
    label: "Amber",
    description: "Energetic, productivity-forward. Stands out.",
  },
  custom: {
    label: "Custom",
    description: "Pick any hex color — the rest of the ramp auto-derives.",
  },
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function CampaignThemeEditor({
  initial,
  updatedAt,
  campaign,
  campaignLabel,
}: {
  initial: CampaignThemeContent;
  updatedAt: string | null;
  campaign: string;
  campaignLabel: string;
}) {
  const [c, setC] = useState<CampaignThemeContent>(initial);
  // Local input state for the hex picker — kept separate from the
  // saved value so admins can type partial hex without immediately
  // breaking the preview / failing zod validation on save.
  const [hexInput, setHexInput] = useState<string>(
    c.customColor ?? "#2563eb",
  );
  const hexInputIsValid = HEX_RE.test(hexInput);

  function pickPreset(preset: ThemePreset) {
    setC({
      theme: preset,
      // Drop the saved customColor only when leaving custom mode —
      // preserving it lets the admin click back into Custom without
      // losing their hex.
      customColor: preset === "custom" ? (hexInputIsValid ? hexInput : c.customColor) : undefined,
    });
  }

  function onHexChange(next: string) {
    // Auto-prepend # if user types "abc123" without it.
    const normalised = next.startsWith("#") || next === "" ? next : `#${next}`;
    setHexInput(normalised);
    if (HEX_RE.test(normalised) && c.theme === "custom") {
      setC({ theme: "custom", customColor: normalised });
    }
  }

  // The preview pane uses these className+style to mimic exactly
  // what the live layout will render at /creator/<campaign>/*.
  const previewStyle: CSSProperties | undefined =
    c.theme === "custom" && c.customColor
      ? ({ "--brand-custom": c.customColor } as CSSProperties)
      : undefined;

  return (
    <EditorShell
      title={`${campaignLabel} · Brand Theme`}
      livePath={`/creator/${campaign}/brief`}
      backHref={`/signup-control/${campaign}`}
      backLabel={`Back to ${campaignLabel} editors`}
      baseline={initial}
      value={c}
      onChange={setC}
      onSave={() => savePageContent(campaign, "campaign-theme", c)}
    >
      {updatedAt && (
        <p className="text-[11px] text-muted-foreground -mt-1">
          Last saved{" "}
          <time dateTime={updatedAt} suppressHydrationWarning>
            {new Date(updatedAt).toLocaleString()}
          </time>
        </p>
      )}

      <Section title="Pick a brand color">
        <p className="text-xs text-muted-foreground -mt-1 mb-2">
          The selected theme applies to{" "}
          <code>{`/creator/${campaign}/*`}</code>{" "}
          (brief, TikTok setup, login, signup) and this campaign&apos;s
          card on <code>/welcome/campaign</code>. The admin shell stays
          emerald for consistency.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {THEME_PRESETS.map((preset) => {
            const meta = THEME_META[preset];
            const selected = c.theme === preset;
            // For the Custom card the inner swatches mirror the
            // currently-typed hex so the admin sees their pick.
            const customInline: CSSProperties | undefined =
              preset === "custom" && hexInputIsValid
                ? ({ "--brand-custom": hexInput } as CSSProperties)
                : undefined;
            return (
              <button
                key={preset}
                type="button"
                onClick={() => pickPreset(preset)}
                className={`theme-${preset} relative rounded-2xl border p-4 flex flex-col gap-2 text-left transition-all ${
                  selected
                    ? "border-brand-500 ring-2 ring-brand-500/30 bg-brand-500/[0.06]"
                    : "border-border bg-card hover:border-brand-500/40 hover:bg-brand-500/[0.03]"
                }`}
                aria-pressed={selected}
                style={customInline}
              >
                <div className="flex items-center gap-2">
                  {preset === "custom" ? (
                    <Pipette className="h-5 w-5 text-brand-600" />
                  ) : null}
                  <span className="h-5 w-5 rounded-full bg-brand-500 ring-1 ring-black/5" />
                  <span className="h-5 w-5 rounded-full bg-brand-700 ring-1 ring-black/5" />
                  <span className="h-5 w-5 rounded-full bg-brand-300 ring-1 ring-black/5" />
                  {selected && (
                    <span className="ml-auto inline-flex items-center justify-center h-6 w-6 rounded-full bg-brand-600 text-white">
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold leading-tight">{meta.label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    {meta.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {c.theme === "custom" && (
          <div className="mt-3 rounded-xl border border-border bg-card p-4 space-y-2">
            <label htmlFor="custom-hex" className="text-xs font-semibold text-foreground/80">
              Custom brand color
            </label>
            <div className="flex items-center gap-3">
              {/* Native color input — opens the OS color picker. */}
              <input
                type="color"
                value={hexInputIsValid ? hexInput : "#2563eb"}
                onChange={(e) => onHexChange(e.target.value)}
                className="h-10 w-12 rounded-lg border border-border cursor-pointer p-0"
                aria-label="Open color picker"
              />
              <div className="flex-1">
                <input
                  id="custom-hex"
                  type="text"
                  value={hexInput}
                  onChange={(e) => onHexChange(e.target.value)}
                  placeholder="#2563eb"
                  className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/60 transition-shadow"
                  spellCheck={false}
                />
                {!hexInputIsValid && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">
                    Type a 6-digit hex like <code>#2563eb</code>. The OS color
                    picker on the left writes valid hex automatically.
                  </p>
                )}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              The full 50–950 shade ramp auto-derives from this color at
              runtime via <code>color-mix()</code>. Hover, alpha modifiers,
              and dark-mode variants all retint automatically.
            </p>
          </div>
        )}
      </Section>

      <Section title="Preview" defaultOpen={true}>
        <p className="text-[11px] text-muted-foreground -mt-1 mb-3">
          Live preview of common UI elements rendered in the currently
          selected theme.
        </p>
        <div
          className={`theme-${c.theme} rounded-xl border border-border bg-card p-5 space-y-4`}
          style={previewStyle}
        >
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-brand-500/10 text-brand-700 dark:text-brand-400 text-[10px] uppercase tracking-widest font-semibold">
            <Check className="h-3 w-3" />
            Eyebrow badge
          </div>
          <h3 className="text-2xl font-semibold tracking-tight">
            Sample heading on a {THEME_META[c.theme].label.toLowerCase()} theme
          </h3>
          <p className="text-sm text-muted-foreground">
            Body copy stays neutral. Buttons, links, badges, and accents
            shift to the brand color.
          </p>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              className="inline-flex h-10 items-center gap-1.5 px-4 rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 hover:from-brand-500 hover:to-brand-700 text-white text-sm font-semibold ring-1 ring-inset ring-white/15 shadow-[0_4px_14px_-2px_rgba(0,0,0,0.15)]"
            >
              Primary button
            </button>
            <button
              type="button"
              className="inline-flex h-10 items-center gap-1.5 px-3 rounded-lg border border-brand-500/30 bg-white hover:bg-brand-50 text-brand-700 dark:text-brand-300 text-sm font-semibold transition-colors"
            >
              Secondary button
            </button>
            <span className="inline-flex h-10 items-center gap-1.5 px-3 rounded-lg bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-200 text-sm font-medium">
              Tinted chip
            </span>
          </div>
          {/* Mini 11-shade swatch row so admins see the full ramp,
              especially useful for the auto-derived custom ramp.
              Classes are listed literally so Tailwind's JIT compiler
              picks them up (`bg-brand-${n}` template strings would
              be invisible to the scanner). */}
          <div className="flex gap-1 pt-2">
            <span className="h-6 flex-1 rounded bg-brand-50  ring-1 ring-black/5" title="brand-50" />
            <span className="h-6 flex-1 rounded bg-brand-100 ring-1 ring-black/5" title="brand-100" />
            <span className="h-6 flex-1 rounded bg-brand-200 ring-1 ring-black/5" title="brand-200" />
            <span className="h-6 flex-1 rounded bg-brand-300 ring-1 ring-black/5" title="brand-300" />
            <span className="h-6 flex-1 rounded bg-brand-400 ring-1 ring-black/5" title="brand-400" />
            <span className="h-6 flex-1 rounded bg-brand-500 ring-1 ring-black/5" title="brand-500" />
            <span className="h-6 flex-1 rounded bg-brand-600 ring-1 ring-black/5" title="brand-600" />
            <span className="h-6 flex-1 rounded bg-brand-700 ring-1 ring-black/5" title="brand-700" />
            <span className="h-6 flex-1 rounded bg-brand-800 ring-1 ring-black/5" title="brand-800" />
            <span className="h-6 flex-1 rounded bg-brand-900 ring-1 ring-black/5" title="brand-900" />
            <span className="h-6 flex-1 rounded bg-brand-950 ring-1 ring-black/5" title="brand-950" />
          </div>
        </div>
      </Section>

      <HistoryPanel<CampaignThemeContent>
        slug="campaign-theme"
        campaign={campaign}
        onRestore={(restored) => {
          setC(restored);
          if (restored.customColor) setHexInput(restored.customColor);
        }}
      />
    </EditorShell>
  );
}
