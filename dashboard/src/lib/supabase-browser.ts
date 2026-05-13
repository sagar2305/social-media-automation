import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client — singleton per tab, survives HMR.
 *
 * Problem: createBrowserClient() registers an internal LockManager
 * tied to localStorage for auth-token refresh. Multiple instances in
 * the same tab fight over the same lock and Supabase throws:
 *
 *   "Lock 'lock:sb-...-auth-token' was released because another
 *    request stole it"
 *
 * Why a plain module-level variable isn't enough: Next.js dev mode
 * uses HMR (hot module reload). Every save re-evaluates this module,
 * which resets the local cache. Existing polling components still
 * hold references to the OLD client (via closures), and the new
 * `createBrowserSupabase()` call creates a SECOND client. Both fight.
 *
 * Fix: stash the singleton on `globalThis` so it persists across
 * module re-evaluations. Identical to the Prisma-on-Next pattern.
 *
 * Typed as `SupabaseClient` (vs `ReturnType<typeof createBrowserClient>`)
 * so existing callers that pass type arguments to `.returns<T>()` keep
 * compiling — full typing requires a Database codegen pass we haven't
 * shipped yet.
 */

declare global {
  // eslint-disable-next-line no-var
  var __minutewise_supabase_browser_client__: SupabaseClient | undefined;
}

export function createBrowserSupabase(): SupabaseClient {
  // Server-side defensive path: if something accidentally calls this
  // from a server component, return a fresh per-call client rather
  // than caching on globalThis (which would leak between requests).
  if (typeof window === "undefined") {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }

  if (globalThis.__minutewise_supabase_browser_client__) {
    return globalThis.__minutewise_supabase_browser_client__;
  }

  globalThis.__minutewise_supabase_browser_client__ = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return globalThis.__minutewise_supabase_browser_client__;
}
