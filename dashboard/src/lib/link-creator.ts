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
import { encryptSecret } from "@/lib/credential-vault";

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
  let candidate = (await supabase
    .from("creators")
    .select("id, status, onboarded_at")
    .ilike("email", user.email)
    .is("auth_user_id", null)
    .maybeSingle<{ id: string; status: string; onboarded_at: string | null }>()).data;

  // Self-service signup path: no admin pre-invited this user. Create
  // the creators row on-the-fly from auth metadata so the link below
  // has something to attach to. The application-data sync block lower
  // down then back-fills phone / TikTok / etc. on the same row.
  if (!candidate) {
    const md = user.user_metadata ?? {};
    const fullName =
      (typeof md.full_name === "string" && md.full_name) ||
      user.email.split("@")[0];
    const { data: created, error: insertErr } = await supabase
      .from("creators")
      .insert({
        kind: "team_member", // internship signups via /creator/signup
        legal_name: fullName,
        email: user.email.toLowerCase(),
        status: "invited", // promoted to onboarded by the link below
        country: "in",
        preferred_processor: "manual",
      })
      .select("id, status, onboarded_at")
      .single<{ id: string; status: string; onboarded_at: string | null }>();
    if (insertErr || !created) {
      console.error(
        `[link-creator] auto-create failed for ${user.email}: ${insertErr?.code} ${insertErr?.message}`,
      );
      return { linked: false, reason: `auto-create-failed: ${insertErr?.message ?? "no row returned"}` };
    }
    candidate = created;
  }

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

  // Best-effort: copy internship-application data from auth user_metadata
  // (set by /creator/signup) onto the creators row so admins see the
  // fields populated immediately on /creators/{id}. Failures here don't
  // block the link — the link itself already succeeded above; an admin
  // can edit/fill the application card manually if this write fails.
  try {
    const md = user.user_metadata ?? {};
    const appPatch: Record<string, unknown> = {
      phone: md.phone_number ?? null,
      whatsapp: md.whatsapp_number ?? null,
      tiktok_username: md.tiktok_username ?? null,
      tiktok_email: md.tiktok_email ?? null,
      youtube_gmail: md.youtube_gmail ?? null,
      instagram_username: md.instagram_username ?? null,
      facebook_url: md.facebook_url ?? null,
    };
    // Encrypt the four password fields before persisting. Skip on
    // empty input so admins can clear later by saving an empty value.
    const passwordPairs: Array<[string, string]> = [
      ["tiktok_password", "tiktok_password_enc"],
      ["tiktok_email_password", "tiktok_email_password_enc"],
      ["youtube_password", "youtube_password_enc"],
      ["instagram_password", "instagram_password_enc"],
    ];
    for (const [mdKey, col] of passwordPairs) {
      const raw = md[mdKey];
      if (typeof raw === "string" && raw.length > 0) {
        appPatch[col] = encryptSecret(raw);
      }
    }
    await supabase.from("creators").update(appPatch).eq("id", candidate.id);
  } catch (e) {
    console.error(`[link-creator] application-data sync failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
  }

  return { linked: true, creatorId: candidate.id };
}
