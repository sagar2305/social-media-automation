import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { linkCreatorAccountAfterSignup } from "@/lib/link-creator";

/**
 * Auth callback — runs after Supabase redirects back from the magic
 * link / email confirmation. Two responsibilities:
 *
 *   1. Exchange the OAuth/PKCE code for a session cookie. If the
 *      exchange fails, send the user back to /login with no surprises.
 *
 *   2. Run the post-signup creator linker (idempotent). If the email
 *      that just signed in matches an unlinked creators.email row,
 *      promote their profile role to 'creator' and link the row.
 *      Final redirect target depends on the linker result:
 *        - linked → /creator
 *        - not linked → ?next param if provided, else /
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (!code) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login`);
  }

  // Try the link. Non-fatal on any error path — we don't want to
  // strand a successfully-authenticated user on /login because the
  // linker had a bad day.
  const link = await linkCreatorAccountAfterSignup().catch(() => ({ linked: false }));

  if (link.linked) {
    return NextResponse.redirect(`${origin}/creator`);
  }

  return NextResponse.redirect(`${origin}${next ?? "/"}`);
}
