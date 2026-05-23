"use client";

/**
 * Client component for the /creator/setup/tiktok flow.
 *
 * Pulls all content from the `content` prop (TiktokSetupContent from
 * cms-schemas) — every label, video link, instruction and callout is
 * editable from /signup-control/tiktok-setup. The local React state is
 * still owned here (completed step tracking + current step pointer).
 */

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import {
  Globe, Mail, Smartphone, UserPlus, Settings, ArrowRightCircle,
  Play, AlertTriangle, AlertCircle, CheckCircle2, Download,
  ChevronLeft, ChevronRight, MessageSquare, ExternalLink, ArrowRight,
  Lock, type LucideIcon,
} from "lucide-react";
import type { TiktokSetupContent, TiktokStepIcon } from "@/lib/cms-schemas";
import { CustomSections } from "@/lib/cms-render";
import { Editable } from "@/components/cms-inline/editable";

const STEP_ICON_MAP: Record<TiktokStepIcon, LucideIcon> = {
  globe: Globe,
  mail: Mail,
  smartphone: Smartphone,
  "user-plus": UserPlus,
  settings: Settings,
  "arrow-right-circle": ArrowRightCircle,
};

function gmailHref(email: string): string {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`;
}

export function TikTokSetupView({ content: c }: { content: TiktokSetupContent }) {
  const steps = c.steps;
  const totalSteps = steps.length;
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [currentStepId, setCurrentStepId] = useState(1);

  const completedCount = completed.size;
  const currentStep = steps[Math.max(0, Math.min(currentStepId - 1, totalSteps - 1))];
  const isCurrentComplete = completed.has(currentStepId);

  function markComplete() {
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
    if (currentStepId < totalSteps && completed.has(currentStepId)) {
      setCurrentStepId(currentStepId + 1);
    }
  }
  function isStepUnlocked(stepId: number): boolean {
    if (stepId === 1) return true;
    return completed.has(stepId - 1);
  }
  const canAdvance = currentStepId < totalSteps && completed.has(currentStepId);

  const CurrentIcon = STEP_ICON_MAP[currentStep.icon] ?? Globe;

  return (
    <div className="w-full max-w-4xl px-4 py-6 sm:py-8 space-y-6">
      {/* Header strip */}
      <header className="flex items-center justify-between gap-3 pb-4 border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <Image
            src="/brewapps-logo.png"
            alt="BrewApps"
            width={88}
            height={88}
            priority
            className="h-11 w-auto shrink-0"
          />
          <div className="leading-tight min-w-0">
            <p className="text-sm sm:text-base font-semibold truncate">
              <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["header", "brandTitle"]} value={c.header.brandTitle} kind="text">{c.header.brandTitle}</Editable>
            </p>
            <p className="text-[11px] sm:text-xs text-muted-foreground truncate">
              <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["header", "productLine"]} value={c.header.productLine} kind="text">{c.header.productLine}</Editable>
            </p>
          </div>
        </div>
        <Link
          href="/creator/brief"
          className="inline-flex items-center gap-1 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <ChevronLeft className="h-4 w-4" />
          <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["header", "backLinkLabel"]} value={c.header.backLinkLabel} kind="text">{c.header.backLinkLabel}</Editable>
        </Link>
      </header>

      {/* Hero */}
      <header className="text-center space-y-3 pt-2">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px] uppercase tracking-widest font-semibold">
          <Smartphone className="h-3 w-3" />
          <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["hero", "eyebrow"]} value={c.hero.eyebrow} kind="text">{c.hero.eyebrow}</Editable>
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
          <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["hero", "heading"]} value={c.hero.heading} kind="text">{c.hero.heading}</Editable>
        </h1>
        <p className="text-muted-foreground text-base max-w-2xl mx-auto">
          <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["hero", "description"]} value={c.hero.description} kind="textarea">{c.hero.description}</Editable>
        </p>
      </header>

      {/* Progress card */}
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold"><Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["progressCard", "heading"]} value={c.progressCard.heading} kind="text">{c.progressCard.heading}</Editable></h2>
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
            <div className="absolute top-[18px] left-[28px] right-[28px] h-0.5 bg-muted rounded-full" />
            <div
              className="absolute top-[18px] left-[28px] h-0.5 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full transition-all duration-700 ease-out"
              style={{
                width: `calc((100% - 56px) * ${
                  completedCount === 0 || totalSteps < 2
                    ? 0
                    : Math.min(completedCount / (totalSteps - 1), 1)
                })`,
              }}
            />
            <div className="relative flex items-start justify-between">
              {steps.map((_, idx) => {
                const stepId = idx + 1;
                const isDone = completed.has(stepId);
                const isCurrent = stepId === currentStepId;
                const isUnlocked = isStepUnlocked(stepId);
                return (
                  <button
                    key={stepId}
                    type="button"
                    onClick={() => isUnlocked && setCurrentStepId(stepId)}
                    disabled={!isUnlocked}
                    className={`group flex flex-col items-center gap-1.5 min-w-0 ${
                      isUnlocked ? "" : "cursor-not-allowed"
                    }`}
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
                        stepId
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
                      Step {stepId}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg bg-emerald-500/[0.06] border border-emerald-500/20 px-3.5 py-2.5 text-xs text-muted-foreground flex items-start gap-2">
            <span className="text-base leading-none">📖</span>
            <span><Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["progressCard", "helperBanner"]} value={c.progressCard.helperBanner} kind="textarea">{c.progressCard.helperBanner}</Editable></span>
          </div>
        </CardContent>
      </Card>

      {/* Current step card */}
      <Card className="relative overflow-hidden">
        <CardContent className="p-6 sm:p-8 space-y-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-4 min-w-0 flex-1">
              <div className="relative shrink-0">
                <div className="h-14 w-14 rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-500/30 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
                  <CurrentIcon className="h-6 w-6" strokeWidth={2.25} />
                </div>
                <div className="absolute -top-1.5 -right-1.5 h-6 w-6 rounded-full bg-white dark:bg-card border-2 border-emerald-500/40 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold flex items-center justify-center shadow-sm">
                  {currentStepId}
                </div>
              </div>
              <div className="min-w-0 flex-1 pt-1">
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 mb-1.5">
                  Current Step
                </span>
                <h3 className="text-xl sm:text-2xl font-semibold leading-tight tracking-tight">
                  <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["steps", currentStepId - 1, "title"]} value={currentStep.title} kind="text">{currentStep.title}</Editable>
                </h3>
                {currentStep.badge && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-1.5 font-medium inline-flex items-center gap-1">
                    <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["steps", currentStepId - 1, "badge"]} value={currentStep.badge ?? ""} kind="text">
                      {currentStep.badge}
                    </Editable>
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={markComplete}
              disabled={isCurrentComplete}
              className={`shrink-0 inline-flex h-10 items-center gap-1.5 px-4 rounded-lg text-sm font-semibold transition-all ${
                isCurrentComplete
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/30 cursor-default"
                  : "bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-500 hover:to-emerald-700 text-white ring-1 ring-inset ring-white/15 shadow-[0_4px_14px_-2px_rgba(16,185,129,0.45)] hover:shadow-[0_8px_22px_-4px_rgba(16,185,129,0.55)] hover:-translate-y-0.5 active:translate-y-0"
              }`}
            >
              <CheckCircle2 className="h-4 w-4" strokeWidth={2.5} />
              {isCurrentComplete ? "Completed" : "Mark as Complete"}
            </button>
          </div>

          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
            <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["steps", currentStepId - 1, "description"]} value={currentStep.description} kind="textarea">{currentStep.description}</Editable>
          </p>

          {currentStep.callouts.map((co, i) => (
            <CalloutBlock
              key={i}
              kind={co.kind}
              title={
                <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["steps", currentStepId - 1, "callouts", i, "title"]} value={co.title} kind="text">
                  {co.title}
                </Editable>
              }
              body={
                <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["steps", currentStepId - 1, "callouts", i, "body"]} value={co.body} kind="textarea">
                  {co.body}
                </Editable>
              }
            />
          ))}

          {currentStep.videos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {currentStep.videos.map((v, vi) => (
                <ActionPill
                  key={vi}
                  href={v.url}
                  icon={<Play className="h-3 w-3 fill-current" />}
                  label={
                    <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["steps", currentStepId - 1, "videos", vi, "label"]} value={v.label} kind="text">
                      {v.label}
                    </Editable>
                  }
                />
              ))}
            </div>
          )}

          {currentStep.downloads.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold inline-flex items-center gap-1.5">
                <Download className="h-4 w-4 text-emerald-600" />
                Download VPN App
              </p>
              <div className="flex flex-wrap gap-2">
                {currentStep.downloads.map((d, di) => (
                  <ActionPill
                    key={di}
                    href={d.url}
                    icon={<Download className="h-3 w-3" />}
                    label={
                      <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["steps", currentStepId - 1, "downloads", di, "label"]} value={d.label} kind="text">
                        {d.label}
                      </Editable>
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {currentStep.sections.map((section, si) => (
            <div
              key={si}
              className="rounded-xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.06] to-emerald-500/[0.01] p-4 sm:p-5 space-y-3"
            >
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/30 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                  <Smartphone className="h-5 w-5" strokeWidth={2.25} />
                </div>
                <div className="min-w-0 pt-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-700/80 dark:text-emerald-400/80 mb-0.5">
                    {section.platform === "ios" ? "iOS / iPhone" : section.platform === "android" ? "Android" : "Setup"}
                  </p>
                  <p className="text-sm font-semibold leading-snug">
                    <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["steps", currentStepId - 1, "sections", si, "heading"]} value={section.heading} kind="text">
                      {section.heading}
                    </Editable>
                  </p>
                </div>
              </div>
              {(section.videos.length > 0 || section.downloads.length > 0) && (
                <div className="flex flex-wrap gap-2 sm:pl-[52px]">
                  {section.videos.map((v, vi) => (
                    <ActionPill
                      key={vi}
                      href={v.url}
                      icon={<Play className="h-3 w-3 fill-current" />}
                      label={
                        <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["steps", currentStepId - 1, "sections", si, "videos", vi, "label"]} value={v.label} kind="text">
                          {v.label}
                        </Editable>
                      }
                    />
                  ))}
                  {section.downloads.map((d, di) => (
                    <ActionPill
                      key={di}
                      href={d.url}
                      icon={<Download className="h-3 w-3" />}
                      label={
                        <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["steps", currentStepId - 1, "sections", si, "downloads", di, "label"]} value={d.label} kind="text">
                          {d.label}
                        </Editable>
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          ))}

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
                  <span>
                    <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["steps", currentStepId - 1, "instructions", i]} value={it} kind="text">
                      {it}
                    </Editable>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </CardContent>
      </Card>

      {/* Prev / Next */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={goPrev}
          disabled={currentStepId === 1}
          className="group inline-flex h-10 items-center gap-1.5 px-4 rounded-lg border border-emerald-500/30 bg-white/70 dark:bg-emerald-950/30 hover:bg-white hover:border-emerald-500/55 dark:hover:bg-emerald-950/50 backdrop-blur-sm text-emerald-800 dark:text-emerald-200 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/70 disabled:hover:border-emerald-500/30"
        >
          <ChevronLeft className="h-4 w-4 group-enabled:group-hover:-translate-x-0.5 transition-transform" strokeWidth={2.5} />
          Previous Step
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={!canAdvance}
          className="group inline-flex h-10 items-center gap-1.5 px-4 rounded-lg border border-emerald-500/30 bg-white/70 dark:bg-emerald-950/30 hover:bg-white hover:border-emerald-500/55 dark:hover:bg-emerald-950/50 backdrop-blur-sm text-emerald-800 dark:text-emerald-200 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/70 disabled:hover:border-emerald-500/30"
        >
          {!canAdvance && currentStepId !== totalSteps && (
            <Lock className="h-3.5 w-3.5" />
          )}
          Next Step
          <ChevronRight className="h-4 w-4 group-enabled:group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
        </button>
      </div>

      {/* Final step footer */}
      {currentStepId === totalSteps && (
        <div className="pt-4 space-y-4">
          <h2 className="text-2xl font-semibold text-center"><Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["finalFooter", "heading"]} value={c.finalFooter.heading} kind="text">{c.finalFooter.heading}</Editable></h2>
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-6 space-y-3">
                <h3 className="text-lg font-semibold"><Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["finalFooter", "completeApp", "heading"]} value={c.finalFooter.completeApp.heading} kind="text">{c.finalFooter.completeApp.heading}</Editable></h3>
                <p className="text-sm text-muted-foreground"><Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["finalFooter", "completeApp", "body"]} value={c.finalFooter.completeApp.body} kind="textarea">{c.finalFooter.completeApp.body}</Editable></p>
                <Link
                  href={c.finalFooter.completeApp.signUpHref}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
                >
                  <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["finalFooter", "completeApp", "signUpLabel"]} value={c.finalFooter.completeApp.signUpLabel} kind="text">{c.finalFooter.completeApp.signUpLabel}</Editable> <ArrowRight className="h-4 w-4" />
                </Link>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 space-y-3">
                <h3 className="text-lg font-semibold"><Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["finalFooter", "needHelp", "heading"]} value={c.finalFooter.needHelp.heading} kind="text">{c.finalFooter.needHelp.heading}</Editable></h3>
                <p className="text-sm text-muted-foreground">
                  <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["finalFooter", "needHelp", "body"]} value={c.finalFooter.needHelp.body} kind="textarea">{c.finalFooter.needHelp.body}</Editable>{" "}
                  <a
                    href={gmailHref(c.finalFooter.needHelp.email)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-700 dark:text-emerald-400 font-medium hover:underline"
                  >
                    <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["finalFooter", "needHelp", "email"]} value={c.finalFooter.needHelp.email} kind="text">{c.finalFooter.needHelp.email}</Editable>
                  </a>
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <a
                    href={gmailHref(c.finalFooter.needHelp.email)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-emerald-600/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 text-sm font-semibold transition-colors"
                  >
                    <Mail className="h-4 w-4" />
                    <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["finalFooter", "needHelp", "emailLabel"]} value={c.finalFooter.needHelp.emailLabel} kind="text">{c.finalFooter.needHelp.emailLabel}</Editable>
                  </a>
                  <a
                    href={c.finalFooter.needHelp.whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
                  >
                    <MessageSquare className="h-4 w-4" />
                    <Editable styles={c.styles} isAdmin={false} slug="tiktok-setup" path={["finalFooter", "needHelp", "whatsappLabel"]} value={c.finalFooter.needHelp.whatsappLabel} kind="text">{c.finalFooter.needHelp.whatsappLabel}</Editable>
                  </a>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <CustomSections list={c.customSections} />
    </div>
  );
}

function CalloutBlock({ kind, title, body }: { kind: "warning" | "note"; title: React.ReactNode; body: React.ReactNode }) {
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

function ActionPill({ href, icon, label }: { href: string; icon: React.ReactNode; label: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-center gap-2 pl-1.5 pr-3.5 py-1.5 rounded-lg border border-emerald-500/30 bg-white/70 dark:bg-emerald-950/30 hover:bg-white hover:border-emerald-500/55 dark:hover:bg-emerald-950/50 backdrop-blur-sm text-emerald-800 dark:text-emerald-200 text-xs font-semibold transition-colors shadow-sm hover:shadow"
    >
      <span className="h-6 w-6 rounded-md bg-emerald-500/15 ring-1 ring-emerald-500/25 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
        {icon}
      </span>
      <span className="truncate">{label}</span>
      <ExternalLink className="h-3 w-3 opacity-50 group-hover:opacity-100 transition-opacity shrink-0" />
    </a>
  );
}
