"use client";

/**
 * Unified Sign In / Sign Up form for the creator portal.
 *
 * Replaces the old separate /creator/login + /creator/signup screens
 * with a single tabbed flow that matches the brief at
 * creators-corner.netlify.app. The Sign Up tab collects internship-
 * application metadata (TikTok credentials, social platforms, etc.) —
 * those fields ride into Supabase user_metadata via auth.signUp's
 * options.data, so the backend team can later sync them to the
 * `creators` row without breaking the existing auth flow.
 *
 * Tab navigation rewrites the URL via router.replace so the route stays
 * canonical (/creator/login vs /creator/signup) and bookmarkable.
 */

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Eye, EyeOff, CheckCircle2, ChevronLeft, Sparkles, AlertTriangle, Mail, Music2, Video, Camera, Users } from "lucide-react";

type Tab = "signin" | "signup";

export function CreatorAuthForm({ defaultTab }: { defaultTab: Tab }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(defaultTab);

  function switchTab(next: Tab) {
    if (next === tab) return;
    setTab(next);
    router.replace(next === "signin" ? "/creator/login" : "/creator/signup");
  }

  return (
    <div className="w-full max-w-xl px-4 py-10 sm:py-14 space-y-4">
      <Link
        href="/welcome"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Back to portal chooser
      </Link>

      <div className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="p-7 sm:p-9 space-y-7">
          {/* BrewApps brand mark — uses the official PNG (includes wordmark) */}
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

          {/* Hero */}
          <div className="text-center space-y-2.5">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Join the Minutewise Team
            </h1>
            <p className="text-sm text-muted-foreground">
              Apply for the Minutewise internship program
            </p>
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 text-xs font-medium">
              <Sparkles className="h-3 w-3" />
              Minutewise Internship
            </span>
          </div>

          {/* Tab switcher */}
          <div className="flex border-b border-border">
            <TabButton active={tab === "signin"} onClick={() => switchTab("signin")} label="Sign In" />
            <TabButton active={tab === "signup"} onClick={() => switchTab("signup")} label="Sign Up" />
          </div>

          {tab === "signin" ? <SignInForm /> : <SignUpForm />}
        </div>
      </div>
    </div>
  );
}

/* ─── Sign In ─────────────────────────────────────────────────── */

function SignInForm() {
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
    // Existing creator-link flow (same as the old login page).
    router.push("/auth/relink?from=creator");
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
      options: { emailRedirectTo: `${origin}/auth/callback?from=creator` },
    });
    if (err) {
      setResendError(err.message);
      setResendStatus("error");
      return;
    }
    setResendStatus("sent");
  }

  // Map of reason codes (set by /auth/callback and /auth/relink) to a
  // friendly explanation + whether the resend-email action should show.
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
                <p className="text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1">
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
      <Field label="Personal Email Address" required>
        <TextInput
          type="email"
          placeholder="Enter your personal email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </Field>
      <Field label="Password" required>
        <PasswordInput
          placeholder="Enter your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          show={showPw}
          onToggle={() => setShowPw((v) => !v)}
          required
        />
      </Field>
      {error && <ErrorRow>{error}</ErrorRow>}
      <PrimaryButton disabled={loading}>
        {loading ? "Signing in…" : "Sign In"}
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

function SignUpForm() {
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
        emailRedirectTo: `${origin}/auth/callback?from=creator`,
        // All application fields ride into Supabase user_metadata so the
        // backend team can sync them onto the creators row later without
        // a schema change here.
        data: {
          full_name: form.fullName,
          phone_number: form.phone,
          whatsapp_number: form.whatsapp,
          applying_for: "minutewise",
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
        <div className="h-12 w-12 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mx-auto">
          <CheckCircle2 className="h-6 w-6" strokeWidth={2.25} />
        </div>
        <h3 className="text-lg font-semibold">Check your email</h3>
        <p className="text-sm text-muted-foreground">
          We sent a confirmation link to <strong>{form.personalEmail}</strong>.
          Click it to activate your account.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Full Name" required>
        <TextInput placeholder="Enter your full name" required value={form.fullName} onChange={setField("fullName")} />
      </Field>
      <Field label="Personal Email Address" required>
        <TextInput type="email" placeholder="Enter your personal email" required value={form.personalEmail} onChange={setField("personalEmail")} />
      </Field>
      <Field label="Phone Number">
        <TextInput type="tel" placeholder="Enter your phone number" value={form.phone} onChange={setField("phone")} />
      </Field>
      <Field label="WhatsApp Number">
        <TextInput type="tel" placeholder="Enter your WhatsApp number" value={form.whatsapp} onChange={setField("whatsapp")} />
      </Field>

      {/* Applying For — auto-selected card */}
      <div>
        <p className="text-sm font-medium mb-1.5">Applying For</p>
        <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/[0.06] p-3 flex items-center gap-3">
          <span className="shrink-0 inline-flex items-center px-2 py-1 rounded-md bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 text-xs font-semibold whitespace-nowrap">
            Minutewise Team
          </span>
          <p className="text-xs text-indigo-700/90 dark:text-indigo-300/90 leading-snug">
            You&apos;re applying for the Minutewise internship program
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          This was automatically selected from your referral link
        </p>
      </div>

      <div className="pt-3 border-t border-border space-y-1">
        <h3 className="text-sm font-semibold">Social Media Platform Credentials</h3>
        <p className="text-xs text-muted-foreground">
          Provide login details for each platform we&apos;ll post to
        </p>
      </div>

      <PlatformGroup
        icon={<Music2 className="h-3.5 w-3.5" />}
        name="TikTok"
        tint="rose"
        hint="The TikTok account you created following our setup guide"
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

      <PlatformGroup
        icon={<Video className="h-3.5 w-3.5" />}
        name="YouTube"
        tint="red"
      >
        <Field label="Page Gmail ID">
          <TextInput type="email" placeholder="Gmail linked to your YouTube page" value={form.youtubeGmail} onChange={setField("youtubeGmail")} />
        </Field>
        <Field label="Password">
          <TextInput type="password" placeholder="YouTube password" value={form.youtubePassword} onChange={setField("youtubePassword")} />
        </Field>
      </PlatformGroup>

      <PlatformGroup
        icon={<Camera className="h-3.5 w-3.5" />}
        name="Instagram"
        tint="pink"
      >
        <Field label="Username">
          <TextInput placeholder="@username" value={form.instagramUsername} onChange={setField("instagramUsername")} />
        </Field>
        <Field label="Password">
          <TextInput type="password" placeholder="Instagram password" value={form.instagramPassword} onChange={setField("instagramPassword")} />
        </Field>
      </PlatformGroup>

      <PlatformGroup
        icon={<Users className="h-3.5 w-3.5" />}
        name="Facebook"
        tint="blue"
      >
        <Field label="Page URL">
          <TextInput type="url" placeholder="https://facebook.com/yourpage" value={form.facebookUrl} onChange={setField("facebookUrl")} />
        </Field>
      </PlatformGroup>

      <Field label="Dashboard Password" required>
        <PasswordInput
          placeholder="Create a password for the dashboard"
          required
          value={form.dashboardPassword}
          onChange={setField("dashboardPassword")}
          show={showPw}
          onToggle={() => setShowPw((v) => !v)}
        />
      </Field>

      {error && <ErrorRow>{error}</ErrorRow>}

      <PrimaryButton disabled={loading}>
        {loading ? "Creating account…" : "Create Account"}
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
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
        active
          ? "border-indigo-600 text-indigo-700 dark:text-indigo-400"
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
  label: string;
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
  hint?: string;
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
      className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/60 transition-shadow"
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
        className="w-full h-10 pl-3 pr-10 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/60 transition-shadow"
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
      className="w-full h-11 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-sm hover:shadow-md transition-all disabled:opacity-60 disabled:cursor-not-allowed"
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
