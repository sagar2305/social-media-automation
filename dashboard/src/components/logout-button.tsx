"use client";

/**
 * Minimal logout link — drops the Supabase session and routes back
 * to the public chooser. Used in the creator portal header where the
 * full <UserNav> avatar dropdown would be overkill.
 *
 * Default target is /welcome (the portal chooser) rather than a
 * specific campaign's login, because a creator may have accounts
 * across multiple campaigns and we don't want logout to silently
 * dump them on Minutewise.
 */

import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";

export function LogoutButton({ redirectTo = "/welcome" }: { redirectTo?: string }) {
  const router = useRouter();
  async function logout() {
    const supabase = createBrowserSupabase();
    await supabase.auth.signOut();
    router.push(redirectTo);
    router.refresh();
  }
  return (
    <button
      type="button"
      onClick={logout}
      className="text-muted-foreground hover:text-foreground text-sm"
    >
      Log out
    </button>
  );
}
