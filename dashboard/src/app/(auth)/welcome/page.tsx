/**
 * /welcome — portal chooser.
 *
 * Two cards: "I'm a Creator" and "I'm on the Team". Content + styling
 * fetched from the CMS. Admins edit at /signup-control/welcome.
 */

import Link from "next/link";
import { Sparkles, ShieldCheck, ChevronRight } from "lucide-react";
import { getPageContent } from "@/lib/cms";
import { CustomSections } from "@/lib/cms-render";
import { Editable } from "@/components/cms-inline/editable";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const c = await getPageContent("welcome");
  // The <Editable> wrappers here serve only to apply per-text styles
  // from the CMS styles map to public visitors. isAdmin is hard-false
  // so no pencils/edit UI ever render. Editing lives at
  // /signup-control/welcome.
  return (
    <div className="w-full max-w-3xl px-4 space-y-10">
      <div className="text-center space-y-2">
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">
          <Editable styles={c.styles} isAdmin={false} slug="welcome" path={["hero", "title"]} value={c.hero.title} kind="text">{c.hero.title}</Editable>
        </h1>
        <p className="text-muted-foreground text-base">
          <Editable styles={c.styles} isAdmin={false} slug="welcome" path={["hero", "subtitle"]} value={c.hero.subtitle} kind="text">{c.hero.subtitle}</Editable>
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          href={c.creatorCard.href}
          className="group relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.08] to-emerald-500/[0.02] hover:from-emerald-500/[0.12] hover:to-emerald-500/[0.04] transition-colors p-6 sm:p-7 flex flex-col gap-3"
        >
          <div className="flex items-center justify-between">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <ChevronRight className="h-5 w-5 text-emerald-600/60 dark:text-emerald-400/60 group-hover:translate-x-1 transition-transform" />
          </div>
          <div>
            <p className="text-lg font-semibold">
              <Editable styles={c.styles} isAdmin={false} slug="welcome" path={["creatorCard", "title"]} value={c.creatorCard.title} kind="text">{c.creatorCard.title}</Editable>
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              <Editable styles={c.styles} isAdmin={false} slug="welcome" path={["creatorCard", "body"]} value={c.creatorCard.body} kind="textarea">{c.creatorCard.body}</Editable>
            </p>
          </div>
          <p className="text-[11px] uppercase tracking-widest text-emerald-700/80 dark:text-emerald-400/80 font-medium mt-auto">
            <Editable styles={c.styles} isAdmin={false} slug="welcome" path={["creatorCard", "eyebrow"]} value={c.creatorCard.eyebrow} kind="text">{c.creatorCard.eyebrow}</Editable>
          </p>
        </Link>

        <Link
          href={c.staffCard.href}
          className="group relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-muted/40 to-muted/0 hover:from-muted/60 hover:to-muted/10 transition-colors p-6 sm:p-7 flex flex-col gap-3"
        >
          <div className="flex items-center justify-between">
            <div className="h-10 w-10 rounded-xl bg-foreground/[0.05] flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-foreground/70" />
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:translate-x-1 transition-transform" />
          </div>
          <div>
            <p className="text-lg font-semibold">
              <Editable styles={c.styles} isAdmin={false} slug="welcome" path={["staffCard", "title"]} value={c.staffCard.title} kind="text">{c.staffCard.title}</Editable>
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              <Editable styles={c.styles} isAdmin={false} slug="welcome" path={["staffCard", "body"]} value={c.staffCard.body} kind="textarea">{c.staffCard.body}</Editable>
            </p>
          </div>
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium mt-auto">
            <Editable styles={c.styles} isAdmin={false} slug="welcome" path={["staffCard", "eyebrow"]} value={c.staffCard.eyebrow} kind="text">{c.staffCard.eyebrow}</Editable>
          </p>
        </Link>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        <Editable styles={c.styles} isAdmin={false} slug="welcome" path={["footnote"]} value={c.footnote} kind="textarea">{c.footnote}</Editable>
      </p>

      <CustomSections list={c.customSections} />
    </div>
  );
}
