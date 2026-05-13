import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase";

export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  return {
    id: user.id,
    email: user.email ?? "",
    role: (profile?.role as "admin" | "editor" | "viewer" | "creator") ?? "viewer",
  };
}

export async function requireAuth() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(minRole: "admin" | "editor" | "viewer") {
  const user = await requireAuth();
  // 'creator' is a parallel role (their own portal at /creator) — not part
  // of the staff hierarchy, so it never satisfies a staff requireRole call.
  if (user.role === "creator") redirect("/creator");
  const hierarchy = { admin: 3, editor: 2, viewer: 1 };
  if (hierarchy[user.role] < hierarchy[minRole]) {
    redirect("/");
  }
  return user;
}

/**
 * Server-action friendly creator gate. Mirrors assertRole() but for
 * the creator role: returns the resolved creator row (so the action
 * can scope every subsequent query to that creator without trusting
 * any caller-supplied id) and never redirects mid-mutation.
 */
export async function assertCreator(): Promise<
  | { ok: true; user: { id: string; email: string }; creator: { id: string; legal_name: string; display_name: string | null; email: string } }
  | { ok: false; error: string }
> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  if (user.role !== "creator") {
    return { ok: false, error: "Forbidden — creator role required." };
  }
  const supabase = await createClient();
  const { data: creator } = await supabase
    .from("creators")
    .select("id, legal_name, display_name, email")
    .eq("auth_user_id", user.id)
    .maybeSingle<{ id: string; legal_name: string; display_name: string | null; email: string }>();
  if (!creator) return { ok: false, error: "Creator profile not linked. Contact your operator." };
  return { ok: true, user: { id: user.id, email: user.email }, creator };
}

/**
 * Creator-portal gate. Use at the top of every page in the (creator)
 * route group. Redirects:
 *   - anonymous → /creator/login
 *   - staff (admin/editor/viewer) → / (the staff dashboard)
 *
 * Returns the resolved creator row so callers don't have to round-trip
 * again for the legal_name / payout method / etc.
 */
export async function requireCreator() {
  const user = await getUser();
  if (!user) redirect("/creator/login");
  if (user.role !== "creator") redirect("/");

  const supabase = await createClient();
  const { data: creator } = await supabase
    .from("creators")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  // Edge case: user has role='creator' but the creators row was deleted
  // or never linked. Send them to login with a hint; admin can re-invite.
  if (!creator) redirect("/creator/login?reason=unlinked");

  return { user, creator };
}

/**
 * Server-action friendly role gate. Returns a discriminated-union
 * Result instead of redirecting, so actions can surface a clean error
 * message to the UI (e.g. "Forbidden — admin only") rather than
 * triggering a redirect mid-mutation.
 *
 * Use in any server action that writes to ledger / payout / creator
 * tables — defense-in-depth alongside the RLS policies.
 */
export async function assertRole(minRole: "admin" | "editor" | "viewer"):
  Promise<
    | { ok: true; user: { id: string; email: string; role: "admin" | "editor" | "viewer" | "creator" } }
    | { ok: false; error: string }
  >
{
  const user = await getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  if (user.role === "creator") {
    return { ok: false, error: "Forbidden — staff role required (you are signed in as a creator)." };
  }
  const hierarchy = { admin: 3, editor: 2, viewer: 1 };
  // Type assertion: we just narrowed 'creator' out, so the role is
  // definitely one of the staff roles for the hierarchy lookup.
  const staffRole = user.role as "admin" | "editor" | "viewer";
  if (hierarchy[staffRole] < hierarchy[minRole]) {
    return { ok: false, error: `Forbidden — ${minRole} role required (you are ${user.role}).` };
  }
  return { ok: true, user };
}
