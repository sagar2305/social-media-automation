"use client";

import { useState } from "react";
import { EditorShell, Section, FieldRow } from "../components/editor-shell";
import {
  TextField,
  TextAreaField,
  MarkdownField,
  UrlField,
  LoomIdField,
  YouTubeIdField,
  SelectField,
  ImageUploadField,
} from "../components/fields";
import { RepeaterList, StringList } from "../components/repeater-list";
import { CustomSectionsEditor } from "../components/custom-sections-editor";
import { HistoryPanel } from "../components/history-panel";
import { savePageContent } from "../actions";
import type { BriefContent, StylesMap } from "@/lib/cms-schemas";

const PILL_ICONS = [
  { value: "check", label: "Checkmark" },
  { value: "wallet", label: "Wallet" },
  { value: "rocket", label: "Rocket" },
  { value: "sparkles", label: "Sparkles" },
  { value: "clock", label: "Clock" },
] as const;

export function BriefEditor({
  initial,
  updatedAt,
}: {
  initial: BriefContent;
  updatedAt: string | null;
}) {
  const [c, setC] = useState<BriefContent>(initial);

  // Helper: produce a setter that updates one top-level section.
  function setSection<K extends keyof BriefContent>(key: K) {
    return (next: BriefContent[K]) => setC((prev) => ({ ...prev, [key]: next }));
  }

  /**
   * Bundle of style-related props to spread on a text field. Wires the
   * page's styles map + setter and the field's path so the field can
   * render its Style controls and write into c.styles when changed.
   */
  function styleProps(path: string) {
    return {
      stylePath: path,
      styles: c.styles,
      onStylesChange: (next: StylesMap | undefined) =>
        setC((prev) => ({ ...prev, styles: next })),
    };
  }

  /**
   * Section visibility toggle. The eye icon in each section header lets
   * admins hide that section from the live page without deleting its
   * content. Typography control lives on the per-field ▸ Style toggle
   * (see styleProps below) so it's not in here.
   */
  function metaFor<K extends Exclude<keyof BriefContent, "customSections" | "styles">>(key: K) {
    const section = c[key] as Record<string, unknown>;
    return {
      hidden: section.hidden as boolean | undefined,
      onHiddenChange: (v: boolean) =>
        setSection(key)({ ...c[key], hidden: v || undefined } as BriefContent[K]),
    };
  }

  return (
    <EditorShell
      title="Internship Brief"
      livePath="/creator/brief"
      baseline={initial}
      value={c}
      onChange={setC}
      onSave={() => savePageContent("brief", c)}
    >
      {updatedAt && (
        <p className="text-[11px] text-muted-foreground -mt-1">
          Last saved{" "}
          {/* Server renders in en-US, client in the admin's browser locale;
              both correct for the same instant, but they differ — silence
              the hydration warning. */}
          <time dateTime={updatedAt} suppressHydrationWarning>
            {new Date(updatedAt).toLocaleString()}
          </time>
        </p>
      )}

      <Section title="Hero" meta={metaFor("hero")}>
        <TextField
          label="Eyebrow badge"
          value={c.hero.eyebrow}
          onChange={(v) => setSection("hero")({ ...c.hero, eyebrow: v })}
          {...styleProps("hero.eyebrow")}
        />
        <TextField
          label="Heading"
          value={c.hero.heading}
          onChange={(v) => setSection("hero")({ ...c.hero, heading: v })}
          {...styleProps("hero.heading")}
        />
        <TextAreaField
          label="Subheading"
          rows={3}
          value={c.hero.subheading}
          onChange={(v) => setSection("hero")({ ...c.hero, subheading: v })}
          {...styleProps("hero.subheading")}
        />
      </Section>

      <Section title="Brief video" meta={metaFor("briefVideo")}>
        <TextField
          label="Section heading"
          value={c.briefVideo.heading}
          onChange={(v) => setSection("briefVideo")({ ...c.briefVideo, heading: v })}
          {...styleProps("briefVideo.heading")}
        />
        <TextAreaField
          label="Description"
          rows={2}
          value={c.briefVideo.description}
          onChange={(v) => setSection("briefVideo")({ ...c.briefVideo, description: v })}
          {...styleProps("briefVideo.description")}
        />
        <LoomIdField
          label="Loom share id (or paste full URL)"
          value={c.briefVideo.loomEmbedId}
          onChange={(v) => setSection("briefVideo")({ ...c.briefVideo, loomEmbedId: v })}
        />
        <TextField
          label="“What you'll learn” heading"
          value={c.briefVideo.learnHeading}
          onChange={(v) => setSection("briefVideo")({ ...c.briefVideo, learnHeading: v })}
          {...styleProps("briefVideo.learnHeading")}
        />
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground/80">Bullet points</p>
          <StringList
            items={c.briefVideo.bullets}
            onChange={(v) => setSection("briefVideo")({ ...c.briefVideo, bullets: v })}
            addLabel="Add bullet"
          />
        </div>
      </Section>

      <Section title="About Us" meta={metaFor("aboutUs")}>
        <TextField
          label="Section heading"
          value={c.aboutUs.heading}
          onChange={(v) => setSection("aboutUs")({ ...c.aboutUs, heading: v })}
          {...styleProps("aboutUs.heading")}
        />
        <TextAreaField
          label="Intro paragraph"
          rows={3}
          value={c.aboutUs.intro}
          onChange={(v) => setSection("aboutUs")({ ...c.aboutUs, intro: v })}
          {...styleProps("aboutUs.intro")}
        />
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground/80">App list (bullet items)</p>
          <RepeaterList
            items={c.aboutUs.apps}
            onChange={(v) => setSection("aboutUs")({ ...c.aboutUs, apps: v })}
            newItem={() => ({ name: "", description: "" })}
            summary={(a) => a.name}
            addLabel="Add app"
            renderRow={(a, set, i) => (
              <FieldRow>
                <TextField label="Name" value={a.name} onChange={(v) => set({ ...a, name: v })} {...styleProps(`aboutUs.apps.${i}.name`)} />
                <TextField label="Description" value={a.description} onChange={(v) => set({ ...a, description: v })} {...styleProps(`aboutUs.apps.${i}.description`)} />
              </FieldRow>
            )}
          />
        </div>
        <TextAreaField
          label="Closing paragraph"
          rows={2}
          value={c.aboutUs.closing}
          onChange={(v) => setSection("aboutUs")({ ...c.aboutUs, closing: v })}
          {...styleProps("aboutUs.closing")}
        />
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground/80">App store cards</p>
          <RepeaterList
            items={c.aboutUs.appCards}
            onChange={(v) => setSection("aboutUs")({ ...c.aboutUs, appCards: v })}
            newItem={() => ({ name: "", href: "", icon: "" })}
            summary={(a) => a.name}
            addLabel="Add card"
            renderRow={(a, set, i) => (
              <>
                <FieldRow>
                  <TextField label="Name" value={a.name} onChange={(v) => set({ ...a, name: v })} {...styleProps(`aboutUs.appCards.${i}.name`)} />
                  <UrlField label="App Store URL" value={a.href} onChange={(v) => set({ ...a, href: v })} />
                </FieldRow>
                <ImageUploadField
                  label="App icon"
                  hint="Upload a square icon (1:1), or paste a URL."
                  value={a.icon}
                  onChange={(v) => set({ ...a, icon: v })}
                />
              </>
            )}
          />
        </div>
      </Section>

      <Section title="Intern showcase (videos)" meta={metaFor("internShowcase")}>
        <TextField
          label="Section heading"
          value={c.internShowcase.heading}
          onChange={(v) => setSection("internShowcase")({ ...c.internShowcase, heading: v })}
          {...styleProps("internShowcase.heading")}
        />
        <TextField
          label="Subtitle"
          value={c.internShowcase.subtitle}
          onChange={(v) => setSection("internShowcase")({ ...c.internShowcase, subtitle: v })}
          {...styleProps("internShowcase.subtitle")}
        />
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground/80">Tiles</p>
          <RepeaterList
            items={c.internShowcase.tiles}
            onChange={(v) => setSection("internShowcase")({ ...c.internShowcase, tiles: v })}
            newItem={() => ({ handle: "", youtubeId: "", tiktokUrl: "" })}
            summary={(t) => t.handle || t.youtubeId}
            addLabel="Add tile"
            renderRow={(t, set) => (
              <>
                <FieldRow>
                  <TextField label="Handle" value={t.handle} onChange={(v) => set({ ...t, handle: v })} />
                  <YouTubeIdField label="YouTube id" value={t.youtubeId} onChange={(v) => set({ ...t, youtubeId: v })} />
                </FieldRow>
                <UrlField label="TikTok URL" value={t.tiktokUrl} onChange={(v) => set({ ...t, tiktokUrl: v })} />
              </>
            )}
          />
        </div>
      </Section>

      <Section title="Internship details (Duration / Compensation)" meta={metaFor("internshipDetails")}>
        <TextField
          label="Section heading"
          value={c.internshipDetails.heading}
          onChange={(v) => setSection("internshipDetails")({ ...c.internshipDetails, heading: v })}
          {...styleProps("internshipDetails.heading")}
        />
        <TextAreaField
          label="Summary"
          rows={2}
          value={c.internshipDetails.summary}
          onChange={(v) => setSection("internshipDetails")({ ...c.internshipDetails, summary: v })}
          {...styleProps("internshipDetails.summary")}
        />
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground/80">Panels</p>
          <RepeaterList
            items={c.internshipDetails.panels}
            onChange={(v) => setSection("internshipDetails")({ ...c.internshipDetails, panels: v })}
            newItem={() => ({ heading: "", bullets: [] })}
            summary={(p) => p.heading}
            addLabel="Add panel"
            renderRow={(p, set, i) => (
              <>
                <TextField label="Panel heading" value={p.heading} onChange={(v) => set({ ...p, heading: v })} {...styleProps(`internshipDetails.panels.${i}.heading`)} />
                <StringList items={p.bullets} onChange={(v) => set({ ...p, bullets: v })} addLabel="Add bullet" />
              </>
            )}
          />
        </div>
      </Section>

      <Section title="What you'll do" meta={metaFor("whatYoullDo")}>
        <TextField
          label="Section heading"
          value={c.whatYoullDo.heading}
          onChange={(v) => setSection("whatYoullDo")({ ...c.whatYoullDo, heading: v })}
          {...styleProps("whatYoullDo.heading")}
        />
        <RepeaterList
          items={c.whatYoullDo.columns}
          onChange={(v) => setSection("whatYoullDo")({ ...c.whatYoullDo, columns: v })}
          newItem={() => ({ heading: "", bullets: [] })}
          summary={(col) => col.heading}
          addLabel="Add column"
          renderRow={(col, set, i) => (
            <>
              <TextField label="Column title" value={col.heading} onChange={(v) => set({ ...col, heading: v })} {...styleProps(`whatYoullDo.columns.${i}.heading`)} />
              <StringList items={col.bullets} onChange={(v) => set({ ...col, bullets: v })} addLabel="Add bullet" />
            </>
          )}
        />
      </Section>

      <Section title="Interns we love" meta={metaFor("internsWeLove")}>
        <TextField
          label="Section heading"
          value={c.internsWeLove.heading}
          onChange={(v) => setSection("internsWeLove")({ ...c.internsWeLove, heading: v })}
          {...styleProps("internsWeLove.heading")}
        />
        <RepeaterList
          items={c.internsWeLove.columns}
          onChange={(v) => setSection("internsWeLove")({ ...c.internsWeLove, columns: v })}
          newItem={() => ({ heading: "", bullets: [] })}
          summary={(col) => col.heading}
          addLabel="Add column"
          renderRow={(col, set, i) => (
            <>
              <TextField label="Column title" value={col.heading} onChange={(v) => set({ ...col, heading: v })} {...styleProps(`internsWeLove.columns.${i}.heading`)} />
              <StringList items={col.bullets} onChange={(v) => set({ ...col, bullets: v })} addLabel="Add bullet" />
            </>
          )}
        />
      </Section>

      <Section title="FAQ" meta={metaFor("faq")}>
        <TextField
          label="Section heading"
          value={c.faq.heading}
          onChange={(v) => setSection("faq")({ ...c.faq, heading: v })}
          {...styleProps("faq.heading")}
        />
        <TextField
          label="Subtitle"
          value={c.faq.subtitle}
          onChange={(v) => setSection("faq")({ ...c.faq, subtitle: v })}
          {...styleProps("faq.subtitle")}
        />
        <RepeaterList
          items={c.faq.items}
          onChange={(v) => setSection("faq")({ ...c.faq, items: v })}
          newItem={() => ({ q: "", a: "" })}
          summary={(i) => i.q}
          addLabel="Add FAQ row"
          renderRow={(item, set, i) => (
            <>
              <TextField label="Question" value={item.q} onChange={(v) => set({ ...item, q: v })} {...styleProps(`faq.items.${i}.q`)} />
              <MarkdownField label="Answer (markdown)" rows={4} value={item.a} onChange={(v) => set({ ...item, a: v })} {...styleProps(`faq.items.${i}.a`)} />
            </>
          )}
        />
      </Section>

      <Section title="Help block (above Journey)" meta={metaFor("helpBlock")}>
        <TextField
          label="Heading"
          value={c.helpBlock.heading}
          onChange={(v) => setSection("helpBlock")({ ...c.helpBlock, heading: v })}
          {...styleProps("helpBlock.heading")}
        />
        <TextAreaField
          label="Body"
          rows={3}
          value={c.helpBlock.body}
          onChange={(v) => setSection("helpBlock")({ ...c.helpBlock, body: v })}
          {...styleProps("helpBlock.body")}
        />
        <TextField
          label="Contact note"
          value={c.helpBlock.contactNote}
          onChange={(v) => setSection("helpBlock")({ ...c.helpBlock, contactNote: v })}
          {...styleProps("helpBlock.contactNote")}
        />
        <FieldRow>
          <TextField
            label="Email address"
            value={c.helpBlock.email}
            onChange={(v) => setSection("helpBlock")({ ...c.helpBlock, email: v })}
            {...styleProps("helpBlock.email")}
          />
          <TextField
            label="WhatsApp button label"
            value={c.helpBlock.whatsappLabel}
            onChange={(v) => setSection("helpBlock")({ ...c.helpBlock, whatsappLabel: v })}
            {...styleProps("helpBlock.whatsappLabel")}
          />
        </FieldRow>
        <UrlField
          label="WhatsApp link URL"
          value={c.helpBlock.whatsappUrl}
          onChange={(v) => setSection("helpBlock")({ ...c.helpBlock, whatsappUrl: v })}
        />
      </Section>

      <Section title="Journey to Success" meta={metaFor("journey")}>
        <TextField
          label="Section heading"
          value={c.journey.heading}
          onChange={(v) => setSection("journey")({ ...c.journey, heading: v })}
          {...styleProps("journey.heading")}
        />
        <TextAreaField
          label="Subtitle"
          rows={2}
          value={c.journey.subtitle}
          onChange={(v) => setSection("journey")({ ...c.journey, subtitle: v })}
          {...styleProps("journey.subtitle")}
        />
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground/80">Numbered steps</p>
          <RepeaterList
            items={c.journey.steps}
            onChange={(v) => setSection("journey")({ ...c.journey, steps: v })}
            newItem={() => ({ title: "", desc: "" })}
            summary={(s) => s.title}
            addLabel="Add step"
            renderRow={(s, set, i) => (
              <FieldRow>
                <TextField label="Title" value={s.title} onChange={(v) => set({ ...s, title: v })} {...styleProps(`journey.steps.${i}.title`)} />
                <TextAreaField label="Description" rows={2} value={s.desc} onChange={(v) => set({ ...s, desc: v })} {...styleProps(`journey.steps.${i}.desc`)} />
              </FieldRow>
            )}
          />
        </div>
        <FieldRow>
          <TextField
            label="Final step — title"
            value={c.journey.finalStep.title}
            onChange={(v) => setSection("journey")({ ...c.journey, finalStep: { ...c.journey.finalStep, title: v } })}
            {...styleProps("journey.finalStep.title")}
          />
          <TextAreaField
            label="Final step — description"
            rows={2}
            value={c.journey.finalStep.desc}
            onChange={(v) => setSection("journey")({ ...c.journey, finalStep: { ...c.journey.finalStep, desc: v } })}
            {...styleProps("journey.finalStep.desc")}
          />
        </FieldRow>
        <TextField
          label="Footer line"
          value={c.journey.footer}
          onChange={(v) => setSection("journey")({ ...c.journey, footer: v })}
          {...styleProps("journey.footer")}
        />
      </Section>

      <Section title="Ready-to-get-started CTA hero" meta={metaFor("ctaHero")}>
        <TextField
          label="Eyebrow"
          value={c.ctaHero.eyebrow}
          onChange={(v) => setSection("ctaHero")({ ...c.ctaHero, eyebrow: v })}
          {...styleProps("ctaHero.eyebrow")}
        />
        <TextField
          label="Heading"
          value={c.ctaHero.heading}
          onChange={(v) => setSection("ctaHero")({ ...c.ctaHero, heading: v })}
          {...styleProps("ctaHero.heading")}
        />
        <TextAreaField
          label="Body"
          rows={2}
          value={c.ctaHero.body}
          onChange={(v) => setSection("ctaHero")({ ...c.ctaHero, body: v })}
          {...styleProps("ctaHero.body")}
        />
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground/80">Feature pills</p>
          <RepeaterList
            items={c.ctaHero.pills}
            onChange={(v) => setSection("ctaHero")({ ...c.ctaHero, pills: v })}
            newItem={() => ({ icon: "check" as const, label: "" })}
            summary={(p) => p.label}
            addLabel="Add pill"
            renderRow={(p, set, i) => (
              <FieldRow>
                <SelectField
                  label="Icon"
                  value={p.icon}
                  onChange={(v) => set({ ...p, icon: v })}
                  options={PILL_ICONS}
                />
                <TextField label="Label" value={p.label} onChange={(v) => set({ ...p, label: v })} {...styleProps(`ctaHero.pills.${i}.label`)} />
              </FieldRow>
            )}
          />
        </div>
        <FieldRow>
          <TextField
            label="Primary button label"
            value={c.ctaHero.primaryLabel}
            onChange={(v) => setSection("ctaHero")({ ...c.ctaHero, primaryLabel: v })}
            {...styleProps("ctaHero.primaryLabel")}
          />
          <UrlField
            label="Primary button link"
            value={c.ctaHero.primaryHref}
            onChange={(v) => setSection("ctaHero")({ ...c.ctaHero, primaryHref: v })}
          />
        </FieldRow>
        <FieldRow>
          <TextField
            label="Secondary text"
            value={c.ctaHero.secondaryText}
            onChange={(v) => setSection("ctaHero")({ ...c.ctaHero, secondaryText: v })}
            {...styleProps("ctaHero.secondaryText")}
          />
          <TextField
            label="Secondary link label"
            value={c.ctaHero.secondaryLinkLabel}
            onChange={(v) => setSection("ctaHero")({ ...c.ctaHero, secondaryLinkLabel: v })}
            {...styleProps("ctaHero.secondaryLinkLabel")}
          />
        </FieldRow>
        <UrlField
          label="Secondary link URL"
          value={c.ctaHero.secondaryHref}
          onChange={(v) => setSection("ctaHero")({ ...c.ctaHero, secondaryHref: v })}
        />
        <TextField
          label="Footnote"
          value={c.ctaHero.footnote}
          onChange={(v) => setSection("ctaHero")({ ...c.ctaHero, footnote: v })}
          {...styleProps("ctaHero.footnote")}
        />
      </Section>

      <Section title="Got Questions (bottom)" meta={metaFor("gotQuestions")}>
        <TextField
          label="Heading"
          value={c.gotQuestions.heading}
          onChange={(v) => setSection("gotQuestions")({ ...c.gotQuestions, heading: v })}
          {...styleProps("gotQuestions.heading")}
        />
        <TextAreaField
          label="Subtitle"
          rows={2}
          value={c.gotQuestions.subtitle}
          onChange={(v) => setSection("gotQuestions")({ ...c.gotQuestions, subtitle: v })}
          {...styleProps("gotQuestions.subtitle")}
        />
        <FieldRow>
          <TextField
            label="Email"
            value={c.gotQuestions.email}
            onChange={(v) => setSection("gotQuestions")({ ...c.gotQuestions, email: v })}
            {...styleProps("gotQuestions.email")}
          />
          <TextField
            label="WhatsApp label"
            value={c.gotQuestions.whatsappLabel}
            onChange={(v) => setSection("gotQuestions")({ ...c.gotQuestions, whatsappLabel: v })}
            {...styleProps("gotQuestions.whatsappLabel")}
          />
        </FieldRow>
        <UrlField
          label="WhatsApp URL"
          value={c.gotQuestions.whatsappUrl}
          onChange={(v) => setSection("gotQuestions")({ ...c.gotQuestions, whatsappUrl: v })}
        />
        <TextField
          label="Footnote"
          value={c.gotQuestions.footnote}
          onChange={(v) => setSection("gotQuestions")({ ...c.gotQuestions, footnote: v })}
          {...styleProps("gotQuestions.footnote")}
        />
      </Section>

      <Section title="Page footer" meta={metaFor("footer")}>
        <FieldRow>
          <TextField
            label="Text"
            value={c.footer.text}
            onChange={(v) => setSection("footer")({ ...c.footer, text: v })}
            {...styleProps("footer.text")}
          />
          <TextField
            label="Email"
            value={c.footer.email}
            onChange={(v) => setSection("footer")({ ...c.footer, email: v })}
            {...styleProps("footer.email")}
          />
        </FieldRow>
      </Section>

      <CustomSectionsEditor
        value={c.customSections}
        onChange={(v) => setC((prev) => ({ ...prev, customSections: v }))}
      />

      <HistoryPanel<BriefContent> slug="brief" onRestore={setC} />
    </EditorShell>
  );
}
