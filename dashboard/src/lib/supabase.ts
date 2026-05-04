import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            try {
              cookieStore.set(name, value, options);
            } catch {
              // setAll called from Server Component — ignore
            }
          });
        },
      },
      auth: {
        // Don't auto-refresh on every server-side query. The proxy middleware
        // already refreshes once per request — letting page components refresh
        // again triggers the "Lock was released because another request stole
        // it" runtime error when Promise.all fires multiple queries in parallel.
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
