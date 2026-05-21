/**
 * /creator/brief — the internship brief.
 *
 * Long-scroll onboarding page that mirrors the BrewApps Creators Corner
 * brief (creators-corner.netlify.app/brief/) but rendered in the MinuteWise
 * dashboard theme. Replaces the direct welcome → creator/login jump: a
 * prospective creator now reads the program details before signing up.
 *
 * Structure (top to bottom):
 *   1. Hero
 *   2. Internship brief video
 *   3. About Us
 *   4. Impactful Work by Our Interns (4 TikTok showcases)
 *   5. Slideshow Internship Details (Duration + Compensation)
 *   6. What You'll Do (Daily Tasks + Learning Opportunities)
 *   7. Interns That We Love (Technical + Personal qualities)
 *   8. FAQ
 *   9. Help / contact
 *  10. Your Journey to Success (7 steps)
 *  11. Get Started CTA
 *  12. Got Questions CTA
 */

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import {
  ChevronRight, Video, FileText, Building2, Users, Clock, Wallet,
  Sparkles, GraduationCap, CheckCircle2, HelpCircle, MessageSquare,
  Rocket, ArrowRight, Mail, ExternalLink, Phone, Flame, ArrowUpRight,
} from "lucide-react";

export default function CreatorBriefPage() {
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
      <header className="text-center space-y-3">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px] uppercase tracking-widest font-semibold">
          BrewApps Slideshow Internship
        </div>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">
          BrewApps Slideshow Internship
        </h1>
        <p className="text-muted-foreground text-base max-w-2xl mx-auto">
          Thanks for your interest in taking on this project! We are looking
          forward to the opportunity to collaborate and see the amazing
          content that you create!
        </p>
      </header>

      {/* ─── Internship Brief Video ──────────────────────────────── */}
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-5">
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-semibold inline-flex items-center gap-2 justify-center">
              <Video className="h-5 w-5 text-emerald-600" />
              Internship Brief Video
            </h2>
            <p className="text-sm text-muted-foreground max-w-xl mx-auto">
              Watch this comprehensive video to understand the internship
              program, expectations, and get started with your journey.
            </p>
          </div>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-center py-10 px-4">
            <p className="text-sm font-medium text-destructive">Video not found</p>
            <p className="text-xs text-destructive/80 mt-1">
              Video key: <code className="bg-destructive/10 px-1.5 py-0.5 rounded">internship_brief</code>
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 p-4 space-y-2">
            <p className="text-sm font-semibold inline-flex items-center gap-1.5">
              <FileText className="h-4 w-4 text-emerald-600" />
              What you&apos;ll learn in this video:
            </p>
            <ul className="text-sm text-muted-foreground space-y-1.5 ml-1">
              <li>• Complete overview of the internship program and expectations</li>
              <li>• Step-by-step guide to getting started with TikTok account setup</li>
              <li>• Understanding the compensation structure and performance metrics</li>
              <li>• How to use our internal tools for content creation</li>
              <li>• Tips for success and best practices from our team</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* ─── About Us ────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-4">
          <h2 className="text-2xl font-semibold inline-flex items-center gap-2">
            <Building2 className="h-5 w-5 text-emerald-600" />
            About Us
          </h2>
          <p className="text-sm text-muted-foreground">
            BrewApps is a mobile app development studio that owns and builds
            multiple apps focused on smart, intuitive, and AI-powered tools
            that simplify everyday life. Some of our apps include:
          </p>
          <ul className="text-sm space-y-1.5 ml-1">
            <li>
              <span className="font-semibold">Minutewise</span>{" "}
              <span className="text-muted-foreground">– AI meeting and lecture summaries</span>
            </li>
            <li>
              <span className="font-semibold">Roast AI</span>{" "}
              <span className="text-muted-foreground">– Smart texting and conversation assistant</span>
            </li>
            <li>
              <span className="font-semibold">EZTape</span>{" "}
              <span className="text-muted-foreground">– Call recording and voice-note management</span>
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            These are just a few of the apps we&apos;ve built, and we continue to
            expand our portfolio with new, innovative solutions.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            {[
              {
                name: "Minutewise",
                href: "https://apps.apple.com/app/id6739527717",
                Icon: Sparkles,
                gradient: "from-emerald-400 to-emerald-600",
                hover: "hover:border-emerald-500/40 hover:bg-emerald-500/[0.04]",
                arrow: "group-hover:text-emerald-600",
              },
              {
                name: "Call Recorder",
                href: "https://apps.apple.com/in/app/call-recording-app-for-iphone/id1512476140",
                Icon: Phone,
                gradient: "from-indigo-400 to-indigo-600",
                hover: "hover:border-indigo-500/40 hover:bg-indigo-500/[0.04]",
                arrow: "group-hover:text-indigo-600",
              },
              {
                name: "Roast AI",
                href: "https://apps.apple.com/in/app/roast-ai-texting-assistant/id6737178219",
                Icon: Flame,
                gradient: "from-fuchsia-400 to-pink-600",
                hover: "hover:border-fuchsia-500/40 hover:bg-fuchsia-500/[0.04]",
                arrow: "group-hover:text-fuchsia-600",
              },
            ].map((app) => (
              <a
                key={app.name}
                href={app.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`group flex items-center gap-3 rounded-xl border border-border bg-card transition-all px-3 py-2.5 ${app.hover}`}
              >
                <div className={`h-11 w-11 rounded-xl bg-gradient-to-br ${app.gradient} flex items-center justify-center text-white shadow-sm shrink-0`}>
                  <app.Icon className="h-5 w-5" strokeWidth={2.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-tight truncate">{app.name}</p>
                  <p className="text-[10.5px] text-muted-foreground uppercase tracking-wider mt-0.5">
                    iOS App Store
                  </p>
                </div>
                <ArrowUpRight className={`h-4 w-4 text-muted-foreground transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 ${app.arrow}`} />
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ─── Impactful Work by Our Interns ───────────────────────── */}
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-4">
          <div>
            <h2 className="text-2xl font-semibold inline-flex items-center gap-2">
              <Users className="h-5 w-5 text-emerald-600" />
              Impactful Work by Our Interns
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Showcasing intern work seen by millions
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
            {[
              { n: 1, handle: "@miniutewise_thomas", youtubeId: "a4u006u3nXc", tiktokUrl: "https://www.tiktok.com/@miniutewise_thomas/photo/7531069420211309844" },
              { n: 2, handle: "@studybae_ai",       youtubeId: "SVbQiLROuUg", tiktokUrl: "https://www.tiktok.com/@studybae_ai/photo/7515481851264322834" },
              { n: 3, handle: "@studybae_ai",       youtubeId: "7z5pKhNG25w", tiktokUrl: "https://www.tiktok.com/@studybae_ai/photo/7516944029779512583" },
              { n: 4, handle: "@studybae_ai",       youtubeId: "kJ6FVXGbk20", tiktokUrl: "https://www.tiktok.com/@studybae_ai/photo/7512187048825048327" },
            ].map((tile) => (
              <div key={tile.n} className="flex flex-col rounded-xl border border-border bg-muted/30 p-3 gap-2">
                <div className="flex items-center gap-2 px-1">
                  <span className="h-6 w-6 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-xs font-semibold flex items-center justify-center">
                    {tile.n}
                  </span>
                  <span className="text-xs text-muted-foreground">MinuteWise</span>
                </div>
                {/* Real YouTube embed — same approach the source brief uses
                    at creators-corner.netlify.app/brief/. TikTok's own embeds
                    are heavy and don't fit a 4-up grid; YouTube renders cleanly. */}
                <div className="relative aspect-[9/16] w-full rounded-lg overflow-hidden bg-black">
                  <iframe
                    src={`https://www.youtube.com/embed/${tile.youtubeId}`}
                    className="absolute inset-0 w-full h-full"
                    title={`Intern post #${tile.n}`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                </div>
                <a
                  href={tile.tiktokUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-center text-emerald-700 dark:text-emerald-400 font-medium inline-flex items-center gap-1 justify-center hover:underline py-1.5 rounded-md border border-border bg-background"
                >
                  <ExternalLink className="h-3 w-3" />
                  View on TikTok
                </a>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ─── Slideshow Internship Details ────────────────────────── */}
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-5">
          <div>
            <h2 className="text-2xl font-semibold inline-flex items-center gap-2">
              <Users className="h-5 w-5 text-emerald-600" />
              Slideshow Internship Details
            </h2>
            <p className="text-sm text-muted-foreground mt-2 rounded-md bg-emerald-500/[0.06] border border-emerald-500/20 px-3 py-2.5">
              As part of this internship, you&apos;ll use our internal tool to
              create slideshows (sequences of images) and post them on
              TikTok daily.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-muted/30 p-5 space-y-3">
              <h3 className="font-semibold inline-flex items-center gap-2">
                <Clock className="h-4 w-4 text-emerald-600" />
                Duration &amp; Commitment
              </h3>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li className="flex gap-2"><span className="text-emerald-600">✦</span> Initially 1 month (extendable based on performance)</li>
                <li className="flex gap-2"><span className="text-emerald-600">✦</span> 30-40 minutes daily commitment</li>
                <li className="flex gap-2"><span className="text-emerald-600">✦</span> Flexible schedule — create content daily or in bulk</li>
              </ul>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-5 space-y-3">
              <h3 className="font-semibold inline-flex items-center gap-2">
                <Wallet className="h-4 w-4 text-emerald-600" />
                Compensation Structure
              </h3>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li className="flex gap-2"><span className="text-emerald-600">✦</span> Performance-based: ₹20 CPM (₹20 per 1,000 views)</li>
                <li className="flex gap-2"><span className="text-emerald-600">✦</span> 100,000 views = ₹2,000 | 500,000 views = ₹10,000</li>
                <li className="flex gap-2"><span className="text-emerald-600">✦</span> 1,000,000 views = ₹20,000</li>
                <li className="flex gap-2"><span className="text-emerald-600">✦</span> Monthly earnings capped at ₹40,000</li>
                <li className="flex gap-2"><span className="text-emerald-600">✦</span> Top performers get fixed stipend + performance bonuses</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── What You'll Do ──────────────────────────────────────── */}
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-5">
          <h2 className="text-2xl font-semibold inline-flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-emerald-600" />
            What You&apos;ll Do
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold mb-3">Daily Tasks</h3>
              <ul className="text-sm text-muted-foreground space-y-1.5">
                <li>• Use internal tools to recreate slideshows</li>
                <li>• Post 3 slideshows daily on TikTok</li>
                <li>• Create TikTok account using VPN (for users in India)</li>
                <li>• Maintain consistent posting schedule</li>
                <li>• Collaborate with other interns in group</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-3">Learning Opportunities</h3>
              <ul className="text-sm text-muted-foreground space-y-1.5">
                <li>• AI tools for content creation</li>
                <li>• Social media marketing strategies</li>
                <li>• TikTok account setup and optimization</li>
                <li>• Content creation workflows</li>
                <li>• Performance tracking and optimization</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Interns We Love to Work With ────────────────────────── */}
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-5">
          <h2 className="text-2xl font-semibold inline-flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-emerald-600" />
            Interns That We Love to Work With
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold mb-3">Technical Requirements</h3>
              <ul className="text-sm text-muted-foreground space-y-2">
                {[
                  "Learning mindset for AI tools exploration",
                  "Basic understanding of social media platforms",
                  "Ability to follow step-by-step instructions",
                  "Comfortable with VPN setup for TikTok access",
                ].map((it) => (
                  <li key={it} className="flex gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-3">Personal Qualities</h3>
              <ul className="text-sm text-muted-foreground space-y-2">
                {[
                  "Creative and tech-savvy mindset",
                  "Ability to dedicate 30-40 minutes daily",
                  "Consistent posting without much management",
                  "Collaborative team player attitude",
                ].map((it) => (
                  <li key={it} className="flex gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── FAQ ─────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-4">
          <div className="text-center space-y-1">
            <h2 className="text-2xl font-semibold inline-flex items-center gap-2 justify-center">
              <HelpCircle className="h-5 w-5 text-emerald-600" />
              Frequently Asked Questions
            </h2>
            <p className="text-sm text-muted-foreground">
              Common questions about our internship program answered by our team.
            </p>
          </div>
          <div className="space-y-2">
            {[
              {
                q: "What is the start date for the internship?",
                a: "You can start right away! Once you sign up on the dashboard, you can make an offer letter request based on your chosen start date.",
              },
              {
                q: "I'm not available at the moment; I want to join the internship a month later.",
                a: "Please come back and apply a week before your intended start date. You can then choose the date to start on the dashboard when you request the offer letter.",
              },
              {
                q: "What is the duration of the internship? I'm looking for something more than one month.",
                a: "It starts as one month, but if you're performing well and are consistent, we have no issues extending it. These roles are always available for multiple apps, so you can continue as long as you're performing.",
              },
              {
                q: "What is the salary structure?",
                a: "The compensation is on a CPM (Cost Per Mille) basis — ₹20 per thousand views. You can find detailed information about the compensation structure in the brief above. It's performance-based, meaning your earnings depend on the views your content generates.",
              },
              {
                q: "Is this an in-office or remote position?",
                a: "This is a remote position, and you can work completely at your own time. You can batch create content and post it at your own pace.",
              },
              {
                q: "Will I be receiving an offer letter?",
                a: "Yes, once you sign up on the dashboard, you can request the offer letter.",
              },
              {
                q: "Will I receive an experience letter?",
                a: "Yes, you will receive an experience letter. It can be requested through the dashboard at the end of the internship. Please note that the experience letter will be issued only after completing the required 90 posts.",
              },
            ].map((item, i) => (
              <details
                key={i}
                className="group rounded-lg border border-border bg-muted/30 px-4 py-3 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex items-center justify-between cursor-pointer text-sm font-medium select-none">
                  {item.q}
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
                </summary>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{item.a}</p>
              </details>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ─── More questions / Help ───────────────────────────────── */}
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-4 text-center">
          <h2 className="text-xl font-semibold">I have more questions. Where can I get help?</h2>
          <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
            For now, you can reach out to us directly for any questions or
            support. Once you complete all the required steps and officially
            onboarded, you will be added to our Slack workspace for ongoing
            updates and assistance.
          </p>
          <p className="text-sm text-muted-foreground">
            If you need further help in the meantime, you can reach us anytime:
          </p>
          <p className="text-sm inline-flex items-center gap-2 justify-center">
            <Mail className="h-4 w-4 text-emerald-600" />
            Email:{" "}
            <a
              href="mailto:team@thebrewapps.com"
              className="text-emerald-700 dark:text-emerald-400 hover:underline font-medium"
            >
              team@thebrewapps.com
            </a>
          </p>
          <div className="pt-1">
            <a
              href="https://chat.whatsapp.com/Lmw8MXKNPKu0G731bpeNn3?mode=hqrc"
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ className: "bg-emerald-600 hover:bg-emerald-700 text-white" })}
            >
              <MessageSquare className="h-4 w-4 mr-1.5" />
              Join WhatsApp Community
            </a>
          </div>
        </CardContent>
      </Card>

      {/* ─── Journey to Success ──────────────────────────────────── */}
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-5">
          <div className="text-center space-y-1">
            <h2 className="text-2xl font-semibold inline-flex items-center gap-2 justify-center">
              <Rocket className="h-5 w-5 text-emerald-600" />
              Your Journey to Success
            </h2>
            <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
              Follow these simple steps to join the Minutewise team and start
              your internship journey.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { n: 1, title: "Read the Brief", desc: "📖 Review this page to understand the internship program and requirements." },
              { n: 2, title: "Setup TikTok", desc: "📱 Create your TikTok account with VPN and follow our setup guide." },
              { n: 3, title: "Sign Up", desc: "🎯 Register for the creator dashboard with your details." },
              { n: 4, title: "Join Slack", desc: "💬 Connect with the team in our internal creator Slack workspace." },
              { n: 5, title: "Request Offer", desc: "📋 Submit your offer letter request through the dashboard." },
              { n: 6, title: "Setup Tools", desc: "⚙ Familiarize yourself with the slideshow builder tool." },
            ].map((s) => (
              <div key={s.n} className="rounded-lg border border-border bg-muted/30 p-4 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="h-6 w-6 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-xs font-semibold flex items-center justify-center">
                    {s.n}
                  </span>
                  <h3 className="font-semibold text-sm">{s.title}</h3>
                </div>
                <p className="text-xs text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white p-5 text-center space-y-1">
            <div className="inline-flex items-center gap-2 justify-center">
              <span className="h-6 w-6 rounded-full bg-white/20 text-xs font-semibold flex items-center justify-center">7</span>
              <h3 className="font-semibold">Start Creating Content!</h3>
            </div>
            <p className="text-xs opacity-90">
              🚀 Warm up your TikTok account and start posting amazing slideshows daily!
            </p>
          </div>
          <p className="text-xs text-center text-muted-foreground inline-flex items-center gap-1.5 w-full justify-center">
            <Clock className="h-3.5 w-3.5" />
            Estimated time: 30-45 minutes to complete all setup steps
          </p>
        </CardContent>
      </Card>

      {/* ─── Get Started CTA — hero card ─────────────────────────── */}
      <Card className="relative overflow-hidden border-emerald-600/40 bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 text-white shadow-xl">
        {/* Decorative blur orbs — give the flat card real depth */}
        <div className="pointer-events-none absolute -top-24 -right-20 h-72 w-72 rounded-full bg-emerald-300/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 -left-24 h-72 w-72 rounded-full bg-teal-300/20 blur-3xl" />
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-96 w-96 rounded-full bg-emerald-400/10 blur-3xl" />

        {/* Faint dot pattern overlay for texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "20px 20px",
          }}
        />

        <CardContent className="relative p-8 sm:p-12 text-center space-y-5">
          {/* Eyebrow badge */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-sm text-[10.5px] uppercase tracking-[0.15em] font-semibold border border-white/25">
            <Sparkles className="h-3 w-3" />
            Start earning in 30 minutes
          </div>

          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Ready to Get Started?
          </h2>

          <p className="text-base sm:text-lg text-emerald-50/90 max-w-xl mx-auto">
            Begin with setting up your TikTok account and join the Minutewise
            team!&nbsp;🌟
          </p>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2 justify-center pt-1">
            {[
              { icon: CheckCircle2, label: "Remote — work anywhere" },
              { icon: Wallet, label: "₹20 per 1,000 views" },
              { icon: Rocket, label: "Step-by-step guide" },
            ].map((p) => (
              <span
                key={p.label}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-white/10 border border-white/20 backdrop-blur-sm text-white/90"
              >
                <p.icon className="h-3 w-3" strokeWidth={2.5} />
                {p.label}
              </span>
            ))}
          </div>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
            <Link
              href="/creator/setup/tiktok"
              className="group inline-flex items-center justify-center px-7 py-3.5 rounded-xl bg-white text-emerald-700 font-semibold hover:bg-emerald-50 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
            >
              Get Started
              <ArrowRight className="h-4 w-4 ml-1.5 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link
              href="/creator/login"
              className="inline-flex items-center justify-center px-6 py-3.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium border border-white/30 backdrop-blur-sm transition-colors"
            >
              Already have an account? Sign in
            </Link>
          </div>

          <p className="text-xs text-emerald-50/70 pt-1 inline-flex items-center gap-1.5 justify-center w-full">
            <Clock className="h-3.5 w-3.5" />
            Step-by-step TikTok setup guide included
          </p>
        </CardContent>
      </Card>

      {/* ─── Got Questions ───────────────────────────────────────── */}
      <Card>
        <CardContent className="p-6 sm:p-8 space-y-4 text-center">
          <h2 className="text-xl font-semibold inline-flex items-center gap-2 justify-center">
            <HelpCircle className="h-5 w-5 text-emerald-600" />
            Got Questions?
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
            If you have any questions or encounter any issues, feel free to
            reach out to us directly:
          </p>
          <p className="text-sm inline-flex items-center gap-2 justify-center">
            <Mail className="h-4 w-4 text-emerald-600" />
            Email:{" "}
            <a
              href="mailto:team@thebrewapps.com"
              className="text-emerald-700 dark:text-emerald-400 hover:underline font-medium"
            >
              team@thebrewapps.com
            </a>
          </p>
          <div className="pt-1">
            <a
              href="https://chat.whatsapp.com/Lmw8MXKNPKu0G731bpeNn3?mode=hqrc"
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ className: "bg-emerald-600 hover:bg-emerald-700 text-white" })}
            >
              <MessageSquare className="h-4 w-4 mr-1.5" />
              Join WhatsApp Community
            </a>
          </div>
          <p className="text-xs text-muted-foreground">We&apos;re always here to help!</p>
        </CardContent>
      </Card>

      {/* ─── Footer ──────────────────────────────────────────────── */}
      <p className="text-center text-xs text-muted-foreground pt-2 pb-6">
        Questions? Contact us at{" "}
        <a href="mailto:team@thebrewapps.com" className="hover:underline">
          team@thebrewapps.com
        </a>
      </p>
    </div>
  );
}
