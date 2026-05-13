import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const publicRoutes = [
  "/welcome",
  "/login",
  "/signup",
  "/auth/callback",
  "/auth/relink",
  "/creator/login",
  "/creator/signup",
];

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes and shared dashboards
  if (
    publicRoutes.some((r) => pathname === r || pathname.startsWith(r + "/")) ||
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
    // Anonymous creator-portal hits go straight to creator login — they
    // already self-identified by URL. Everyone else gets the chooser at
    // /welcome so we never assume "anonymous = staff" by default.
    url.pathname = isCreatorPortal ? "/creator/login" : "/welcome";
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
