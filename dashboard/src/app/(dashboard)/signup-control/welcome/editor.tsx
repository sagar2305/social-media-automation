"use client";

import { useState } from "react";
import { EditorShell, Section, FieldRow } from "../components/editor-shell";
import { TextField, TextAreaField, UrlField } from "../components/fields";
import { CustomSectionsEditor } from "../components/custom-sections-editor";
import { HistoryPanel } from "../components/history-panel";
import { savePageContent } from "../actions";
import type { WelcomeContent, StylesMap } from "@/lib/cms-schemas";

export function WelcomeEditor({
  initial,
  updatedAt,
}: {
  initial: WelcomeContent;
  updatedAt: string | null;
}) {
  const [c, setC] = useState<WelcomeContent>(initial);

  function styleProps(path: string) {
    return {
      stylePath: path,
      styles: c.styles,
      onStylesChange: (next: StylesMap | undefined) =>
        setC((prev) => ({ ...prev, styles: next })),
    };
  }

  return (
    <EditorShell
      title="Welcome / Portal Chooser"
      livePath="/welcome"
      baseline={initial}
      value={c}
      onChange={setC}
      onSave={() => savePageContent("welcome", c)}
    >
      {updatedAt && (
        <p className="text-[11px] text-muted-foreground -mt-1">
          Last saved{" "}
          <time dateTime={updatedAt} suppressHydrationWarning>
            {new Date(updatedAt).toLocaleString()}
          </time>
        </p>
      )}

      <Section title="Hero">
        <FieldRow>
          <TextField label="Title" value={c.hero.title} onChange={(v) => setC({ ...c, hero: { ...c.hero, title: v } })} {...styleProps("hero.title")} />
          <TextField label="Subtitle" value={c.hero.subtitle} onChange={(v) => setC({ ...c, hero: { ...c.hero, subtitle: v } })} {...styleProps("hero.subtitle")} />
        </FieldRow>
      </Section>

      <Section title="Creator card (left)">
        <FieldRow>
          <TextField label="Title" value={c.creatorCard.title} onChange={(v) => setC({ ...c, creatorCard: { ...c.creatorCard, title: v } })} {...styleProps("creatorCard.title")} />
          <TextField label="Eyebrow" value={c.creatorCard.eyebrow} onChange={(v) => setC({ ...c, creatorCard: { ...c.creatorCard, eyebrow: v } })} {...styleProps("creatorCard.eyebrow")} />
        </FieldRow>
        <TextAreaField label="Body" rows={3} value={c.creatorCard.body} onChange={(v) => setC({ ...c, creatorCard: { ...c.creatorCard, body: v } })} {...styleProps("creatorCard.body")} />
        <UrlField label="Link target" value={c.creatorCard.href} onChange={(v) => setC({ ...c, creatorCard: { ...c.creatorCard, href: v } })} />
      </Section>

      <Section title="Staff card (right)">
        <FieldRow>
          <TextField label="Title" value={c.staffCard.title} onChange={(v) => setC({ ...c, staffCard: { ...c.staffCard, title: v } })} {...styleProps("staffCard.title")} />
          <TextField label="Eyebrow" value={c.staffCard.eyebrow} onChange={(v) => setC({ ...c, staffCard: { ...c.staffCard, eyebrow: v } })} {...styleProps("staffCard.eyebrow")} />
        </FieldRow>
        <TextAreaField label="Body" rows={3} value={c.staffCard.body} onChange={(v) => setC({ ...c, staffCard: { ...c.staffCard, body: v } })} {...styleProps("staffCard.body")} />
        <UrlField label="Link target" value={c.staffCard.href} onChange={(v) => setC({ ...c, staffCard: { ...c.staffCard, href: v } })} />
      </Section>

      <Section title="Footnote">
        <TextAreaField label="Footnote text" rows={2} value={c.footnote} onChange={(v) => setC({ ...c, footnote: v })} {...styleProps("footnote")} />
      </Section>

      <CustomSectionsEditor
        value={c.customSections}
        onChange={(v) => setC((prev) => ({ ...prev, customSections: v }))}
      />

      <HistoryPanel<WelcomeContent> slug="welcome" onRestore={setC} />
    </EditorShell>
  );
}
