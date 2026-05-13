"use server";

/**
 * Post-signup creator linker.
 *
 * Called from /auth/callback right after exchangeCodeForSession()
 * succeeds. Looks at the just-signed-in user, and if their email
 * matches an unlinked creators row:
 *   - Promotes their public.profiles.role from 'viewer' to 'creator'.
 *   - Sets creators.auth_user_id, flips status invited→onboarded,
 *     stamps onboarded_at.
 *
 * Idempotent: every check is gated on the row being unlinked, so
 * re-running on a returning login is a no-op. Failures are non-fatal
 * — the caller still completes the session exchange and lands the
 * user somewhere reasonable; an unlinked-but-signed-in user just
 * stays a 'viewer' until an admin fixes it manually.
 *
 * Why a server action and not a trigger: a trigger replacement
 * touches auth-critical infrastructure. A bug in this file at worst
 * leaves a single user un-promoted; a bug in a trigger breaks every
 * future signup.
 */

import { createClient } from "@/lib/supabase";

interface LinkResult {
  linked: boolean;
  creatorId?: string;
  reason?: string;
}

export async function linkCreatorAccountAfterSignup(): Promise<LinkResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) return { linked: false, reason: "no-user" };

  // Skip when already linked — covers the returning-login path.
  const { data: existing } = await supabase
    .from("creators")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle<{ id: string }>();
  if (existing) return { linked: true, creatorId: existing.id, reason: "already-linked" };

  // Match on lower(email). createCreator() lowercases on insert so
  // the lookup is symmetric with the data we wrote.
  const { data: candidate } = await supabase
    .from("creators")
    .select("id, status, onboarded_at")
    .ilike("email", user.email)
    .is("auth_user_id", null)
    .maybeSingle<{ id: string; status: string; onboarded_at: string | null }>();
  if (!candidate) return { linked: false, reason: "no-matching-creator" };

  // Two writes; if either fails, leave the user as 'viewer' and let
  // the admin re-link manually rather than half-promote.
  const { error: linkErr } = await supabase
    .from("creators")
    .update({
      auth_user_id: user.id,
      status: candidate.status === "invited" ? "onboarded" : candidate.status,
      onboarded_at: candidate.onboarded_at ?? new Date().toISOString(),
    })
    .eq("id", candidate.id)
    .is("auth_user_id", null);   // belt-and-braces: race-safe
  if (linkErr) return { linked: false, reason: `link-failed: ${linkErr.message}` };

  const { error: roleErr } = await supabase
    .from("profiles")
    .update({ role: "creator" })
    .eq("id", user.id);
  if (roleErr) return { linked: false, reason: `role-update-failed: ${roleErr.message}` };

  return { linked: true, creatorId: candidate.id };
}
