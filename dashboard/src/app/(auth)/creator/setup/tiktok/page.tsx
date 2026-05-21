"use client";

/**
 * /creator/setup/tiktok — interactive 6-step TikTok account setup guide.
 *
 * Mirrors the source brief at creators-corner.netlify.app/setup/tiktok/.
 * Client component because we track per-step completion state and only
 * reveal the "current" step at a time (auto-advances on Mark Complete).
 *
 * Steps:
 *   1. VPN Setup (India users)
 *   2. Create new email
 *   3. Download TikTok
 *   4. Create TikTok account
 *   5. Profile & privacy settings
 *   6. Sign up on the Creators Portal
 *
 * Plus a "What's Next?" footer that's always visible so users can reach
 * Sign Up or Help from any step.
 *
 * NOTE: Video URLs are currently placeholders ("#"). Replace them with
 * the real YouTube/Loom links once you have them — the structure is in
 * place and accepts any external href.
 */

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import {
  Globe, Mail, Smartphone, UserPlus, Settings, ArrowRightCircle,
  Play, AlertTriangle, AlertCircle, CheckCircle2, Download,
  ChevronLeft, ChevronRight, MessageSquare, ExternalLink, ArrowRight,
  Lock,
} from "lucide-react";

type VideoLink = { label: string; url: string };
type DownloadLink = { label: string; url: string; platform: "android" | "ios" | "apk" };
type Callout = { kind: "warning" | "note"; title: string; body: string };
type Section = {
  heading: string;
  platform?: "ios" | "android";
  videos?: VideoLink[];
  downloads?: DownloadLink[];
};

interface Step {
  id: number;
  title: string;
  icon: typeof Globe;
  badge?: string;
  description: string;
  sections?: Section[];
  videos?: VideoLink[];
  downloads?: DownloadLink[];
  callouts?: Callout[];
  instructions: string[];
}

const STEPS: Step[] = [
  {
    id: 1,
    title: "VPN Setup: Access TikTok from India",
    icon: Globe,
    badge: "🇮🇳 Important for India Users",
    description:
      "Since TikTok is banned in India, you'll need to install and connect to a VPN to access the app.",
    callouts: [
      {
        kind: "warning",
        title: "Important",
        body: "Do not open TikTok without VPN or they will ban your account.",
      },
    ],
    downloads: [
      { label: "Android: Download USA VPN from Google Play Store", url: "https://play.google.com/store/apps/details?id=com.free.vpn.usa.proxy.planet", platform: "android" },
      { label: "iOS: Download USA VPN from App Store", url: "https://apps.apple.com/in/app/usa-vpn-private-fast/id6475051414", platform: "ios" },
    ],
    instructions: [
      "Download USA VPN from the app store or play store",
      "Connect to any free available server in the USA (New York, Los Angeles, etc.)",
      "Keep VPN connected throughout the TikTok setup process",
    ],
  },
  {
    id: 2,
    title: "Create a New Email Account",
    icon: Mail,
    description:
      "Create a new Gmail or Outlook account specifically for your TikTok registration.",
    sections: [
      {
        heading: "How to Sign Up for a New Outlook Email",
        videos: [{ label: "Watch Email Setup Video", url: "https://www.loom.com/share/3f160c01f93c45dbb9f464bf0b8f45d3" }],
      },
    ],
    callouts: [
      {
        kind: "note",
        title: "Important: Use Password, Not Passkey",
        body: "When creating your email account, make sure to use a traditional password instead of a passkey. You will need to share these login credentials with our team for account management purposes, and passkeys cannot be easily shared.",
      },
      {
        kind: "note",
        title: 'Facing "Too Many Attempts" Error?',
        body: "Create a new Gmail ID and use it to sign up or log in to TikTok via Google. This will help bypass the login restrictions and give you smooth access to your TikTok account.",
      },
    ],
    instructions: [
      "Create a new Gmail or Outlook account",
      "Keep the email credentials safe — you'll need them for signup",
    ],
  },
  {
    id: 3,
    title: "Download TikTok App",
    icon: Smartphone,
    description: "Download TikTok using the appropriate method for your device.",
    sections: [
      {
        heading: "How to Change Your iPhone Location & Install TikTok Using a VPN (Step-by-Step)",
        platform: "ios",
        videos: [
          { label: "Watch iOS Setup Video", url: "https://www.loom.com/share/d8edd22b65f4494b8f843f5fa40cf61a?sid=be5d3ab4-f274-40b2-ac31-c8f971dcb82f" },
          { label: "Watch Video", url: "https://www.youtube.com/shorts/9BF0hYWBKJs" },
        ],
      },
      {
        heading: "How to Set Up VPN and Install TikTok on Android",
        platform: "android",
        videos: [{ label: "Watch Video", url: "https://www.youtube.com/shorts/LhEUf1gCJoo" }],
        downloads: [
          { label: "Download TikTok APK (Android)", url: "https://tiktok.en.uptodown.com/android/download/1073755017", platform: "apk" },
        ],
      },
    ],
    instructions: [
      "Don't connect to VPN yet. Turn off VPN",
      "Android: Download from https://tiktok.en.uptodown.com/android/download/1073755017",
      "iOS: Change your Apple ID country in Settings, download TikTok, then revert country back to India",
      "For iOS users having trouble, watch the above setup video",
    ],
  },
  {
    id: 4,
    title: "Create Your TikTok Account",
    icon: UserPlus,
    description: "Set up your TikTok account with the correct information for Minutewise.",
    sections: [
      {
        heading: "How to Sign Up for TikTok",
        videos: [{ label: "Watch TikTok Sign Up Video", url: "https://www.loom.com/share/501dc17558e142d68958af4e981adadd" }],
      },
    ],
    callouts: [
      {
        kind: "note",
        title: "Important: Use Password, Not Passkey",
        body: "When setting up your TikTok account, use a traditional password instead of passkey authentication. Our team will need access to these credentials for content management and account coordination.",
      },
    ],
    instructions: [
      "Connect to VPN. Always connect to VPN before opening TikTok",
      "Open TikTok app (with VPN still connected)",
      'Option 1 — Email Signup: Tap "Sign-up" and select "Use phone or email"',
      "Enter your birthday (make sure it's 18+)",
      "Switch to email and use your new Gmail/Outlook address",
      'Option 2 — Google Signup: Tap "Continue with Google" and select your new Gmail account',
      "Do NOT enter your phone number anywhere",
      'Username suggestions: "Smart Note Taker", "Online Meeting Tips", "Take Good Notes" — simple, native-sounding names that match the app\'s functionality',
    ],
  },
  {
    id: 5,
    title: "Profile Setup & Privacy Settings",
    icon: Settings,
    description: "Configure your profile and privacy settings for optimal performance.",
    instructions: [
      'Profile Picture: Search for terms related to the app you\'re working on (e.g., "AI meeting notes", "texting assistant", "call recorder", etc.) and choose a clean, non-branded image.',
      'Bio: Use a short bio that fits the app\'s niche — for example: "Check out our AI meeting notes app on the App Store", "Try our AI texting assistant on the App Store", or "Explore our call recorder app on the App Store".',
    ],
  },
  {
    id: 6,
    title: "What Next? Complete Your Application",
    icon: ArrowRightCircle,
    description:
      "You've completed the TikTok setup! Now it's time to officially join the program.",
    sections: [
      {
        heading: "How to Sign Up on the Creators Corner Portal",
        videos: [{ label: "Watch Video", url: "https://www.loom.com/share/0e1cb079ed354dfeae0a944c30166fc2" }],
      },
    ],
    instructions: [
      "Sign up for the Creator Portal to request your offer letter",
      "Join our dedicated Slack channel for updates and support",
      "Access video creation guidelines and templates",
      "Start submitting your content and tracking your earnings",
    ],
  },
];

export default function TikTokSetupPage() {
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [currentStepId, setCurrentStepId] = useState(1);

  const completedCount = completed.size;
  const totalSteps = STEPS.length;
  const currentStep = STEPS.find((s) => s.id === currentStepId)!;
  const isCurrentComplete = completed.has(currentStepId);

  function markComplete() {
    // Mark only — DO NOT auto-advance. The user must press "Next Step"
    // themselves; that button is gated on `completed.has(currentStepId)`
    // so this click is what enables it.
    setCompleted((prev) => {
      const next = new Set(prev);
      next.add(currentStepId);
      return next;
    });
  }

  function goPrev() {
    if (currentStepId > 1) setCurrentStepId(currentStepId - 1);
  }
  function goNext() {
    // Gated: can only advance to the next step after completing the current one.
    if (currentStepId < totalSteps && completed.has(currentStepId)) {
      setCurrentStepId(currentStepId + 1);
    }
  }

  /**
   * Step N is unlocked when step N-1 is completed (or when N === 1, always).
   * Locks both the stepper pill jump-to and the "Next Step" button — the
   * intern must mark each step complete before the next reveals itself.
   * Previously-visited / completed steps stay clickable so users can review.
   */
  function isStepUnlocked(stepId: number): boolean {
    if (stepId === 1) return true;
    return completed.has(stepId - 1);
  }
  const canAdvance = currentStepId < totalSteps && completed.has(currentStepId);

  const CurrentIcon = currentStep.icon;

  return (
    <div className="w-full max-w-4xl px-4 py-10 sm:py-14 space-y-6">
      {/* Back to Brief link — kept for navigation. The "BrewApps LLC · Minutewise"
          header strip was removed per design feedback. */}
      <Link
        href="/creator/brief"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Back to Brief
      </Link>

      {/* ─── Hero ────────────────────────────────────────────────── */}
      <header className="text-center space-y-3 pt-2">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px] uppercase tracking-widest font-semibold">
          <Smartphone className="h-3 w-3" />
          Setup TikTok Account
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
          Set Up Your TikTok Account
        </h1>
        <p className="text-muted-foreground text-base max-w-2xl mx-auto">
          Follow these detailed instructions to create and optimize your
          TikTok account for the Minutewise slideshow internship.
        </p>
      </header>

      {/* ─── Progress card with timeline stepper ─────────────────── */}
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Setup Progress</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {completedCount === totalSteps
                  ? "🎉 All steps complete!"
                  : `On Step ${currentStepId} of ${totalSteps}`}
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-emerald-600 leading-none">
                {completedCount}<span className="text-muted-foreground text-base font-normal">/{totalSteps}</span>
              </div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
                Completed
              </p>
            </div>
          </div>

          {/* Connected timeline stepper */}
          <div className="relative px-1 pt-2">
            {/* Background line */}
            <div className="absolute top-[18px] left-[28px] right-[28px] h-0.5 bg-muted rounded-full" />
            {/* Progress line */}
            <div
              className="absolute top-[18px] left-[28px] h-0.5 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full transition-all duration-700 ease-out"
              style={{
                width: `calc((100% - 56px) * ${
                  completedCount === 0 ? 0 : completedCount / (totalSteps - 1)
                })`,
              }}
            />
            <div className="relative flex items-start justify-between">
              {STEPS.map((s) => {
                const isDone = completed.has(s.id);
                const isCurrent = s.id === currentStepId;
                const isUnlocked = isStepUnlocked(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => isUnlocked && setCurrentStepId(s.id)}
                    disabled={!isUnlocked}
                    className={`group flex flex-col items-center gap-1.5 min-w-0 ${
                      isUnlocked ? "" : "cursor-not-allowed"
                    }`}
                    aria-label={
                      isUnlocked
                        ? `Go to step ${s.id}`
                        : `Step ${s.id} locked — complete step ${s.id - 1} first`
                    }
                    title={
                      isUnlocked
                        ? undefined
                        : `Complete step ${s.id - 1} first to unlock`
                    }
                  >
                    <span
                      className={`relative z-10 h-9 w-9 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all ${
                        isDone
                          ? "bg-emerald-600 border-emerald-600 text-white shadow-md shadow-emerald-600/30"
                          : isCurrent
                            ? "bg-white dark:bg-card border-emerald-500 text-emerald-700 dark:text-emerald-400 ring-4 ring-emerald-500/20"
                            : isUnlocked
                              ? "bg-white dark:bg-card border-muted-foreground/30 text-muted-foreground group-hover:border-foreground/40"
                              : "bg-muted/40 border-muted-foreground/20 text-muted-foreground/60"
                      }`}
                    >
                      {isDone ? (
                        <CheckCircle2 className="h-4 w-4" strokeWidth={3} />
                      ) : !isUnlocked ? (
                        <Lock className="h-3.5 w-3.5" />
                      ) : (
                        s.id
                      )}
                    </span>
                    <span
                      className={`text-[10px] font-medium leading-tight text-center ${
                        isCurrent
                          ? "text-foreground"
                          : isDone
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-muted-foreground"
                      } hidden sm:block max-w-[80px] truncate`}
                    >
                      Step {s.id}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg bg-emerald-500/[0.06] border border-emerald-500/20 px-3.5 py-2.5 text-xs text-muted-foreground flex items-start gap-2">
            <span className="text-base leading-none">📖</span>
            <span>
              <span className="font-semibold text-foreground">
                Complete one step at a time.
              </span>{" "}
              Once you mark the current step as complete, the next step will
              appear automatically.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ─── Current step card — hero layout ─────────────────────── */}
      <Card className="relative overflow-hidden">
        {/* Subtle accent bar on the left */}
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-emerald-500 to-emerald-700" />
        <CardContent className="p-6 sm:p-8 space-y-6">
          {/* Step header — bigger circular badge + title block */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-4 min-w-0 flex-1">
              <div className="relative shrink-0">
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white flex items-center justify-center shadow-md shadow-emerald-600/20">
                  <CurrentIcon className="h-6 w-6" strokeWidth={2.25} />
                </div>
                <div className="absolute -top-1.5 -right-1.5 h-6 w-6 rounded-full bg-white dark:bg-card border-2 border-emerald-500 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold flex items-center justify-center shadow-sm">
                  {currentStep.id}
                </div>
              </div>
              <div className="min-w-0 flex-1 pt-1">
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 mb-1.5">
                  Current Step
                </span>
                <h3 className="text-xl sm:text-2xl font-semibold leading-tight tracking-tight">
                  {currentStep.title}
                </h3>
                {currentStep.badge && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-1.5 font-medium inline-flex items-center gap-1">
                    {currentStep.badge}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={markComplete}
              disabled={isCurrentComplete}
              className={`shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                isCurrentComplete
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 cursor-default"
                  : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20 hover:shadow-lg hover:shadow-emerald-600/30 hover:-translate-y-0.5"
              }`}
            >
              {isCurrentComplete ? (
                <>
                  <CheckCircle2 className="h-4 w-4" strokeWidth={2.5} />
                  Completed
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" strokeWidth={2.5} />
                  Mark as Complete
                </>
              )}
            </button>
          </div>

          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
            {currentStep.description}
          </p>

          {/* Top-level callouts */}
          {currentStep.callouts?.map((c, i) => (
            <CalloutBlock key={i} {...c} />
          ))}

          {/* Top-level videos */}
          {currentStep.videos && currentStep.videos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {currentStep.videos.map((v) => (
                <VideoButton key={v.label} {...v} />
              ))}
            </div>
          )}

          {/* Top-level downloads */}
          {currentStep.downloads && currentStep.downloads.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold inline-flex items-center gap-1.5">
                <Download className="h-4 w-4 text-emerald-600" />
                Download VPN App
              </p>
              <div className="flex flex-wrap gap-2">
                {currentStep.downloads.map((d) => (
                  <DownloadButton key={d.label} {...d} />
                ))}
              </div>
            </div>
          )}

          {/* Sections — platform-aware cards (iOS vs Android) */}
          {currentStep.sections?.map((section, i) => {
            const isIos = section.platform === "ios";
            const isAndroid = section.platform === "android";
            const platformStyles = isIos
              ? {
                  ring: "border-indigo-500/25 bg-gradient-to-br from-indigo-500/[0.06] to-indigo-500/[0.01]",
                  badge: "from-indigo-500 to-indigo-700",
                  label: "iOS / iPhone",
                }
              : isAndroid
                ? {
                    ring: "border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.06] to-emerald-500/[0.01]",
                    badge: "from-emerald-500 to-emerald-700",
                    label: "Android",
                  }
                : {
                    ring: "border-border bg-muted/30",
                    badge: "from-slate-500 to-slate-700",
                    label: "Setup",
                  };
            return (
              <div
                key={i}
                className={`rounded-xl border ${platformStyles.ring} p-4 sm:p-5 space-y-3`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`h-10 w-10 rounded-lg bg-gradient-to-br ${platformStyles.badge} text-white flex items-center justify-center shrink-0 shadow-sm`}
                  >
                    <Smartphone className="h-5 w-5" strokeWidth={2.25} />
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-0.5">
                      {platformStyles.label}
                    </p>
                    <p className="text-sm font-semibold leading-snug">
                      {section.heading}
                    </p>
                  </div>
                </div>
                {(section.videos?.length || section.downloads?.length) && (
                  <div className="flex flex-wrap gap-2 sm:pl-[52px]">
                    {section.videos?.map((v) => (
                      <VideoButton key={v.label} {...v} />
                    ))}
                    {section.downloads?.map((d) => (
                      <DownloadButton key={d.label} {...d} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Instructions — checklist style with numbered chips */}
          <div className="space-y-3 pt-1">
            <p className="text-sm font-semibold inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Instructions
            </p>
            <ol className="space-y-2">
              {currentStep.instructions.map((it, i) => (
                <li key={i} className="flex gap-3 items-start text-sm text-foreground/85 leading-relaxed">
                  <span className="shrink-0 mt-0.5 h-5 w-5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <span>{it}</span>
                </li>
              ))}
            </ol>
          </div>
        </CardContent>
      </Card>

      {/* ─── Prev / Next navigation ──────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={goPrev}
          disabled={currentStepId === 1}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border bg-background hover:bg-muted/40 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous Step
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={!canAdvance}
          title={
            currentStepId === totalSteps
              ? "You're on the last step"
              : !completed.has(currentStepId)
                ? "Mark this step as complete to unlock the next step"
                : undefined
          }
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border bg-background hover:bg-muted/40 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {!canAdvance && currentStepId !== totalSteps && (
            <Lock className="h-3.5 w-3.5 mr-0.5" />
          )}
          Next Step
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* ─── What's Next? footer — only on the final step, like the source ──── */}
      {currentStepId === totalSteps && (
      <div className="pt-4 space-y-4">
        <h2 className="text-2xl font-semibold text-center">What&apos;s Next?</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-6 space-y-3">
              <h3 className="text-lg font-semibold">Complete Your Application</h3>
              <p className="text-sm text-muted-foreground">
                Now that your TikTok account is set up, you&apos;re ready to{" "}
                <span className="font-semibold text-foreground">sign up for the portal</span>.
                Please sign up there to{" "}
                <span className="font-semibold text-foreground">request your offer letter</span>,{" "}
                join our dedicated Slack channel, and get started with the
                internship.
              </p>
              <Link
                href="/creator/signup"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
              >
                Sign Up <ArrowRight className="h-4 w-4" />
              </Link>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 space-y-3">
              <h3 className="text-lg font-semibold">Need Help?</h3>
              <p className="text-sm text-muted-foreground">
                For immediate assistance, you can also reach us via email at{" "}
                <a
                  href="mailto:team@thebrewapps.com"
                  className="text-emerald-700 dark:text-emerald-400 font-medium hover:underline"
                >
                  team@thebrewapps.com
                </a>
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <a
                  href="mailto:team@thebrewapps.com"
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors"
                >
                  <Mail className="h-4 w-4" />
                  Email Us
                </a>
                <a
                  href="https://chat.whatsapp.com/Lmw8MXKNPKu0G731bpeNn3?mode=hqrc"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
                >
                  <MessageSquare className="h-4 w-4" />
                  Join WhatsApp
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      )}
    </div>
  );
}

/* ─── Subcomponents (kept inline since they're only used here) ─── */

function CalloutBlock({ kind, title, body }: Callout) {
  const isWarning = kind === "warning";
  const Icon = isWarning ? AlertTriangle : AlertCircle;
  const styles = isWarning
    ? "border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-900 dark:text-rose-200"
    : "border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-900 dark:text-amber-200";
  return (
    <div className={`rounded-lg border px-3.5 py-2.5 text-sm ${styles}`}>
      <p className="font-semibold inline-flex items-center gap-1.5">
        <Icon className="h-4 w-4" />
        {title}
      </p>
      <p className="text-xs mt-1 leading-relaxed opacity-90">{body}</p>
    </div>
  );
}

function VideoButton({ label, url }: VideoLink) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition-colors"
    >
      <Play className="h-3.5 w-3.5 fill-current" />
      {label}
      <ExternalLink className="h-3 w-3 opacity-70" />
    </a>
  );
}

function DownloadButton({ label, url, platform }: DownloadLink) {
  const tone =
    platform === "android"
      ? "bg-emerald-600 hover:bg-emerald-700"
      : platform === "ios"
        ? "bg-indigo-600 hover:bg-indigo-700"
        : "bg-slate-700 hover:bg-slate-800";
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${tone} text-white text-xs font-medium transition-colors`}
    >
      <Download className="h-3.5 w-3.5" />
      {label}
      <ExternalLink className="h-3 w-3 opacity-70" />
    </a>
  );
}
