import Link from "next/link";
import { requireCreator } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";
import { SupabaseErrorSuppressor } from "@/components/supabase-error-suppressor";
import { Sparkles } from "lucide-react";
import { CreatorNav } from "./creator-nav";

/**
 * Creator portal shell.
 *
 * Visual identity adapted from modern creator dashboards (Stripe
 * Express, Beehiiv, Substack writer):
 *   - Generous max-width (5xl) and vertical rhythm so content has
 *     room to breathe.
 *   - Soft radial gradient backdrop (emerald → background) for
 *     warmth without competing with content.
 *   - Sticky translucent header with backdrop blur.
 *   - Active-aware tab nav with an emerald underline.
 *   - Time-of-day greeting on the hero in the page itself, not here.
 *
 * Defense-in-depth: every page also runs requireCreator() — this
 * layout's gate is the first redirect anonymous/staff users hit.
 */
export default async function CreatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { creator } = await requireCreator();
  const initials = (creator.display_name || creator.legal_name)
    .replace(/^@/, "")
    .split(/\s+/)
    .map((s: string) => s[0]?.toUpperCase())
    .filter(Boolean)
    .slice(0, 2)
    .join("");

  return (
    <div className="min-h-screen bg-background relative">
      {/* Subtle radial gradient backdrop. Pointer-events-none so it
          never interferes with clicks; aria-hidden for screen readers. */}
      <div
        aria-hidden
        className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,theme(colors.emerald.500/0.08),transparent_55%),radial-gradient(circle_at_bottom_left,theme(colors.emerald.500/0.04),transparent_50%)] pointer-events-none"
      />

      <header className="border-b border-border/40 bg-background/70 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <Link href="/creator" className="flex items-center gap-3 group min-w-0">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white shadow-sm shrink-0">
              {initials ? (
                <span className="text-xs font-semibold tracking-wide">{initials}</span>
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm tracking-tight leading-none truncate">
                {creator.display_name || creator.legal_name}
              </p>
              <p className="text-[10px] uppercase tracking-widest text-emerald-700/80 dark:text-emerald-400/70 font-medium mt-1">
                Creator portal
              </p>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <CreatorNav />
            <span className="hidden sm:block w-px h-5 bg-border/60 mx-1" />
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
        {children}
      </main>

      {/* Silences the benign "Lock stolen" promise rejection from
          Supabase auth-token refresh. See component docs for details. */}
      <SupabaseErrorSuppressor />

      <footer className="max-w-5xl mx-auto px-4 sm:px-6 py-8 text-center">
        <p className="text-[11px] text-muted-foreground">
          Need help? Message your contact directly. We don&apos;t track support
          tickets here yet.
        </p>
      </footer>
    </div>
  );
}
