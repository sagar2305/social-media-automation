"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase-browser";

export function AvatarLink() {
  const [initial, setInitial] = useState("?");

  useEffect(() => {
    const supabase = createBrowserSupabase();
    supabase.auth.getUser().then(({ data: { user } }) => {
      const seed = user?.email ?? user?.user_metadata?.name ?? "?";
      setInitial(seed.charAt(0).toUpperCase());
    });
  }, []);

  return (
    <Link
      href="/settings"
      title="Settings"
      className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
    >
      {initial}
    </Link>
  );
}
