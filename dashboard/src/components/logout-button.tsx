"use client";

/**
 * Minimal logout link — drops the Supabase session and pushes back
 * to the creator login. Used in the creator portal header where the
 * full <UserNav> avatar dropdown would be overkill.
 */

import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";

export function LogoutButton({ redirectTo = "/creator/login" }: { redirectTo?: string }) {
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
