"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { LogOut } from "lucide-react";

export function UserNav() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // getSession() reads from local storage synchronously — no network
    // round-trip, no auth-token lock acquisition. getUser() does both,
    // and when two chrome components (UserNav + AvatarLink) mount on
    // the same page they race for the lock and Supabase logs:
    //
    //   "Lock 'lock:sb-...-auth-token' was released because another
    //    request stole it"
    //
    // We only need the email for display chrome — no authorization
    // decisions hinge on this value. Session-read is the right call.
    const supabase = createBrowserSupabase();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setEmail(session?.user?.email ?? null);
    });
  }, []);

  async function handleLogout() {
    setLoading(true);
    const supabase = createBrowserSupabase();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  if (!email) return null;

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className="flex items-center gap-3 w-full rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors py-2"
    >
      <LogOut className="h-[18px] w-[18px]" strokeWidth={1.5} />
      Logout
    </button>
  );
}
