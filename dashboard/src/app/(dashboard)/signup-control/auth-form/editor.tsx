"use client";

import { useState } from "react";
import { EditorShell, Section, FieldRow } from "../components/editor-shell";
import { TextField, TextAreaField } from "../components/fields";
import { CustomSectionsEditor } from "../components/custom-sections-editor";
import { HistoryPanel } from "../components/history-panel";
import { savePageContent } from "../actions";
import type { AuthFormContent, StylesMap } from "@/lib/cms-schemas";

export function AuthFormEditor({
  initial,
  updatedAt,
}: {
  initial: AuthFormContent;
  updatedAt: string | null;
}) {
  const [c, setC] = useState<AuthFormContent>(initial);

  function set<K extends keyof AuthFormContent>(key: K) {
    return (next: AuthFormContent[K]) => setC((prev) => ({ ...prev, [key]: next }));
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
      title="Login & Signup Form"
      livePath="/creator/signup"
      baseline={initial}
      value={c}
      onChange={setC}
      onSave={() => savePageContent("auth-form", c)}
    >
      {updatedAt && (
        <p className="text-[11px] text-muted-foreground -mt-1">
          Last saved{" "}
          <time dateTime={updatedAt} suppressHydrationWarning>
            {new Date(updatedAt).toLocaleString()}
          </time>
        </p>
      )}

      <Section title="Header copy">
        <TextField label="Back link text" value={c.backLink} onChange={(v) => setC({ ...c, backLink: v })} {...styleProps("backLink")} />
        <TextField label="Heading" value={c.hero.heading} onChange={(v) => set("hero")({ ...c.hero, heading: v })} {...styleProps("hero.heading")} />
        <TextField label="Subheading" value={c.hero.subheading} onChange={(v) => set("hero")({ ...c.hero, subheading: v })} {...styleProps("hero.subheading")} />
        <TextField label="Internship badge" value={c.hero.badge} onChange={(v) => set("hero")({ ...c.hero, badge: v })} {...styleProps("hero.badge")} />
      </Section>

      <Section title="Tab labels">
        <FieldRow>
          <TextField label="Sign-in tab" value={c.tabs.signIn} onChange={(v) => set("tabs")({ ...c.tabs, signIn: v })} {...styleProps("tabs.signIn")} />
          <TextField label="Sign-up tab" value={c.tabs.signUp} onChange={(v) => set("tabs")({ ...c.tabs, signUp: v })} {...styleProps("tabs.signUp")} />
        </FieldRow>
      </Section>

      <Section title="Sign In form">
        <FieldRow>
          <TextField label="Email label" value={c.signIn.emailLabel} onChange={(v) => set("signIn")({ ...c.signIn, emailLabel: v })} {...styleProps("signIn.emailLabel")} />
          <TextField label="Email placeholder" hint="Placeholder text inside the input — can't be visually re-styled here." value={c.signIn.emailPlaceholder} onChange={(v) => set("signIn")({ ...c.signIn, emailPlaceholder: v })} />
        </FieldRow>
        <FieldRow>
          <TextField label="Password label" value={c.signIn.passwordLabel} onChange={(v) => set("signIn")({ ...c.signIn, passwordLabel: v })} {...styleProps("signIn.passwordLabel")} />
          <TextField label="Password placeholder" hint="Placeholder text inside the input — can't be visually re-styled here." value={c.signIn.passwordPlaceholder} onChange={(v) => set("signIn")({ ...c.signIn, passwordPlaceholder: v })} />
        </FieldRow>
        <FieldRow>
          <TextField label="Submit button (idle)" value={c.signIn.submitIdle} onChange={(v) => set("signIn")({ ...c.signIn, submitIdle: v })} {...styleProps("signIn.submitIdle")} />
          <TextField label="Submit button (loading)" value={c.signIn.submitLoading} onChange={(v) => set("signIn")({ ...c.signIn, submitLoading: v })} {...styleProps("signIn.submitLoading")} />
        </FieldRow>
      </Section>

      <Section title="Sign Up form — labels & placeholders">
        <FieldRow>
          <TextField label="Full name label" value={c.signUp.fullNameLabel} onChange={(v) => set("signUp")({ ...c.signUp, fullNameLabel: v })} {...styleProps("signUp.fullNameLabel")} />
          <TextField label="Full name placeholder" hint="Placeholder text inside the input — can't be visually re-styled here." value={c.signUp.fullNamePlaceholder} onChange={(v) => set("signUp")({ ...c.signUp, fullNamePlaceholder: v })} />
        </FieldRow>
        <FieldRow>
          <TextField label="Email label" value={c.signUp.emailLabel} onChange={(v) => set("signUp")({ ...c.signUp, emailLabel: v })} {...styleProps("signUp.emailLabel")} />
          <TextField label="Email placeholder" hint="Placeholder text inside the input — can't be visually re-styled here." value={c.signUp.emailPlaceholder} onChange={(v) => set("signUp")({ ...c.signUp, emailPlaceholder: v })} />
        </FieldRow>
        <FieldRow>
          <TextField label="Phone label" value={c.signUp.phoneLabel} onChange={(v) => set("signUp")({ ...c.signUp, phoneLabel: v })} {...styleProps("signUp.phoneLabel")} />
          <TextField label="Phone placeholder" hint="Placeholder text inside the input — can't be visually re-styled here." value={c.signUp.phonePlaceholder} onChange={(v) => set("signUp")({ ...c.signUp, phonePlaceholder: v })} />
        </FieldRow>
        <FieldRow>
          <TextField label="WhatsApp label" value={c.signUp.whatsappLabel} onChange={(v) => set("signUp")({ ...c.signUp, whatsappLabel: v })} {...styleProps("signUp.whatsappLabel")} />
          <TextField label="WhatsApp placeholder" hint="Placeholder text inside the input — can't be visually re-styled here." value={c.signUp.whatsappPlaceholder} onChange={(v) => set("signUp")({ ...c.signUp, whatsappPlaceholder: v })} />
        </FieldRow>
      </Section>

      <Section title="Sign Up form — “Applying For”">
        <TextField label="Section label" value={c.signUp.applyingForLabel} onChange={(v) => set("signUp")({ ...c.signUp, applyingForLabel: v })} {...styleProps("signUp.applyingForLabel")} />
        <TextField label="Team chip label" value={c.signUp.applyingForTeamLabel} onChange={(v) => set("signUp")({ ...c.signUp, applyingForTeamLabel: v })} {...styleProps("signUp.applyingForTeamLabel")} />
        <TextAreaField label="Body line" rows={2} value={c.signUp.applyingForBody} onChange={(v) => set("signUp")({ ...c.signUp, applyingForBody: v })} {...styleProps("signUp.applyingForBody")} />
        <TextField label="Footnote" value={c.signUp.applyingForFootnote} onChange={(v) => set("signUp")({ ...c.signUp, applyingForFootnote: v })} {...styleProps("signUp.applyingForFootnote")} />
      </Section>

      <Section title="Sign Up form — platforms heading + hints">
        <TextField label="Section heading" value={c.signUp.platformsHeading} onChange={(v) => set("signUp")({ ...c.signUp, platformsHeading: v })} {...styleProps("signUp.platformsHeading")} />
        <TextField label="Section hint" value={c.signUp.platformsHint} onChange={(v) => set("signUp")({ ...c.signUp, platformsHint: v })} {...styleProps("signUp.platformsHint")} />
        <TextField label="TikTok group hint" value={c.signUp.tiktokHint} onChange={(v) => set("signUp")({ ...c.signUp, tiktokHint: v })} {...styleProps("signUp.tiktokHint")} />
      </Section>

      <Section title="Sign Up form — submit + success">
        <FieldRow>
          <TextField label="Dashboard password label" value={c.signUp.dashboardPasswordLabel} onChange={(v) => set("signUp")({ ...c.signUp, dashboardPasswordLabel: v })} {...styleProps("signUp.dashboardPasswordLabel")} />
          <TextField label="Dashboard password placeholder" hint="Placeholder text inside the input — can't be visually re-styled here." value={c.signUp.dashboardPasswordPlaceholder} onChange={(v) => set("signUp")({ ...c.signUp, dashboardPasswordPlaceholder: v })} />
        </FieldRow>
        <FieldRow>
          <TextField label="Submit button (idle)" value={c.signUp.submitIdle} onChange={(v) => set("signUp")({ ...c.signUp, submitIdle: v })} {...styleProps("signUp.submitIdle")} />
          <TextField label="Submit button (loading)" value={c.signUp.submitLoading} onChange={(v) => set("signUp")({ ...c.signUp, submitLoading: v })} {...styleProps("signUp.submitLoading")} />
        </FieldRow>
        <TextField label="Success heading" value={c.signUp.successHeading} onChange={(v) => set("signUp")({ ...c.signUp, successHeading: v })} {...styleProps("signUp.successHeading")} />
        <FieldRow>
          <TextField label="Success body prefix" value={c.signUp.successBodyPrefix} onChange={(v) => set("signUp")({ ...c.signUp, successBodyPrefix: v })} {...styleProps("signUp.successBodyPrefix")} />
          <TextField label="Success body suffix" value={c.signUp.successBodySuffix} onChange={(v) => set("signUp")({ ...c.signUp, successBodySuffix: v })} {...styleProps("signUp.successBodySuffix")} />
        </FieldRow>
      </Section>

      <CustomSectionsEditor
        value={c.customSections}
        onChange={(v) => setC((prev) => ({ ...prev, customSections: v }))}
      />

      <HistoryPanel<AuthFormContent> slug="auth-form" onRestore={setC} />
    </EditorShell>
  );
}
