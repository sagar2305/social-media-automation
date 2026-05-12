import { NextResponse } from "next/server";
import { linkCreatorAccountAfterSignup } from "@/lib/link-creator";
import { createClient } from "@/lib/supabase";

/**
 * Post-login relink endpoint. Used when a creator signs in with
 * password (the email-confirmation flow doesn't run because the user
 * already exists). Idempotent — if already linked, no-ops and routes
 * to /creator. If not matchable, sends them to / (staff dashboard)
 * which will redirect back to the right place based on profile role.
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url);

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
  }

  return NextResponse.redirect(`${origin}/`);
}
