import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { CAMPAIGNS } from "@/lib/cms-schemas";

const CAMPAIGN_SET: ReadonlySet<string> = new Set(CAMPAIGNS);

const publicRoutes = [
  "/welcome",
  "/login",
  "/signup",
  "/auth/callback",
  "/auth/relink",
  // Legacy single-campaign creator URLs — kept public because they
  // 307-redirect to the per-campaign Minutewise equivalent below.
  "/creator/login",
  "/creator/signup",
  "/creator/brief",
  "/creator/setup",
];

/**
 * Patterns for public, pre-auth pages whose path varies by campaign
 * (or any other dynamic segment). The proxy treats anything matching
 * one of these as unauthenticated — same as a literal publicRoutes
 * entry. Keep these tight: each regex anchors the full path so an
 * attacker can't smuggle through a nested admin route by tacking the
 * suffix on.
 */
const publicRoutePatterns: RegExp[] = [
  // Per-campaign creator onboarding pages
  /^\/creator\/[a-z0-9-]+\/brief\/?$/,
  /^\/creator\/[a-z0-9-]+\/setup\/tiktok\/?$/,
  /^\/creator\/[a-z0-9-]+\/login\/?$/,
  /^\/creator\/[a-z0-9-]+\/signup\/?$/,
];

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes and shared dashboards
  if (
    publicRoutes.some((r) => pathname === r || pathname.startsWith(r + "/")) ||
    publicRoutePatterns.some((re) => re.test(pathname)) ||
    pathname.startsWith("/share/")
  ) {
    return NextResponse.next();
  }

  // Create a response to pass through
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The creator-portal namespace is exactly /creator (the landing) plus
  // anything under /creator/. Using startsWith("/creator") collides
  // with the admin /creators (plural) route, which would silently
  // bounce admins back to / when they click "Creators" in the sidebar.
  const isCreatorPortal = pathname === "/creator" || pathname.startsWith("/creator/");

  if (!user) {
    const url = request.nextUrl.clone();
    //
    // Routing the unauthed redirect:
    //
    //   • /creator/<known-campaign>/...  → /creator/<campaign>/login
    //     (preserve campaign so a Roast AI applicant doesn't get
    //     pushed onto the Minutewise login form)
    //
    //   • /creator/payments,/posts,/... (creator dashboard pages, no
    //     campaign segment), bare /creator, or any /creator path whose
    //     first segment isn't a recognised campaign → /welcome/campaign
    //     (chooser; matches requireCreator()'s server-side redirect)
    //
    //   • everything else → /welcome (the staff-or-creator chooser)
    //
    if (isCreatorPortal) {
      const campaignMatch = pathname.match(/^\/creator\/([a-z0-9-]+)(\/|$)/);
      const campaignSeg = campaignMatch?.[1];
      url.pathname = campaignSeg && CAMPAIGN_SET.has(campaignSeg)
        ? `/creator/${campaignSeg}/login`
        : "/welcome/campaign";
    } else {
      url.pathname = "/welcome";
    }
    return NextResponse.redirect(url);
  }

  // Role-based routing. We re-read profiles.role here rather than
  // trusting any cached value so an admin demoting a creator (or vice
  // versa) takes effect on the next navigation. One extra round-trip
  // per request, fine for now.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();
  const role = profile?.role ?? "viewer";

  // Creator users only ever belong on /creator/*. Bounce them off
  // staff routes so they can't accidentally land on the admin shell.
  if (role === "creator" && !isCreatorPortal) {
    const url = request.nextUrl.clone();
    url.pathname = "/creator";
    return NextResponse.redirect(url);
  }

  // Staff users on /creator/* go back to the staff dashboard. Without
  // this, an admin clicking a creator-portal link would briefly see
  // the creator UI before requireCreator() server-renders a redirect.
  if (role !== "creator" && isCreatorPortal) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
