"use client";

import { useState } from "react";
import { EditorShell, Section, FieldRow } from "../../components/editor-shell";
import {
  TextField,
  TextAreaField,
  UrlField,
  SelectField,
} from "../../components/fields";
import { RepeaterList, StringList } from "../../components/repeater-list";
import { CustomSectionsEditor } from "../../components/custom-sections-editor";
import { HistoryPanel } from "../../components/history-panel";
import { savePageContent } from "../../actions";
import type { TiktokSetupContent, StylesMap } from "@/lib/cms-schemas";

const STEP_ICONS = [
  { value: "globe", label: "Globe" },
  { value: "mail", label: "Mail" },
  { value: "smartphone", label: "Smartphone" },
  { value: "user-plus", label: "User plus" },
  { value: "settings", label: "Settings" },
  { value: "arrow-right-circle", label: "Arrow right" },
] as const;

const CALLOUT_KINDS = [
  { value: "warning", label: "Warning (red)" },
  { value: "note", label: "Note (amber)" },
] as const;

const PLATFORMS = [
  { value: "android", label: "Android" },
  { value: "ios", label: "iOS" },
  { value: "apk", label: "APK" },
] as const;

const SECTION_PLATFORMS = [
  { value: "", label: "Generic / Setup" },
  { value: "ios", label: "iOS" },
  { value: "android", label: "Android" },
] as const;

export function TiktokSetupEditor({
  initial,
  updatedAt,
  campaign,
  campaignLabel,
}: {
  initial: TiktokSetupContent;
  updatedAt: string | null;
  campaign: string;
  campaignLabel: string;
}) {
  const [c, setC] = useState<TiktokSetupContent>(initial);

  function setSection<K extends keyof TiktokSetupContent>(key: K) {
    return (next: TiktokSetupContent[K]) => setC((prev) => ({ ...prev, [key]: next }));
  }

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
      title={`${campaignLabel} · TikTok Setup Guide`}
      livePath={`/creator/${campaign}/setup/tiktok`}
      backHref={`/signup-control/${campaign}`}
      backLabel={`Back to ${campaignLabel} editors`}
      baseline={initial}
      value={c}
      onChange={setC}
      onSave={() => savePageContent(campaign, "tiktok-setup", c)}
    >
      {updatedAt && (
        <p className="text-[11px] text-muted-foreground -mt-1">
          Last saved{" "}
          <time dateTime={updatedAt} suppressHydrationWarning>
            {new Date(updatedAt).toLocaleString()}
          </time>
        </p>
      )}

      <Section title="Header strip">
        <FieldRow>
          <TextField label="Brand title" value={c.header.brandTitle} onChange={(v) => setSection("header")({ ...c.header, brandTitle: v })} {...styleProps("header.brandTitle")} />
          <TextField label="Product line (subtitle)" value={c.header.productLine} onChange={(v) => setSection("header")({ ...c.header, productLine: v })} {...styleProps("header.productLine")} />
        </FieldRow>
        <TextField label="Back link label" value={c.header.backLinkLabel} onChange={(v) => setSection("header")({ ...c.header, backLinkLabel: v })} {...styleProps("header.backLinkLabel")} />
      </Section>

      <Section title="Hero">
        <TextField label="Eyebrow" value={c.hero.eyebrow} onChange={(v) => setSection("hero")({ ...c.hero, eyebrow: v })} {...styleProps("hero.eyebrow")} />
        <TextField label="Heading" value={c.hero.heading} onChange={(v) => setSection("hero")({ ...c.hero, heading: v })} {...styleProps("hero.heading")} />
        <TextAreaField label="Description" rows={3} value={c.hero.description} onChange={(v) => setSection("hero")({ ...c.hero, description: v })} {...styleProps("hero.description")} />
      </Section>

      <Section title="Progress card">
        <TextField label="Heading" value={c.progressCard.heading} onChange={(v) => setSection("progressCard")({ ...c.progressCard, heading: v })} {...styleProps("progressCard.heading")} />
        <TextAreaField label="Helper banner text" rows={2} value={c.progressCard.helperBanner} onChange={(v) => setSection("progressCard")({ ...c.progressCard, helperBanner: v })} {...styleProps("progressCard.helperBanner")} />
      </Section>

      <Section title="Steps">
        <p className="text-[11px] text-muted-foreground -mt-2">
          Each step appears in order. Add, remove, or reorder freely — the
          live page renumbers the timeline automatically.
        </p>
        <RepeaterList
          items={c.steps}
          onChange={setSection("steps")}
          newItem={() => ({
            icon: "globe" as const,
            title: "",
            badge: "",
            description: "",
            callouts: [],
            videos: [],
            downloads: [],
            sections: [],
            instructions: [],
          })}
          summary={(s) => s.title}
          addLabel="Add step"
          renderRow={(step, set, i) => (
            <div className="space-y-3">
              <FieldRow>
                <SelectField label="Step icon" value={step.icon} onChange={(v) => set({ ...step, icon: v })} options={STEP_ICONS} />
                <TextField label="Badge (optional)" hint="Small badge under the title — emoji + short text. Leave blank to hide." value={step.badge} onChange={(v) => set({ ...step, badge: v })} {...styleProps(`steps.${i}.badge`)} />
              </FieldRow>
              <TextField label="Step title" value={step.title} onChange={(v) => set({ ...step, title: v })} {...styleProps(`steps.${i}.title`)} />
              <TextAreaField label="Description" rows={2} value={step.description} onChange={(v) => set({ ...step, description: v })} {...styleProps(`steps.${i}.description`)} />

              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground/80">Callouts (warnings / notes)</p>
                <RepeaterList
                  items={step.callouts}
                  onChange={(v) => set({ ...step, callouts: v })}
                  newItem={() => ({ kind: "note" as const, title: "", body: "" })}
                  summary={(co) => co.title}
                  addLabel="Add callout"
                  renderRow={(co, setCo) => (
                    <>
                      <FieldRow>
                        <SelectField label="Kind" value={co.kind} onChange={(v) => setCo({ ...co, kind: v })} options={CALLOUT_KINDS} />
                        <TextField label="Title" value={co.title} onChange={(v) => setCo({ ...co, title: v })} />
                      </FieldRow>
                      <TextAreaField label="Body" rows={2} value={co.body} onChange={(v) => setCo({ ...co, body: v })} />
                    </>
                  )}
                />
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground/80">Inline video buttons</p>
                <RepeaterList
                  items={step.videos}
                  onChange={(v) => set({ ...step, videos: v })}
                  newItem={() => ({ label: "", url: "" })}
                  summary={(v) => v.label}
                  addLabel="Add video"
                  renderRow={(v, setV) => (
                    <FieldRow>
                      <TextField label="Label" value={v.label} onChange={(val) => setV({ ...v, label: val })} />
                      <UrlField label="URL" value={v.url} onChange={(val) => setV({ ...v, url: val })} />
                    </FieldRow>
                  )}
                />
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground/80">Inline download buttons</p>
                <RepeaterList
                  items={step.downloads}
                  onChange={(v) => set({ ...step, downloads: v })}
                  newItem={() => ({ label: "", url: "", platform: "android" as const })}
                  summary={(d) => `${d.label} (${d.platform})`}
                  addLabel="Add download"
                  renderRow={(d, setD) => (
                    <>
                      <FieldRow>
                        <TextField label="Label" value={d.label} onChange={(val) => setD({ ...d, label: val })} />
                        <SelectField label="Platform" value={d.platform} onChange={(val) => setD({ ...d, platform: val })} options={PLATFORMS} />
                      </FieldRow>
                      <UrlField label="URL" value={d.url} onChange={(val) => setD({ ...d, url: val })} />
                    </>
                  )}
                />
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground/80">Platform sub-sections</p>
                <RepeaterList
                  items={step.sections}
                  onChange={(v) => set({ ...step, sections: v })}
                  newItem={() => ({ heading: "", platform: "" as const, videos: [], downloads: [] })}
                  summary={(s) => s.heading}
                  addLabel="Add sub-section"
                  renderRow={(s, setS) => (
                    <div className="space-y-3">
                      <FieldRow>
                        <SelectField label="Platform" value={s.platform} onChange={(v) => setS({ ...s, platform: v })} options={SECTION_PLATFORMS} />
                        <TextField label="Heading" value={s.heading} onChange={(v) => setS({ ...s, heading: v })} />
                      </FieldRow>
                      <div className="space-y-1">
                        <p className="text-[11px] font-medium text-foreground/70">Videos in this sub-section</p>
                        <RepeaterList
                          items={s.videos}
                          onChange={(v) => setS({ ...s, videos: v })}
                          newItem={() => ({ label: "", url: "" })}
                          summary={(v) => v.label}
                          addLabel="Add video"
                          renderRow={(v, setV) => (
                            <FieldRow>
                              <TextField label="Label" value={v.label} onChange={(val) => setV({ ...v, label: val })} />
                              <UrlField label="URL" value={v.url} onChange={(val) => setV({ ...v, url: val })} />
                            </FieldRow>
                          )}
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-[11px] font-medium text-foreground/70">Downloads in this sub-section</p>
                        <RepeaterList
                          items={s.downloads}
                          onChange={(v) => setS({ ...s, downloads: v })}
                          newItem={() => ({ label: "", url: "", platform: "android" as const })}
                          summary={(d) => `${d.label} (${d.platform})`}
                          addLabel="Add download"
                          renderRow={(d, setD) => (
                            <>
                              <FieldRow>
                                <TextField label="Label" value={d.label} onChange={(val) => setD({ ...d, label: val })} />
                                <SelectField label="Platform" value={d.platform} onChange={(val) => setD({ ...d, platform: val })} options={PLATFORMS} />
                              </FieldRow>
                              <UrlField label="URL" value={d.url} onChange={(val) => setD({ ...d, url: val })} />
                            </>
                          )}
                        />
                      </div>
                    </div>
                  )}
                />
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground/80">Instructions (numbered list)</p>
                <StringList items={step.instructions} onChange={(v) => set({ ...step, instructions: v })} addLabel="Add instruction" />
              </div>
            </div>
          )}
        />
      </Section>

      <Section title="Final-step footer (Complete Application + Need Help)">
        <TextField label="Heading" value={c.finalFooter.heading} onChange={(v) => setSection("finalFooter")({ ...c.finalFooter, heading: v })} {...styleProps("finalFooter.heading")} />

        <div className="space-y-2 rounded-lg border border-emerald-500/20 bg-white/50 p-3">
          <p className="text-xs font-semibold text-emerald-700/80">Complete Your Application card</p>
          <TextField label="Heading" value={c.finalFooter.completeApp.heading} onChange={(v) => setSection("finalFooter")({ ...c.finalFooter, completeApp: { ...c.finalFooter.completeApp, heading: v } })} {...styleProps("finalFooter.completeApp.heading")} />
          <TextAreaField label="Body" rows={3} value={c.finalFooter.completeApp.body} onChange={(v) => setSection("finalFooter")({ ...c.finalFooter, completeApp: { ...c.finalFooter.completeApp, body: v } })} {...styleProps("finalFooter.completeApp.body")} />
          <FieldRow>
            <TextField label="Button label" value={c.finalFooter.completeApp.signUpLabel} onChange={(v) => setSection("finalFooter")({ ...c.finalFooter, completeApp: { ...c.finalFooter.completeApp, signUpLabel: v } })} {...styleProps("finalFooter.completeApp.signUpLabel")} />
            <UrlField label="Button link" value={c.finalFooter.completeApp.signUpHref} onChange={(v) => setSection("finalFooter")({ ...c.finalFooter, completeApp: { ...c.finalFooter.completeApp, signUpHref: v } })} />
          </FieldRow>
        </div>

        <div className="space-y-2 rounded-lg border border-emerald-500/20 bg-white/50 p-3">
          <p className="text-xs font-semibold text-emerald-700/80">Need Help card</p>
          <TextField label="Heading" value={c.finalFooter.needHelp.heading} onChange={(v) => setSection("finalFooter")({ ...c.finalFooter, needHelp: { ...c.finalFooter.needHelp, heading: v } })} {...styleProps("finalFooter.needHelp.heading")} />
          <TextAreaField label="Body" rows={2} value={c.finalFooter.needHelp.body} onChange={(v) => setSection("finalFooter")({ ...c.finalFooter, needHelp: { ...c.finalFooter.needHelp, body: v } })} {...styleProps("finalFooter.needHelp.body")} />
          <FieldRow>
            <TextField label="Email address" value={c.finalFooter.needHelp.email} onChange={(v) => setSection("finalFooter")({ ...c.finalFooter, needHelp: { ...c.finalFooter.needHelp, email: v } })} {...styleProps("finalFooter.needHelp.email")} />
            <TextField label="Email button label" value={c.finalFooter.needHelp.emailLabel} onChange={(v) => setSection("finalFooter")({ ...c.finalFooter, needHelp: { ...c.finalFooter.needHelp, emailLabel: v } })} {...styleProps("finalFooter.needHelp.emailLabel")} />
          </FieldRow>
          <FieldRow>
            <UrlField label="WhatsApp URL" value={c.finalFooter.needHelp.whatsappUrl} onChange={(v) => setSection("finalFooter")({ ...c.finalFooter, needHelp: { ...c.finalFooter.needHelp, whatsappUrl: v } })} />
            <TextField label="WhatsApp button label" value={c.finalFooter.needHelp.whatsappLabel} onChange={(v) => setSection("finalFooter")({ ...c.finalFooter, needHelp: { ...c.finalFooter.needHelp, whatsappLabel: v } })} {...styleProps("finalFooter.needHelp.whatsappLabel")} />
          </FieldRow>
        </div>
      </Section>

      <CustomSectionsEditor value={c.customSections} onChange={(v) => setC((prev) => ({ ...prev, customSections: v }))} />

      <HistoryPanel<TiktokSetupContent> slug="tiktok-setup" campaign={campaign} onRestore={setC} />
    </EditorShell>
  );
}
