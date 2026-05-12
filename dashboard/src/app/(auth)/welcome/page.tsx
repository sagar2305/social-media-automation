/**
 * /welcome — portal chooser.
 *
 * The first stop for any anonymous visitor. Two cards: "I'm a Creator"
 * (creator portal at /creator/*) and "I'm on the Team" (staff dashboard
 * at /). Each routes to the right login form, so a creator never sees
 * the admin login (and vice versa).
 *
 * Design intent: the chooser should make the two audiences feel like
 * different products — visible from the colour and copy. Creator card
 * leans emerald (money / partnership), staff card leans slate (tools).
 */

import Link from "next/link";
import { Sparkles, ShieldCheck, ChevronRight } from "lucide-react";

export default function WelcomePage() {
  return (
    <div className="w-full max-w-3xl px-4 space-y-10">
      <div className="text-center space-y-2">
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">
          MinuteWise
        </h1>
        <p className="text-muted-foreground text-base">
          Choose how you&apos;re signing in.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Creator card — emerald accent, partner tone. */}
        <Link
          href="/creator/login"
          className="group relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.08] to-emerald-500/[0.02] hover:from-emerald-500/[0.12] hover:to-emerald-500/[0.04] transition-colors p-6 sm:p-7 flex flex-col gap-3"
        >
          <div className="flex items-center justify-between">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <ChevronRight className="h-5 w-5 text-emerald-600/60 dark:text-emerald-400/60 group-hover:translate-x-1 transition-transform" />
          </div>
          <div>
            <p className="text-lg font-semibold">I&apos;m a Creator</p>
            <p className="text-sm text-muted-foreground mt-1">
              Track your earnings, see payment status, and review the posts
              attributed to you.
            </p>
          </div>
          <p className="text-[11px] uppercase tracking-widest text-emerald-700/80 dark:text-emerald-400/80 font-medium mt-auto">
            Creator portal →
          </p>
        </Link>

        {/* Staff card — neutral, tooling tone. */}
        <Link
          href="/login"
          className="group relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-muted/40 to-muted/0 hover:from-muted/60 hover:to-muted/10 transition-colors p-6 sm:p-7 flex flex-col gap-3"
        >
          <div className="flex items-center justify-between">
            <div className="h-10 w-10 rounded-xl bg-foreground/[0.05] flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-foreground/70" />
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:translate-x-1 transition-transform" />
          </div>
          <div>
            <p className="text-lg font-semibold">I&apos;m on the Team</p>
            <p className="text-sm text-muted-foreground mt-1">
              Run campaigns, manage creators, approve payouts, and operate the
              automation.
            </p>
          </div>
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium mt-auto">
            Staff dashboard →
          </p>
        </Link>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Not sure?{" "}
        <span className="text-foreground">
          Pick &quot;Creator&quot; if you&apos;ve been invited to be paid for
          posts.
        </span>
      </p>
    </div>
  );
}
