import { NextResponse } from "next/server";
import { linkCreatorAccountAfterSignup } from "@/lib/link-creator";
import { createClient } from "@/lib/supabase";

/**
 * Post-login relink endpoint. Used when a creator signs in with
 * password (the email-confirmation flow doesn't run because the user
 * already exists). Idempotent — if already linked, no-ops and routes
 * to /creator.
 *
 * If the caller passed `?from=creator` (set by /creator/login), this
 * endpoint treats the creator portal as a one-way door: a signed-in
 * user who is not a creator (and can't be auto-linked into one) gets
 * signed out and bounced back to /creator/login?reason=not-a-creator.
 * Without that, a staff/admin sign-in on the creator login would
 * silently land on the staff dashboard at / — which is what we used
 * to do, and what triggered the bug report this fixes.
 */
export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const fromCreator = searchParams.get("from") === "creator";

  const link = await linkCreatorAccountAfterSignup().catch(() => ({ linked: false }));
  if (link.linked) {
    return NextResponse.redirect(`${origin}/creator`);
  }

  // Not linked — fall back to inspecting the role we already have so a
  // returning creator with an existing role='creator' still lands on
  // their portal (the linker only acts on unlinked rows).
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle<{ role: string }>();
    if (profile?.role === "creator") {
      return NextResponse.redirect(`${origin}/creator`);
    }

    // Creator-portal sign-in by a non-creator. Sign them out so they
    // don't end up in a half-state (authenticated but on the wrong
    // portal), then surface a clear error on the creator login.
    if (fromCreator) {
      await supabase.auth.signOut();
      return NextResponse.redirect(
        `${origin}/creator/login?reason=not-a-creator`,
      );
    }
  }

  return NextResponse.redirect(`${origin}/`);
}
