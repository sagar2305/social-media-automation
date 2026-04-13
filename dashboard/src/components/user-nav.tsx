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
    const supabase = createBrowserSupabase();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setEmail(user?.email ?? null);
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
