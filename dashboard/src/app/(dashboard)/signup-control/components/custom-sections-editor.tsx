"use client";

/**
 * Reusable "Custom Sections" editor used at the bottom of every page
 * editor. Admins can add new blocks (heading + markdown body + image)
 * that render below the standard, hard-wired sections of the page.
 */

import { RepeaterList } from "./repeater-list";
import {
  TextField,
  MarkdownField,
  ImageUploadField,
  TypographyTokensField,
  HiddenToggle,
} from "./fields";
import { Section } from "./editor-shell";
import type { CustomSection, TypographyTokens } from "@/lib/cms-schemas";

export function CustomSectionsEditor({
  value,
  onChange,
}: {
  value: CustomSection[] | undefined;
  onChange: (next: CustomSection[] | undefined) => void;
}) {
  const items = value ?? [];
  function set(next: CustomSection[]) {
    onChange(next.length === 0 ? undefined : next);
  }
  return (
    <Section
      title="Custom sections"
      hint="Optional — additional content blocks shown at the bottom of the page."
    >
      <RepeaterList
        items={items}
        onChange={set}
        newItem={(): CustomSection => ({
          heading: "",
          body: "",
        })}
        summary={(s) => (typeof s.heading === "string" ? s.heading : s.heading.text) || "(untitled)"}
        addLabel="Add section"
        emptyLabel="No custom sections yet. Click 'Add section' to insert one."
        renderRow={(s, set) => {
          const headingText = typeof s.heading === "string" ? s.heading : s.heading.text;
          const headingTypo =
            typeof s.heading === "string" ? undefined : s.heading.typography;
          function setHeadingText(text: string) {
            // Preserve typography if it exists; collapse to plain string otherwise.
            if (headingTypo) set({ ...s, heading: { text, typography: headingTypo } });
            else set({ ...s, heading: text });
          }
          function setHeadingTypo(t: TypographyTokens | undefined) {
            if (!t) set({ ...s, heading: headingText });
            else set({ ...s, heading: { text: headingText, typography: t } });
          }
          return (
            <div className="space-y-3">
              <div className="flex items-center justify-end gap-2">
                <HiddenToggle
                  value={s.hidden}
                  onChange={(v) => set({ ...s, hidden: v || undefined })}
                />
              </div>
              <TextField label="Heading" value={headingText} onChange={setHeadingText} />
              <TypographyTokensField value={headingTypo} onChange={setHeadingTypo} />
              <MarkdownField
                label="Body (markdown)"
                rows={5}
                value={s.body}
                onChange={(v) => set({ ...s, body: v })}
              />
              <ImageUploadField
                label="Image (optional)"
                value={s.imageUrl ?? ""}
                onChange={(v) => set({ ...s, imageUrl: v || undefined })}
              />
            </div>
          );
        }}
      />
    </Section>
  );
}
