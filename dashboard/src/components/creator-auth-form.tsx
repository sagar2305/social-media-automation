"use client";

/**
 * Unified Sign In / Sign Up form for the creator portal.
 *
 * All user-visible copy (heading, subheading, badge, tab labels, field
 * labels, placeholders, success state) comes from the CMS via the
 * `copy` prop. The two route pages (/creator/login, /creator/signup)
 * fetch that copy and pass it in. Admins can edit every label from
 * /signup-control/auth-form.
 *
 * Behavioural pieces (Supabase auth.signIn / auth.signUp, validation,
 * router redirects) stay hard-coded — only the visible text is editable.
 */

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import {
  Eye, EyeOff, CheckCircle2, ChevronLeft, Sparkles, AlertTriangle, Mail,
  Music2, Video, Camera, Users,
} from "lucide-react";
import type { AuthFormContent } from "@/lib/cms-schemas";
import { Editable } from "@/components/cms-inline/editable";

type Tab = "signin" | "signup";

export function CreatorAuthForm({
  defaultTab,
  copy,
  campaign = "minutewise",
}: {
  defaultTab: Tab;
  copy: AuthFormContent;
  /** Which campaign the creator is signing up for. Determines the
   *  `applying_for` flag stored in auth user_metadata, the URL the
   *  Sign In/Sign Up tab toggle navigates to, and the campaign that
   *  flows through to /auth/callback after email confirmation.
   *  Typed as string so DB-driven campaigns (added via /campaigns/new)
   *  work without a code change. */
  campaign?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(defaultTab);

  function switchTab(next: Tab) {
    if (next === tab) return;
    setTab(next);
    router.replace(next === "signin"
      ? `/creator/${campaign}/login`
      : `/creator/${campaign}/signup`);
  }

  return (
    <div className="w-full max-w-xl px-4 py-10 sm:py-14 space-y-4">
      <Link
        href="/welcome"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        <Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["backLink"]} value={copy.backLink} kind="text">{copy.backLink}</Editable>
      </Link>

      <div className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="p-7 sm:p-9 space-y-7">
          <div className="flex justify-center">
            <Image
              src="/brewapps-logo.png"
              alt="Brewapps"
              width={144}
              height={144}
              priority
              className="h-24 w-auto"
            />
          </div>

          <div className="text-center space-y-2.5">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              <Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["hero", "heading"]} value={copy.hero.heading} kind="text">{copy.hero.heading}</Editable>
            </h1>
            <p className="text-sm text-muted-foreground">
              <Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["hero", "subheading"]} value={copy.hero.subheading} kind="text">{copy.hero.subheading}</Editable>
            </p>
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-brand-500/10 text-brand-700 dark:text-brand-400 text-xs font-medium">
              <Sparkles className="h-3 w-3" />
              <Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["hero", "badge"]} value={copy.hero.badge} kind="text">{copy.hero.badge}</Editable>
            </span>
          </div>

          <div className="flex border-b border-border">
            <TabButton
              active={tab === "signin"}
              onClick={() => switchTab("signin")}
              label={<Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["tabs", "signIn"]} value={copy.tabs.signIn} kind="text">{copy.tabs.signIn}</Editable>}
            />
            <TabButton
              active={tab === "signup"}
              onClick={() => switchTab("signup")}
              label={<Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["tabs", "signUp"]} value={copy.tabs.signUp} kind="text">{copy.tabs.signUp}</Editable>}
            />
          </div>

          {tab === "signin"
            ? <SignInForm copy={copy} campaign={campaign} />
            : <SignUpForm copy={copy} campaign={campaign} />}
        </div>
      </div>
    </div>
  );
}

/* ─── Sign In ─────────────────────────────────────────────────── */

function SignInForm({ copy, campaign }: { copy: AuthFormContent; campaign: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [resendError, setResendError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const sb = createBrowserSupabase();
    const { error: err } = await sb.auth.signInWithPassword({ email, password });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    router.push(`/auth/relink?from=creator&campaign=${encodeURIComponent(campaign)}`);
    router.refresh();
  }

  async function onResend() {
    if (!email) {
      setResendError("Type your email above first, then click resend.");
      setResendStatus("error");
      return;
    }
    setResendStatus("sending");
    setResendError(null);
    const sb = createBrowserSupabase();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { error: err } = await sb.auth.resend({
      type: "signup",
      email,
      options: {
        // Mirror the campaign through to /auth/callback so a re-issued
        // confirmation email returns the creator to their own login,
        // not bare /creator/login (which only resolves to Minutewise).
        emailRedirectTo: `${origin}/auth/callback?from=creator&campaign=${encodeURIComponent(campaign)}`,
      },
    });
    if (err) {
      setResendError(err.message);
      setResendStatus("error");
      return;
    }
    setResendStatus("sent");
  }

  const banner = reason ? reasonBanner(reason) : null;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {banner && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-amber-900 dark:text-amber-200">{banner.title}</p>
              <p className="text-amber-800 dark:text-amber-300/90">{banner.body}</p>
            </div>
          </div>
          {banner.showResend && (
            <div className="pt-1 pl-6">
              {resendStatus === "sent" ? (
                <p className="text-brand-700 dark:text-brand-400 inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  New confirmation email sent. Check your inbox (and spam).
                </p>
              ) : (
                <button
                  type="button"
                  onClick={onResend}
                  disabled={resendStatus === "sending"}
                  className="inline-flex items-center gap-1 text-amber-900 dark:text-amber-200 underline hover:no-underline disabled:opacity-50"
                >
                  <Mail className="h-3.5 w-3.5" />
                  {resendStatus === "sending" ? "Sending…" : "Resend confirmation email"}
                </button>
              )}
              {resendError && (
                <p className="text-rose-600 dark:text-rose-400 mt-1">{resendError}</p>
              )}
            </div>
          )}
        </div>
      )}
      <Field label={<Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["signIn", "emailLabel"]} value={copy.signIn.emailLabel} kind="text">{copy.signIn.emailLabel}</Editable>} required>
        <TextInput
          type="email"
          placeholder={copy.signIn.emailPlaceholder}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </Field>
      <Field label={<Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["signIn", "passwordLabel"]} value={copy.signIn.passwordLabel} kind="text">{copy.signIn.passwordLabel}</Editable>} required>
        <PasswordInput
          placeholder={copy.signIn.passwordPlaceholder}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          show={showPw}
          onToggle={() => setShowPw((v) => !v)}
          required
        />
      </Field>
      {error && <ErrorRow>{error}</ErrorRow>}
      <PrimaryButton disabled={loading}>
        {loading
          ? <Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["signIn", "submitLoading"]} value={copy.signIn.submitLoading} kind="text">{copy.signIn.submitLoading}</Editable>
          : <Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["signIn", "submitIdle"]} value={copy.signIn.submitIdle} kind="text">{copy.signIn.submitIdle}</Editable>}
      </PrimaryButton>
    </form>
  );
}

interface BannerInfo {
  title: string;
  body: string;
  showResend: boolean;
}

function reasonBanner(reason: string): BannerInfo {
  switch (reason) {
    case "otp_expired":
      return {
        title: "Confirmation link expired",
        body: "Your email link was already used or older than 24 hours. Type your email below, then resend a fresh one.",
        showResend: true,
      };
    case "access_denied":
      return {
        title: "Email confirmation rejected",
        body: "Supabase couldn't verify the link. Resend a fresh one and try again.",
        showResend: true,
      };
    case "not-a-creator":
      return {
        title: "Email not confirmed yet",
        body: "Open the latest 'Confirm your signup' email from Supabase and click the button there before signing in. If you can't find it, resend below.",
        showResend: true,
      };
    case "unlinked":
      return {
        title: "Account not linked",
        body: "Your account exists but isn't connected to a creator profile. Contact your admin.",
        showResend: false,
      };
    default:
      return {
        title: "Sign-in issue",
        body: `Server reported: ${reason}. Try again or contact your admin.`,
        showResend: false,
      };
  }
}

/* ─── Sign Up ─────────────────────────────────────────────────── */

interface SignupFormState {
  fullName: string;
  personalEmail: string;
  phone: string;
  whatsapp: string;
  tiktokUsername: string;
  tiktokPassword: string;
  tiktokEmail: string;
  tiktokEmailPassword: string;
  youtubeGmail: string;
  youtubePassword: string;
  instagramUsername: string;
  instagramPassword: string;
  facebookUrl: string;
  dashboardPassword: string;
}

const EMPTY_FORM: SignupFormState = {
  fullName: "",
  personalEmail: "",
  phone: "",
  whatsapp: "",
  tiktokUsername: "",
  tiktokPassword: "",
  tiktokEmail: "",
  tiktokEmailPassword: "",
  youtubeGmail: "",
  youtubePassword: "",
  instagramUsername: "",
  instagramPassword: "",
  facebookUrl: "",
  dashboardPassword: "",
};

function SignUpForm({ copy, campaign }: { copy: AuthFormContent; campaign: string }) {
  const [form, setForm] = useState<SignupFormState>(EMPTY_FORM);
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function setField<K extends keyof SignupFormState>(k: K) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.dashboardPassword.length < 6) {
      setError("Dashboard password must be at least 6 characters");
      return;
    }

    setLoading(true);
    setError(null);

    const sb = createBrowserSupabase();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { error: err } = await sb.auth.signUp({
      email: form.personalEmail,
      password: form.dashboardPassword,
      options: {
        // `&campaign=<slug>` is read back by /auth/callback so the
        // confirmation-email landing page returns the creator to
        // /creator/<campaign>/login instead of dumping every campaign
        // onto Minutewise.
        emailRedirectTo: `${origin}/auth/callback?from=creator&campaign=${encodeURIComponent(campaign)}`,
        data: {
          full_name: form.fullName,
          phone_number: form.phone,
          whatsapp_number: form.whatsapp,
          applying_for: campaign,
          tiktok_username: form.tiktokUsername,
          tiktok_password: form.tiktokPassword,
          tiktok_email: form.tiktokEmail,
          tiktok_email_password: form.tiktokEmailPassword,
          youtube_gmail: form.youtubeGmail,
          youtube_password: form.youtubePassword,
          instagram_username: form.instagramUsername,
          instagram_password: form.instagramPassword,
          facebook_url: form.facebookUrl,
        },
      },
    });

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setSuccess(true);
    setLoading(false);
  }

  if (success) {
    return (
      <div className="text-center space-y-3 py-4">
        <div className="h-12 w-12 rounded-full bg-brand-500/15 text-brand-700 dark:text-brand-400 flex items-center justify-center mx-auto">
          <CheckCircle2 className="h-6 w-6" strokeWidth={2.25} />
        </div>
        <h3 className="text-lg font-semibold">
          <Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["signUp", "successHeading"]} value={copy.signUp.successHeading} kind="text">{copy.signUp.successHeading}</Editable>
        </h3>
        <p className="text-sm text-muted-foreground">
          <Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["signUp", "successBodyPrefix"]} value={copy.signUp.successBodyPrefix} kind="text">{copy.signUp.successBodyPrefix}</Editable> <strong>{form.personalEmail}</strong>.
          {" "}<Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["signUp", "successBodySuffix"]} value={copy.signUp.successBodySuffix} kind="text">{copy.signUp.successBodySuffix}</Editable>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label={<Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["signUp", "fullNameLabel"]} value={copy.signUp.fullNameLabel} kind="text">{copy.signUp.fullNameLabel}</Editable>} required>
        <TextInput placeholder={copy.signUp.fullNamePlaceholder} required value={form.fullName} onChange={setField("fullName")} />
      </Field>
      <Field label={<Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["signUp", "emailLabel"]} value={copy.signUp.emailLabel} kind="text">{copy.signUp.emailLabel}</Editable>} required>
        <TextInput type="email" placeholder={copy.signUp.emailPlaceholder} required value={form.personalEmail} onChange={setField("personalEmail")} />
      </Field>
      <Field label={<Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["signUp", "phoneLabel"]} value={copy.signUp.phoneLabel} kind="text">{copy.signUp.phoneLabel}</Editable>}>
        <TextInput type="tel" placeholder={copy.signUp.phonePlaceholder} value={form.phone} onChange={setField("phone")} />
      </Field>
      <Field label={<Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["signUp", "whatsappLabel"]} value={copy.signUp.whatsappLabel} kind="text">{copy.signUp.whatsappLabel}</Editable>}>
        <TextInput type="tel" placeholder={copy.signUp.whatsappPlaceholder} value={form.whatsapp} onChange={setField("whatsapp")} />
      </Field>

      <div>
        <p className="text-sm font-medium mb-1.5"><Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["signUp", "applyingForLabel"]} value={copy.signUp.applyingForLabel} kind="text">{copy.signUp.applyingForLabel}</Editable></p>
        <div className="rounded-lg border border-brand-500/30 bg-brand-500/[0.06] p-3 flex items-center gap-3">
          <span className="shrink-0 inline-flex items-center px-2 py-1 rounded-md bg-brand-500/15 text-brand-700 dark:text-brand-400 text-xs font-semibold whitespace-nowrap">
            <Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["signUp", "applyingForTeamLabel"]} value={copy.signUp.applyingForTeamLabel} kind="text">{copy.signUp.applyingForTeamLabel}</Editable>
          </span>
          <p className="text-xs text-brand-700/90 dark:text-brand-300/90 leading-snug">
            <Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["signUp", "applyingForBody"]} value={copy.signUp.applyingForBody} kind="text">{copy.signUp.applyingForBody}</Editable>
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          <Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["signUp", "applyingForFootnote"]} value={copy.signUp.applyingForFootnote} kind="text">{copy.signUp.applyingForFootnote}</Editable>
        </p>
      </div>

      <div className="pt-3 border-t border-border space-y-1">
        <h3 className="text-sm font-semibold"><Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["signUp", "platformsHeading"]} value={copy.signUp.platformsHeading} kind="text">{copy.signUp.platformsHeading}</Editable></h3>
        <p className="text-xs text-muted-foreground"><Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["signUp", "platformsHint"]} value={copy.signUp.platformsHint} kind="text">{copy.signUp.platformsHint}</Editable></p>
      </div>

      <PlatformGroup
        icon={<Music2 className="h-3.5 w-3.5" />}
        name="TikTok"
        tint="rose"
        hint={<Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["signUp", "tiktokHint"]} value={copy.signUp.tiktokHint} kind="text">{copy.signUp.tiktokHint}</Editable>}
      >
        <Field label="Username">
          <TextInput placeholder="@username" value={form.tiktokUsername} onChange={setField("tiktokUsername")} />
        </Field>
        <Field label="Password">
          <TextInput type="password" placeholder="TikTok password" value={form.tiktokPassword} onChange={setField("tiktokPassword")} />
        </Field>
        <Field label="Account Email">
          <TextInput type="email" placeholder="email@example.com" value={form.tiktokEmail} onChange={setField("tiktokEmail")} />
        </Field>
        <Field label="Email Password">
          <TextInput type="password" placeholder="Password for the email above" value={form.tiktokEmailPassword} onChange={setField("tiktokEmailPassword")} />
        </Field>
      </PlatformGroup>

      <PlatformGroup icon={<Video className="h-3.5 w-3.5" />} name="YouTube" tint="red">
        <Field label="Page Gmail ID">
          <TextInput type="email" placeholder="Gmail linked to your YouTube page" value={form.youtubeGmail} onChange={setField("youtubeGmail")} />
        </Field>
        <Field label="Password">
          <TextInput type="password" placeholder="YouTube password" value={form.youtubePassword} onChange={setField("youtubePassword")} />
        </Field>
      </PlatformGroup>

      <PlatformGroup icon={<Camera className="h-3.5 w-3.5" />} name="Instagram" tint="pink">
        <Field label="Username">
          <TextInput placeholder="@username" value={form.instagramUsername} onChange={setField("instagramUsername")} />
        </Field>
        <Field label="Password">
          <TextInput type="password" placeholder="Instagram password" value={form.instagramPassword} onChange={setField("instagramPassword")} />
        </Field>
      </PlatformGroup>

      <PlatformGroup icon={<Users className="h-3.5 w-3.5" />} name="Facebook" tint="blue">
        <Field label="Page URL">
          <TextInput type="url" placeholder="https://facebook.com/yourpage" value={form.facebookUrl} onChange={setField("facebookUrl")} />
        </Field>
      </PlatformGroup>

      <Field label={<Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["signUp", "dashboardPasswordLabel"]} value={copy.signUp.dashboardPasswordLabel} kind="text">{copy.signUp.dashboardPasswordLabel}</Editable>} required>
        <PasswordInput
          placeholder={copy.signUp.dashboardPasswordPlaceholder}
          required
          value={form.dashboardPassword}
          onChange={setField("dashboardPassword")}
          show={showPw}
          onToggle={() => setShowPw((v) => !v)}
        />
      </Field>

      {error && <ErrorRow>{error}</ErrorRow>}

      <PrimaryButton disabled={loading}>
        {loading
          ? <Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["signUp", "submitLoading"]} value={copy.signUp.submitLoading} kind="text">{copy.signUp.submitLoading}</Editable>
          : <Editable styles={copy.styles} isAdmin={false} slug="auth-form" path={["signUp", "submitIdle"]} value={copy.signUp.submitIdle} kind="text">{copy.signUp.submitIdle}</Editable>}
      </PrimaryButton>
    </form>
  );
}

/* ─── Subcomponents ───────────────────────────────────────────── */

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
        active
          ? "border-brand-600 text-brand-700 dark:text-brand-400"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: React.ReactNode;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-sm font-medium mb-1.5 block">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

const TINT_CLASSES: Record<string, { bg: string; text: string; ring: string }> = {
  rose:  { bg: "bg-rose-500/10",    text: "text-rose-700 dark:text-rose-400",       ring: "ring-rose-500/20" },
  red:   { bg: "bg-red-500/10",     text: "text-red-700 dark:text-red-400",         ring: "ring-red-500/20" },
  pink:  { bg: "bg-pink-500/10",    text: "text-pink-700 dark:text-pink-400",       ring: "ring-pink-500/20" },
  blue:  { bg: "bg-blue-500/10",    text: "text-blue-700 dark:text-blue-400",       ring: "ring-blue-500/20" },
};

function PlatformGroup({
  icon, name, tint, hint, children,
}: {
  icon: React.ReactNode;
  name: string;
  tint: keyof typeof TINT_CLASSES;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = TINT_CLASSES[tint];
  return (
    <div className="rounded-xl border border-border bg-muted/20 dark:bg-muted/10 p-3.5 space-y-3">
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center justify-center h-6 w-6 rounded-md ${t.bg} ${t.text} ring-1 ${t.ring}`}>
          {icon}
        </span>
        <span className="text-sm font-semibold">{name}</span>
      </div>
      {hint && <p className="text-[11px] text-muted-foreground -mt-1.5 ml-8">{hint}</p>}
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/60 transition-shadow"
    />
  );
}

function PasswordInput({
  show,
  onToggle,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="relative">
      <input
        {...rest}
        type={show ? "text" : "password"}
        className="w-full h-10 pl-3 pr-10 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/60 transition-shadow"
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/40"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function PrimaryButton({
  children,
  disabled,
}: {
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full h-11 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold shadow-sm hover:shadow-md transition-all disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

function ErrorRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {children}
    </div>
  );
}
