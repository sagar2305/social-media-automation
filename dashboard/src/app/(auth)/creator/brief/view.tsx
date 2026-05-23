"use client";

/**
 * Presentational component for /creator/brief.
 *
 * Pure rendering — receives all content via the `content` prop (typed
 * BriefContent from cms-schemas). The route's page.tsx wraps this with
 * a CMS read so admins can edit every string from the Signup Control
 * admin tool.
 */

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChevronRight, Video, FileText, Building2, Users, Clock, Wallet,
  Sparkles, GraduationCap, CheckCircle2, MessageSquare,
  Rocket, ArrowRight, Mail, ExternalLink, ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import type { BriefContent } from "@/lib/cms-schemas";
import { Md } from "@/lib/markdown";
import { Heading, CustomSections } from "@/lib/cms-render";
import { Editable } from "@/components/cms-inline/editable";
import { EditableList } from "@/components/cms-inline/editable-list";
import { InternVideoTile } from "./intern-video-tile";

const PILL_ICON: Record<BriefContent["ctaHero"]["pills"][number]["icon"], LucideIcon> = {
  check: CheckCircle2,
  wallet: Wallet,
  rocket: Rocket,
  sparkles: Sparkles,
  clock: Clock,
};

function gmailHref(email: string): string {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`;
}

export function BriefView({ content: c }: { content: BriefContent }) {
  return (
    <div className="w-full max-w-4xl px-4 py-12 sm:py-16 space-y-8">
      {/* Back to chooser */}
      <Link
        href="/welcome"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        ← Wrong portal? Back to chooser
      </Link>

      {/* ─── Hero ────────────────────────────────────────────────── */}
      {!c.hero.hidden && (
        <header className="text-center space-y-3">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-brand-500/10 text-brand-700 dark:text-brand-400 text-[10px] uppercase tracking-widest font-semibold">
            <Editable styles={c.styles} isAdmin={false} slug="brief" path={["hero", "eyebrow"]} value={c.hero.eyebrow} kind="text" label="Hero eyebrow">{c.hero.eyebrow}</Editable>
          </div>
          <Heading tokens={c.hero.headingTypography} fallbackLevel="h1" className="text-center">
            <Editable styles={c.styles} isAdmin={false} slug="brief" path={["hero", "heading"]} value={c.hero.heading} kind="text" label="Hero heading">{c.hero.heading}</Editable>
          </Heading>
          <p className="text-muted-foreground text-base max-w-2xl mx-auto">
            <Editable styles={c.styles} isAdmin={false} slug="brief" path={["hero", "subheading"]} value={c.hero.subheading} kind="textarea" label="Hero subheading">{c.hero.subheading}</Editable>
          </p>
        </header>
      )}

      {/* ─── Internship Brief Video ──────────────────────────────── */}
      {!c.briefVideo.hidden && (
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-5">
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-semibold inline-flex items-center gap-2 justify-center">
              <Video className="h-5 w-5 text-brand-600" />
              <Editable styles={c.styles} isAdmin={false} slug="brief" path={["briefVideo", "heading"]} value={c.briefVideo.heading} kind="text">{c.briefVideo.heading}</Editable>
            </h2>
            <p className="text-sm text-muted-foreground max-w-xl mx-auto">
              <Editable styles={c.styles} isAdmin={false} slug="brief" path={["briefVideo", "description"]} value={c.briefVideo.description} kind="textarea">{c.briefVideo.description}</Editable>
            </p>
          </div>
          <div className="relative w-full overflow-hidden rounded-xl border border-border bg-black shadow-sm" style={{ aspectRatio: "16 / 9" }}>
            <iframe
              src={`https://www.loom.com/embed/${c.briefVideo.loomEmbedId}`}
              title={c.briefVideo.heading}
              className="absolute inset-0 w-full h-full"
              frameBorder={0}
              allow="autoplay; fullscreen; picture-in-picture; clipboard-write"
              allowFullScreen
            />
          </div>
          <div className="rounded-lg bg-muted/40 p-4 space-y-2">
            <p className="text-sm font-semibold inline-flex items-center gap-1.5">
              <FileText className="h-4 w-4 text-brand-600" />
              <Editable styles={c.styles} isAdmin={false} slug="brief" path={["briefVideo", "learnHeading"]} value={c.briefVideo.learnHeading} kind="text">{c.briefVideo.learnHeading}</Editable>
            </p>
            <ul className="text-sm text-muted-foreground space-y-1.5 ml-1">
              {c.briefVideo.bullets.map((b, i) => (
                <li key={i}>• {b}</li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
      )}

      {/* ─── About Us ────────────────────────────────────────────── */}
      {!c.aboutUs.hidden && (
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-4">
          <h2 className="text-2xl font-semibold inline-flex items-center gap-2">
            <Building2 className="h-5 w-5 text-brand-600" />
            <Editable styles={c.styles} isAdmin={false} slug="brief" path={["aboutUs", "heading"]} value={c.aboutUs.heading} kind="text">{c.aboutUs.heading}</Editable>
          </h2>
          <p className="text-sm text-muted-foreground">
            <Editable styles={c.styles} isAdmin={false} slug="brief" path={["aboutUs", "intro"]} value={c.aboutUs.intro} kind="textarea">{c.aboutUs.intro}</Editable>
          </p>
          <ul className="text-sm space-y-1.5 ml-1">
            {c.aboutUs.apps.map((a, i) => (
              <li key={i}>
                <Editable styles={c.styles} isAdmin={false} slug="brief" path={["aboutUs", "apps", i, "name"]} value={a.name} kind="text"><span className="font-semibold">{a.name}</span></Editable>{" "}
                <Editable styles={c.styles} isAdmin={false} slug="brief" path={["aboutUs", "apps", i, "description"]} value={a.description} kind="text"><span className="text-muted-foreground">{a.description}</span></Editable>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            <Editable styles={c.styles} isAdmin={false} slug="brief" path={["aboutUs", "closing"]} value={c.aboutUs.closing} kind="textarea">{c.aboutUs.closing}</Editable>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            {c.aboutUs.appCards.map((app, i) => (
              <a
                key={app.name}
                href={app.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-3 rounded-xl border border-brand-500/30 bg-gradient-to-br from-brand-500/[0.08] to-brand-500/[0.02] hover:from-brand-500/[0.14] hover:to-brand-500/[0.04] transition-colors px-3 py-2.5"
              >
                <div className="relative h-11 w-11 rounded-xl overflow-hidden bg-white ring-1 ring-brand-500/20 shadow-sm shrink-0">
                  {app.icon && (
                    // Use a plain <img> instead of next/image: app-card
                    // icons can be admin-uploaded to any Supabase Storage
                    // path, and Next's image optimizer requires the host
                    // to be whitelisted in next.config.ts at build time.
                    // The icons are 44×44 so the optimizer buys nothing
                    // here anyway.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={app.icon}
                      alt={`${app.name} app icon`}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-tight truncate">
                    <Editable styles={c.styles} isAdmin={false} slug="brief" path={["aboutUs", "appCards", i, "name"]} value={app.name} kind="text">{app.name}</Editable>
                  </p>
                  <p className="text-[10.5px] text-brand-700/80 dark:text-brand-400/80 uppercase tracking-wider mt-0.5 font-medium">
                    iOS App Store
                  </p>
                </div>
                <ArrowUpRight className="h-4 w-4 text-brand-600/70 dark:text-brand-400/70 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-600" />
              </a>
            ))}
          </div>
        </CardContent>
      </Card>
      )}

      {/* ─── Impactful Work by Our Interns ───────────────────────── */}
      {!c.internShowcase.hidden && (
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-4">
          <div>
            <h2 className="text-2xl font-semibold inline-flex items-center gap-2">
              <Users className="h-5 w-5 text-brand-600" />
              <Editable styles={c.styles} isAdmin={false} slug="brief" path={["internShowcase", "heading"]} value={c.internShowcase.heading} kind="text">{c.internShowcase.heading}</Editable>
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              <Editable styles={c.styles} isAdmin={false} slug="brief" path={["internShowcase", "subtitle"]} value={c.internShowcase.subtitle} kind="text">{c.internShowcase.subtitle}</Editable>
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
            {c.internShowcase.tiles.map((tile, i) => (
              <div key={`${tile.youtubeId}-${i}`} className="flex flex-col rounded-xl border border-border bg-muted/30 p-3 gap-2">
                {tile.handle && (
                  <p className="text-[11px] font-medium text-brand-700 dark:text-brand-400 px-1">
                    <Editable styles={c.styles} isAdmin={false} slug="brief" path={["internShowcase", "tiles", i, "handle"]} value={tile.handle} kind="text">
                      {tile.handle}
                    </Editable>
                  </p>
                )}
                <InternVideoTile
                  youtubeId={tile.youtubeId}
                  title={`Intern post #${i + 1}`}
                />

                <a
                  href={tile.tiktokUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-center text-brand-700 dark:text-brand-400 font-semibold inline-flex items-center gap-1.5 justify-center py-1.5 rounded-md border border-brand-500/30 bg-gradient-to-br from-brand-500/[0.08] to-brand-500/[0.02] hover:from-brand-500/[0.16] hover:to-brand-500/[0.05] transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  View on TikTok
                </a>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      )}

      {/* ─── Slideshow Internship Details ────────────────────────── */}
      {!c.internshipDetails.hidden && (
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-5">
          <div>
            <h2 className="text-2xl font-semibold inline-flex items-center gap-2">
              <Users className="h-5 w-5 text-brand-600" />
              <Editable styles={c.styles} isAdmin={false} slug="brief" path={["internshipDetails", "heading"]} value={c.internshipDetails.heading} kind="text">{c.internshipDetails.heading}</Editable>
            </h2>
            <p className="text-sm text-muted-foreground mt-2 rounded-md bg-brand-500/[0.06] border border-brand-500/20 px-3 py-2.5">
              <Editable styles={c.styles} isAdmin={false} slug="brief" path={["internshipDetails", "summary"]} value={c.internshipDetails.summary} kind="textarea">{c.internshipDetails.summary}</Editable>
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {c.internshipDetails.panels.map((p, i) => {
              const Icon = i === 0 ? Clock : Wallet;
              return (
                <div key={i} className="rounded-lg border border-border bg-muted/30 p-5 space-y-3">
                  <h3 className="font-semibold inline-flex items-center gap-2">
                    <Icon className="h-4 w-4 text-brand-600" />
                    <Editable styles={c.styles} isAdmin={false} slug="brief" path={["internshipDetails", "panels", i, "heading"]} value={p.heading} kind="text">{p.heading}</Editable>
                  </h3>
                  <ul className="text-sm text-muted-foreground space-y-2">
                    {p.bullets.map((b, j) => (
                      <li key={j} className="flex gap-2"><span className="text-brand-600">✦</span> {b}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      )}

      {/* ─── What You'll Do ──────────────────────────────────────── */}
      {!c.whatYoullDo.hidden && (
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-5">
          <h2 className="text-2xl font-semibold inline-flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-brand-600" />
            <Editable styles={c.styles} isAdmin={false} slug="brief" path={["whatYoullDo", "heading"]} value={c.whatYoullDo.heading} kind="text">{c.whatYoullDo.heading}</Editable>
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {c.whatYoullDo.columns.map((col, i) => (
              <div key={i}>
                <h3 className="font-semibold mb-3">
                  <Editable styles={c.styles} isAdmin={false} slug="brief" path={["whatYoullDo", "columns", i, "heading"]} value={col.heading} kind="text">{col.heading}</Editable>
                </h3>
                <ul className="text-sm text-muted-foreground space-y-1.5">
                  {col.bullets.map((b, j) => (
                    <li key={j}>• {b}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      )}

      {/* ─── Interns We Love to Work With ────────────────────────── */}
      {!c.internsWeLove.hidden && (
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-5">
          <h2 className="text-2xl font-semibold inline-flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-brand-600" />
            <Editable styles={c.styles} isAdmin={false} slug="brief" path={["internsWeLove", "heading"]} value={c.internsWeLove.heading} kind="text">{c.internsWeLove.heading}</Editable>
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {c.internsWeLove.columns.map((col, i) => (
              <div key={i}>
                <h3 className="font-semibold mb-3">
                  <Editable styles={c.styles} isAdmin={false} slug="brief" path={["internsWeLove", "columns", i, "heading"]} value={col.heading} kind="text">{col.heading}</Editable>
                </h3>
                <ul className="text-sm text-muted-foreground space-y-2">
                  {col.bullets.map((b, j) => (
                    <li key={j} className="flex gap-2">
                      <CheckCircle2 className="h-4 w-4 text-brand-600 mt-0.5 shrink-0" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      )}

      {/* ─── FAQ ─────────────────────────────────────────────────── */}
      {!c.faq.hidden && (
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-4">
          <div className="text-center space-y-2">
            <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">
              <Editable styles={c.styles} isAdmin={false} slug="brief" path={["faq", "heading"]} value={c.faq.heading} kind="text">{c.faq.heading}</Editable>
            </h2>
            <p className="text-sm text-foreground/70 max-w-xl mx-auto">
              <Editable styles={c.styles} isAdmin={false} slug="brief" path={["faq", "subtitle"]} value={c.faq.subtitle} kind="text">{c.faq.subtitle}</Editable>
            </p>
          </div>
          <div className="space-y-2">
            <EditableList
              isAdmin={false}
              slug="brief"
              path={["faq", "items"]}
              items={c.faq.items}
              newItem={() => ({ q: "New question", a: "Write the answer here. Supports **bold**, *italic*, and [links](url)." })}
              renderItem={(item, i) => (
                <details
                  key={i}
                  className="group rounded-xl border border-brand-500/25 bg-gradient-to-br from-brand-500/[0.06] to-brand-500/[0.01] hover:from-brand-500/[0.12] hover:to-brand-500/[0.03] open:from-brand-500/[0.14] open:to-brand-500/[0.03] open:border-brand-500/40 transition-colors px-4 py-3 [&_summary::-webkit-details-marker]:hidden"
                >
                  <summary className="flex items-center justify-between gap-3 cursor-pointer text-sm font-semibold text-foreground select-none">
                    <span className="flex-1">
                      <Editable styles={c.styles} isAdmin={false} slug="brief" path={["faq", "items", i, "q"]} value={item.q} kind="text">{item.q}</Editable>
                    </span>
                    <span className="shrink-0 h-7 w-7 rounded-lg bg-brand-500/15 text-brand-700 dark:text-brand-300 ring-1 ring-brand-500/25 flex items-center justify-center transition-all duration-200 group-open:rotate-90 group-open:bg-brand-500/25 group-open:ring-brand-500/40 group-hover:bg-brand-500/25">
                      <ChevronRight className="h-4 w-4" strokeWidth={2.75} />
                    </span>
                  </summary>
                  <div className="mt-3 pt-3 border-t border-brand-500/20">
                    <div className="text-sm text-foreground/75 leading-relaxed">
                      <Editable styles={c.styles} isAdmin={false} slug="brief" path={["faq", "items", i, "a"]} value={item.a} kind="markdown" rows={5}>
                        <Md>{item.a}</Md>
                      </Editable>
                    </div>
                  </div>
                </details>
              )}
            />
          </div>
        </CardContent>
      </Card>
      )}

      {/* ─── Help block ──────────────────────────────────────────── */}
      {!c.helpBlock.hidden && (
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-4 text-center">
          <h2 className="text-xl font-semibold">
            <Editable styles={c.styles} isAdmin={false} slug="brief" path={["helpBlock", "heading"]} value={c.helpBlock.heading} kind="text">{c.helpBlock.heading}</Editable>
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
            <Editable styles={c.styles} isAdmin={false} slug="brief" path={["helpBlock", "body"]} value={c.helpBlock.body} kind="textarea">{c.helpBlock.body}</Editable>
          </p>
          <p className="text-sm text-muted-foreground">
            <Editable styles={c.styles} isAdmin={false} slug="brief" path={["helpBlock", "contactNote"]} value={c.helpBlock.contactNote} kind="text">{c.helpBlock.contactNote}</Editable>
          </p>
          <p className="text-sm inline-flex items-center gap-2 justify-center">
            <Mail className="h-4 w-4 text-brand-600" />
            Email:{" "}
            <a
              href={gmailHref(c.helpBlock.email)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-700 dark:text-brand-400 hover:underline font-medium"
            >
              <Editable styles={c.styles} isAdmin={false} slug="brief" path={["helpBlock", "email"]} value={c.helpBlock.email} kind="text">{c.helpBlock.email}</Editable>
            </a>
          </p>
          <div className="pt-1">
            <a
              href={c.helpBlock.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-1.5 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors"
            >
              <MessageSquare className="h-4 w-4" />
              <Editable styles={c.styles} isAdmin={false} slug="brief" path={["helpBlock", "whatsappLabel"]} value={c.helpBlock.whatsappLabel} kind="text">{c.helpBlock.whatsappLabel}</Editable>
            </a>
          </div>
        </CardContent>
      </Card>
      )}

      {/* ─── Journey to Success ──────────────────────────────────── */}
      {!c.journey.hidden && (
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-5">
          <div className="text-center space-y-1">
            <h2 className="text-2xl font-semibold inline-flex items-center gap-2 justify-center">
              <Rocket className="h-5 w-5 text-brand-600" />
              <Editable styles={c.styles} isAdmin={false} slug="brief" path={["journey", "heading"]} value={c.journey.heading} kind="text">{c.journey.heading}</Editable>
            </h2>
            <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
              <Editable styles={c.styles} isAdmin={false} slug="brief" path={["journey", "subtitle"]} value={c.journey.subtitle} kind="textarea">{c.journey.subtitle}</Editable>
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <EditableList
              isAdmin={false}
              slug="brief"
              path={["journey", "steps"]}
              items={c.journey.steps}
              newItem={() => ({ title: "New step", desc: "Describe this step." })}
              renderItem={(s, i) => (
                <div
                  key={i}
                  className="group rounded-xl border border-brand-500/25 bg-gradient-to-br from-brand-500/[0.06] to-brand-500/[0.01] hover:from-brand-500/[0.12] hover:to-brand-500/[0.03] transition-colors p-4 space-y-2"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="h-7 w-7 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center shadow-sm shadow-brand-600/20">
                      {i + 1}
                    </span>
                    <h3 className="font-semibold text-sm leading-tight">
                      <Editable styles={c.styles} isAdmin={false} slug="brief" path={["journey", "steps", i, "title"]} value={s.title} kind="text">{s.title}</Editable>
                    </h3>
                  </div>
                  <p className="text-xs text-foreground/70 leading-relaxed">
                    <Editable styles={c.styles} isAdmin={false} slug="brief" path={["journey", "steps", i, "desc"]} value={s.desc} kind="textarea">{s.desc}</Editable>
                  </p>
                </div>
              )}
            />
          </div>
          <div className="relative overflow-hidden rounded-xl border border-brand-500/40 bg-gradient-to-br from-brand-500/[0.14] via-brand-500/[0.08] to-brand-500/[0.02] p-5 text-center space-y-1.5">
            <div className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-brand-400/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-10 -left-10 h-32 w-32 rounded-full bg-brand-400/10 blur-2xl" />
            <div className="relative inline-flex items-center gap-2 justify-center">
              <span className="h-7 w-7 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center shadow-sm shadow-brand-600/30">
                {c.journey.steps.length + 1}
              </span>
              <h3 className="font-semibold text-brand-900 dark:text-brand-100">
                <Editable styles={c.styles} isAdmin={false} slug="brief" path={["journey", "finalStep", "title"]} value={c.journey.finalStep.title} kind="text">{c.journey.finalStep.title}</Editable>
              </h3>
            </div>
            <p className="relative text-xs text-brand-900/80 dark:text-brand-100/80">
              <Editable styles={c.styles} isAdmin={false} slug="brief" path={["journey", "finalStep", "desc"]} value={c.journey.finalStep.desc} kind="textarea">{c.journey.finalStep.desc}</Editable>
            </p>
          </div>
          <p className="text-xs text-center text-muted-foreground inline-flex items-center gap-1.5 w-full justify-center">
            <Clock className="h-3.5 w-3.5" />
            <Editable styles={c.styles} isAdmin={false} slug="brief" path={["journey", "footer"]} value={c.journey.footer} kind="text">{c.journey.footer}</Editable>
          </p>
        </CardContent>
      </Card>
      )}

      {/* ─── Get Started CTA ─────────────────────────────────────── */}
      {!c.ctaHero.hidden && (
      <Card className="relative overflow-hidden border-brand-500/40 bg-gradient-to-br from-brand-500/[0.14] via-brand-500/[0.08] to-teal-500/[0.04] shadow-sm">
        <div className="pointer-events-none absolute -top-24 -right-20 h-72 w-72 rounded-full bg-brand-400/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 -left-24 h-72 w-72 rounded-full bg-teal-400/20 blur-3xl" />
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-96 w-96 rounded-full bg-brand-300/10 blur-3xl" />
        <CardContent className="relative p-6 sm:p-12 text-center space-y-5">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-500/15 text-brand-700 dark:text-brand-300 text-[10.5px] uppercase tracking-[0.15em] font-semibold border border-brand-500/30">
            <Sparkles className="h-3 w-3" />
            <Editable styles={c.styles} isAdmin={false} slug="brief" path={["ctaHero", "eyebrow"]} value={c.ctaHero.eyebrow} kind="text">{c.ctaHero.eyebrow}</Editable>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-brand-950 dark:text-brand-50">
            <Editable styles={c.styles} isAdmin={false} slug="brief" path={["ctaHero", "heading"]} value={c.ctaHero.heading} kind="text">{c.ctaHero.heading}</Editable>
          </h2>
          <p className="text-base sm:text-lg text-brand-900/75 dark:text-brand-100/85 max-w-xl mx-auto">
            <Editable styles={c.styles} isAdmin={false} slug="brief" path={["ctaHero", "body"]} value={c.ctaHero.body} kind="textarea">{c.ctaHero.body}</Editable>
          </p>
          <div className="flex flex-wrap gap-2 justify-center pt-1">
            {c.ctaHero.pills.map((p, i) => {
              const Icon = PILL_ICON[p.icon] ?? CheckCircle2;
              return (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-white/70 dark:bg-brand-950/40 border border-brand-500/25 text-brand-800 dark:text-brand-200 backdrop-blur-sm font-medium"
                >
                  <Icon className="h-3 w-3" strokeWidth={2.5} />
                  <Editable styles={c.styles} isAdmin={false} slug="brief" path={["ctaHero", "pills", i, "label"]} value={p.label} kind="text">{p.label}</Editable>
                </span>
              );
            })}
          </div>
          <div className="flex flex-col items-center gap-3 pt-4">
            <Link
              href={c.ctaHero.primaryHref}
              className="group inline-flex h-14 items-center justify-center px-10 rounded-xl bg-white dark:bg-brand-50 ring-1 ring-brand-500/30 text-brand-700 text-base font-semibold transition-all shadow-[0_8px_24px_-4px_rgba(16,185,129,0.35)] hover:shadow-[0_14px_32px_-6px_rgba(16,185,129,0.5)] hover:-translate-y-0.5 active:translate-y-0"
            >
              <Editable styles={c.styles} isAdmin={false} slug="brief" path={["ctaHero", "primaryLabel"]} value={c.ctaHero.primaryLabel} kind="text">{c.ctaHero.primaryLabel}</Editable>
              <span className="ml-2.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-white shadow-sm">
                <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={3} />
              </span>
            </Link>
            <p className="text-sm text-brand-900/70 dark:text-brand-100/70">
              <Editable styles={c.styles} isAdmin={false} slug="brief" path={["ctaHero", "secondaryText"]} value={c.ctaHero.secondaryText} kind="text">{c.ctaHero.secondaryText}</Editable>{" "}
              <Link
                href={c.ctaHero.secondaryHref}
                className="font-semibold text-brand-700 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200 underline-offset-4 hover:underline transition-colors"
              >
                <Editable styles={c.styles} isAdmin={false} slug="brief" path={["ctaHero", "secondaryLinkLabel"]} value={c.ctaHero.secondaryLinkLabel} kind="text">{c.ctaHero.secondaryLinkLabel}</Editable>
              </Link>
            </p>
          </div>
          <p className="text-xs text-brand-900/60 dark:text-brand-100/60 pt-1 inline-flex items-center gap-1.5 justify-center w-full">
            <Clock className="h-3.5 w-3.5" />
            <Editable styles={c.styles} isAdmin={false} slug="brief" path={["ctaHero", "footnote"]} value={c.ctaHero.footnote} kind="text">{c.ctaHero.footnote}</Editable>
          </p>
        </CardContent>
      </Card>
      )}

      {/* ─── Got Questions ───────────────────────────────────────── */}
      {!c.gotQuestions.hidden && (
      <Card className="relative overflow-hidden border-brand-500/30 bg-gradient-to-br from-brand-500/[0.08] via-brand-500/[0.04] to-brand-500/[0.01] shadow-sm">
        <div className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-brand-400/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-brand-400/10 blur-3xl" />
        <CardContent className="relative p-6 sm:p-8 space-y-5 text-center">
          <div className="space-y-2">
            <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">
              <Editable styles={c.styles} isAdmin={false} slug="brief" path={["gotQuestions", "heading"]} value={c.gotQuestions.heading} kind="text">{c.gotQuestions.heading}</Editable>
            </h2>
            <p className="text-sm text-foreground/70 max-w-xl mx-auto">
              <Editable styles={c.styles} isAdmin={false} slug="brief" path={["gotQuestions", "subtitle"]} value={c.gotQuestions.subtitle} kind="textarea">{c.gotQuestions.subtitle}</Editable>
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 max-w-xl mx-auto">
            <a
              href={gmailHref(c.gotQuestions.email)}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-3 rounded-xl border border-brand-500/30 bg-white/70 dark:bg-brand-950/30 hover:bg-white hover:border-brand-500/50 dark:hover:bg-brand-950/50 backdrop-blur-sm transition-colors px-4 py-3 text-left"
            >
              <span className="shrink-0 h-9 w-9 rounded-lg bg-brand-500/15 text-brand-700 dark:text-brand-300 ring-1 ring-brand-500/25 flex items-center justify-center">
                <Mail className="h-4 w-4" strokeWidth={2.25} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[10.5px] uppercase tracking-widest font-semibold text-brand-700/80 dark:text-brand-400/80">
                  Email us
                </span>
                <span className="block text-sm font-medium truncate"><Editable styles={c.styles} isAdmin={false} slug="brief" path={["gotQuestions", "email"]} value={c.gotQuestions.email} kind="text">{c.gotQuestions.email}</Editable></span>
              </span>
              <ArrowUpRight className="h-4 w-4 text-brand-600/70 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-600 transition-all" />
            </a>
            <a
              href={c.gotQuestions.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-3 rounded-xl border border-brand-500/30 bg-white/70 dark:bg-brand-950/30 hover:bg-white hover:border-brand-500/50 dark:hover:bg-brand-950/50 backdrop-blur-sm transition-colors px-4 py-3 text-left"
            >
              <span className="shrink-0 h-9 w-9 rounded-lg bg-brand-500/15 text-brand-700 dark:text-brand-300 ring-1 ring-brand-500/25 flex items-center justify-center">
                <MessageSquare className="h-4 w-4" strokeWidth={2.25} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[10.5px] uppercase tracking-widest font-semibold text-brand-700/80 dark:text-brand-400/80">
                  WhatsApp
                </span>
                <span className="block text-sm font-medium truncate"><Editable styles={c.styles} isAdmin={false} slug="brief" path={["gotQuestions", "whatsappLabel"]} value={c.gotQuestions.whatsappLabel} kind="text">{c.gotQuestions.whatsappLabel}</Editable></span>
              </span>
              <ArrowUpRight className="h-4 w-4 text-brand-600/70 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-600 transition-all" />
            </a>
          </div>
          <p className="text-xs text-brand-900/60 dark:text-brand-100/60">
            <Editable styles={c.styles} isAdmin={false} slug="brief" path={["gotQuestions", "footnote"]} value={c.gotQuestions.footnote} kind="text">{c.gotQuestions.footnote}</Editable>
          </p>
        </CardContent>
      </Card>
      )}

      {/* ─── Admin-defined custom blocks ─────────────────────────── */}
      <CustomSections list={c.customSections} />

      {/* ─── Footer ──────────────────────────────────────────────── */}
      {!c.footer.hidden && (
      <p className="text-center text-xs text-muted-foreground pt-2 pb-6">
        <Editable styles={c.styles} isAdmin={false} slug="brief" path={["footer", "text"]} value={c.footer.text} kind="text">{c.footer.text}</Editable>{" "}
        <a
          href={gmailHref(c.footer.email)}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          <Editable styles={c.styles} isAdmin={false} slug="brief" path={["footer", "email"]} value={c.footer.email} kind="text">{c.footer.email}</Editable>
        </a>
      </p>
      )}
    </div>
  );
}
