"use client";

/**
 * Admin-side editor for the 13 internship-application fields submitted
 * at /creator/signup (contact info + TikTok / YouTube / Instagram /
 * Facebook credentials). Mirrors the dirty-detection + Save button +
 * saved-flash pattern from owned-accounts-editor.tsx.
 *
 * Password fields:
 *   - Plaintext is NEVER rendered on first load; admin sees ● dots.
 *   - Clicking the eye icon calls revealCreatorPassword() which decrypts
 *     the ciphertext server-side and returns the plaintext.
 *   - Editing a password sets it as a pending change; on Save we send
 *     the plaintext to updateCreator() which re-encrypts before write.
 *   - Empty string saved → server clears the *_enc column.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Save, X, Eye, EyeOff, FileText } from "lucide-react";
import type { Creator } from "@/lib/types";
import { updateCreator, revealCreatorPassword } from "../../payouts/actions";

type PwField =
  | "tiktok_password"
  | "tiktok_email_password"
  | "youtube_password"
  | "instagram_password";

interface FormState {
  phone: string;
  whatsapp: string;
  tiktok_username: string;
  tiktok_password: string | null;       // null = unchanged from server
  tiktok_email: string;
  tiktok_email_password: string | null;
  youtube_gmail: string;
  youtube_password: string | null;
  instagram_username: string;
  instagram_password: string | null;
  facebook_url: string;
}

function initial(creator: Creator): FormState {
  return {
    phone: creator.phone ?? "",
    whatsapp: creator.whatsapp ?? "",
    tiktok_username: creator.tiktok_username ?? "",
    tiktok_password: null,
    tiktok_email: creator.tiktok_email ?? "",
    tiktok_email_password: null,
    youtube_gmail: creator.youtube_gmail ?? "",
    youtube_password: null,
    instagram_username: creator.instagram_username ?? "",
    instagram_password: null,
    facebook_url: creator.facebook_url ?? "",
  };
}

const PW_HAS_VALUE: Record<PwField, keyof Creator> = {
  tiktok_password: "tiktok_password_enc",
  tiktok_email_password: "tiktok_email_password_enc",
  youtube_password: "youtube_password_enc",
  instagram_password: "instagram_password_enc",
};

export function ApplicationDetailsEditor({ creator }: { creator: Creator }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => initial(creator));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Password reveal state — separate from form state so toggling visibility
  // doesn't mark the form dirty. Each field tracks whether the plaintext
  // is currently visible and (when revealed) what value to show.
  const [revealed, setRevealed] = useState<Record<PwField, boolean>>({
    tiktok_password: false,
    tiktok_email_password: false,
    youtube_password: false,
    instagram_password: false,
  });
  const [pwLoading, setPwLoading] = useState<Record<PwField, boolean>>({
    tiktok_password: false,
    tiktok_email_password: false,
    youtube_password: false,
    instagram_password: false,
  });

  const baseline = initial(creator);
  const dirty =
    form.phone !== baseline.phone ||
    form.whatsapp !== baseline.whatsapp ||
    form.tiktok_username !== baseline.tiktok_username ||
    form.tiktok_email !== baseline.tiktok_email ||
    form.youtube_gmail !== baseline.youtube_gmail ||
    form.instagram_username !== baseline.instagram_username ||
    form.facebook_url !== baseline.facebook_url ||
    form.tiktok_password !== null ||
    form.tiktok_email_password !== null ||
    form.youtube_password !== null ||
    form.instagram_password !== null;

  function setField<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function togglePassword(field: PwField) {
    if (revealed[field]) {
      // Hide — also forget any pending edit if it was set
      setRevealed((r) => ({ ...r, [field]: false }));
      return;
    }
    // Reveal — if a pending edit exists, just show it; otherwise fetch the
    // current ciphertext, decrypt, and load it into the input.
    if (form[field] !== null) {
      setRevealed((r) => ({ ...r, [field]: true }));
      return;
    }
    setPwLoading((p) => ({ ...p, [field]: true }));
    const res = await revealCreatorPassword({ creatorId: creator.id, field });
    setPwLoading((p) => ({ ...p, [field]: false }));
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setForm((f) => ({ ...f, [field]: res.data.value ?? "" }));
    setRevealed((r) => ({ ...r, [field]: true }));
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    // Only send what changed. For passwords, null means "not touched";
    // a string (even empty) means admin wants to update.
    const patch: Record<string, unknown> = { id: creator.id };
    if (form.phone !== baseline.phone) patch.phone = form.phone || null;
    if (form.whatsapp !== baseline.whatsapp) patch.whatsapp = form.whatsapp || null;
    if (form.tiktok_username !== baseline.tiktok_username) patch.tiktok_username = form.tiktok_username || null;
    if (form.tiktok_email !== baseline.tiktok_email) patch.tiktok_email = form.tiktok_email || null;
    if (form.youtube_gmail !== baseline.youtube_gmail) patch.youtube_gmail = form.youtube_gmail || null;
    if (form.instagram_username !== baseline.instagram_username) patch.instagram_username = form.instagram_username || null;
    if (form.facebook_url !== baseline.facebook_url) patch.facebook_url = form.facebook_url || null;
    if (form.tiktok_password !== null) patch.tiktok_password = form.tiktok_password;
    if (form.tiktok_email_password !== null) patch.tiktok_email_password = form.tiktok_email_password;
    if (form.youtube_password !== null) patch.youtube_password = form.youtube_password;
    if (form.instagram_password !== null) patch.instagram_password = form.instagram_password;

    const r = await updateCreator(patch as Parameters<typeof updateCreator>[0]);
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
    // Reset all pending password edits — they've been written; the
    // ciphertext is now the new baseline.
    setForm((f) => ({
      ...f,
      tiktok_password: null,
      tiktok_email_password: null,
      youtube_password: null,
      instagram_password: null,
    }));
    setRevealed({
      tiktok_password: false,
      tiktok_email_password: false,
      youtube_password: false,
      instagram_password: false,
    });
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-2">
            <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="text-base font-semibold">Application details</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Submitted via /creator/signup. Admin can edit any field. Passwords are encrypted at rest.
              </p>
            </div>
          </div>
          {savedFlash && (
            <span className="text-xs text-emerald-600 font-medium shrink-0">Saved ✓</span>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Contact */}
        <Fieldset title="Contact">
          <Row>
            <PlainField label="Phone number" value={form.phone} onChange={(v) => setField("phone", v)} placeholder="+91…" />
            <PlainField label="WhatsApp number" value={form.whatsapp} onChange={(v) => setField("whatsapp", v)} placeholder="+91…" />
          </Row>
        </Fieldset>

        {/* TikTok */}
        <Fieldset title="TikTok">
          <Row>
            <PlainField label="Username" value={form.tiktok_username} onChange={(v) => setField("tiktok_username", v)} placeholder="@username" />
            <PwField
              label="Password"
              field="tiktok_password"
              hasStoredValue={Boolean(creator[PW_HAS_VALUE.tiktok_password])}
              pending={form.tiktok_password}
              revealed={revealed.tiktok_password}
              loading={pwLoading.tiktok_password}
              onChange={(v) => setField("tiktok_password", v)}
              onToggle={() => togglePassword("tiktok_password")}
            />
          </Row>
          <Row>
            <PlainField label="Account email" value={form.tiktok_email} onChange={(v) => setField("tiktok_email", v)} placeholder="account@gmail.com" type="email" />
            <PwField
              label="Email password"
              field="tiktok_email_password"
              hasStoredValue={Boolean(creator[PW_HAS_VALUE.tiktok_email_password])}
              pending={form.tiktok_email_password}
              revealed={revealed.tiktok_email_password}
              loading={pwLoading.tiktok_email_password}
              onChange={(v) => setField("tiktok_email_password", v)}
              onToggle={() => togglePassword("tiktok_email_password")}
            />
          </Row>
        </Fieldset>

        {/* YouTube */}
        <Fieldset title="YouTube">
          <Row>
            <PlainField label="Page Gmail" value={form.youtube_gmail} onChange={(v) => setField("youtube_gmail", v)} placeholder="page@gmail.com" type="email" />
            <PwField
              label="Password"
              field="youtube_password"
              hasStoredValue={Boolean(creator[PW_HAS_VALUE.youtube_password])}
              pending={form.youtube_password}
              revealed={revealed.youtube_password}
              loading={pwLoading.youtube_password}
              onChange={(v) => setField("youtube_password", v)}
              onToggle={() => togglePassword("youtube_password")}
            />
          </Row>
        </Fieldset>

        {/* Instagram */}
        <Fieldset title="Instagram">
          <Row>
            <PlainField label="Username" value={form.instagram_username} onChange={(v) => setField("instagram_username", v)} placeholder="@username" />
            <PwField
              label="Password"
              field="instagram_password"
              hasStoredValue={Boolean(creator[PW_HAS_VALUE.instagram_password])}
              pending={form.instagram_password}
              revealed={revealed.instagram_password}
              loading={pwLoading.instagram_password}
              onChange={(v) => setField("instagram_password", v)}
              onToggle={() => togglePassword("instagram_password")}
            />
          </Row>
        </Fieldset>

        {/* Facebook */}
        <Fieldset title="Facebook">
          <Row>
            <PlainField label="Page URL" value={form.facebook_url} onChange={(v) => setField("facebook_url", v)} placeholder="https://facebook.com/…" type="url" wide />
          </Row>
        </Fieldset>

        <div className="flex items-center justify-between pt-2 border-t border-border/60">
          <p className="text-[11px] text-muted-foreground">
            {dirty ? "Unsaved changes" : "All fields saved"}
          </p>
          <Button type="button" onClick={onSave} disabled={!dirty || saving} size="sm">
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Subcomponents ───────────────────────────────────────────── */

function Fieldset({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[10.5px] font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">{children}</div>;
}

function PlainField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  wide,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  wide?: boolean;
}) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="text-xs font-medium text-foreground/80 mb-1 block">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-shadow"
      />
    </label>
  );
}

function PwField({
  label,
  field,
  hasStoredValue,
  pending,
  revealed,
  loading,
  onChange,
  onToggle,
}: {
  label: string;
  field: PwField;
  hasStoredValue: boolean;
  pending: string | null;       // null = unchanged
  revealed: boolean;
  loading: boolean;
  onChange: (v: string) => void;
  onToggle: () => void;
}) {
  // Display value: if pending edit (string) — show it. If revealed via
  // server, that string lives in `pending` (set by togglePassword).
  // If hidden and no pending edit, show masked dots as a placeholder
  // when something is stored, or empty if nothing is stored.
  const showInput = pending !== null;
  const placeholderMask = hasStoredValue ? "•••••••• (saved)" : "Not set";
  return (
    <label className="block">
      <span className="text-xs font-medium text-foreground/80 mb-1 block">{label}</span>
      <div className="relative">
        <input
          type={revealed ? "text" : "password"}
          value={showInput ? (pending as string) : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={showInput ? "" : placeholderMask}
          // Tabindex prevents focusing the hidden input from auto-revealing it.
          // Admin must explicitly click the eye to reveal a stored value.
          className="w-full h-9 pl-3 pr-9 rounded-md border border-border bg-background text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-shadow font-mono tracking-tight"
        />
        <button
          type="button"
          onClick={onToggle}
          disabled={loading}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 inline-flex items-center justify-center text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/40 disabled:opacity-50"
          aria-label={revealed ? `Hide ${field}` : `Reveal ${field}`}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : revealed ? (
            <EyeOff className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </label>
  );
}
