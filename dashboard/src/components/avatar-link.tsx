"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase-browser";

export function AvatarLink() {
  const [initial, setInitial] = useState("?");

  useEffect(() => {
    // See UserNav for the rationale: getSession() (storage-read, no
    // lock) is safe for chrome that only needs a display character.
    const supabase = createBrowserSupabase();
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user;
      const seed = u?.email ?? (typeof u?.user_metadata?.name === "string" ? u.user_metadata.name : "?");
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
