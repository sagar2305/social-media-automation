"use server";

/**
 * Server actions for the creator-payouts surface.
 *
 * Two responsibilities:
 *   1. CRUD for creators / assignments / campaign payout configs / payouts.
 *   2. The two ledger-writing state transitions: approvePayout +
 *      markPayoutPaid. These are the ONLY surfaces in the system
 *      that write to the Layer 1 ledger tables. Everything else
 *      (calculator, runner) only touches the payouts row.
 *
 * Every ledger-touching mutation:
 *   - Uses an idempotency_key keyed on the entity + action so retries
 *     are safe (e.g. operator double-clicks Approve, browser tab
 *     reloads mid-action, etc).
 *   - Wraps two writes in the same Postgres transaction via the
 *     deferred double-entry trigger so the ledger never goes
 *     unbalanced even if the request fails mid-flight.
 */

import { createClient } from "@/lib/supabase";
import { revalidatePath } from "next/cache";
import { assertRole, assertCreator } from "@/lib/auth";
import { encryptSecret, decryptSecret } from "@/lib/credential-vault";
import type {
  Creator,
  Assignment,
  CampaignPayoutConfig,
  ManualAdjustment,
  Multiplier,
  PayoutMode,
  ProcessorKind,
} from "@/lib/types";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

// ─── Creator CRUD ────────────────────────────────────────────────

interface CreateCreatorInput {
  legal_name: string;
  display_name?: string | null;
  email: string;
  country?: string | null;
  kind?: "ugc" | "team_member";
  preferred_processor?: ProcessorKind;
  manual_payout_notes?: string | null;
  owned_account_ids?: string[];
}

/**
 * Strip a leading "@" from a name/handle input. Operators sometimes
 * paste a TikTok handle copied with the "@" prefix; we don't want
 * that character living in the DB because every display site would
 * have to either render it (looks like a handle when it isn't) or
 * strip it (which we'd have to remember to do). Normalise once at
 * the write boundary instead.
 */
function stripAtSign(s: string | null | undefined): string | null {
  if (s == null) return null;
  const trimmed = s.trim().replace(/^@+/, "");
  return trimmed === "" ? null : trimmed;
}

export async function createCreator(input: CreateCreatorInput): Promise<Result<{ id: string }>> {
  const auth = await assertRole("admin");
  if (!auth.ok) return auth;
  const legalName = stripAtSign(input.legal_name);
  if (!legalName) return { ok: false, error: "Legal name is required" };
  if (!input.email?.trim()) return { ok: false, error: "Email is required" };

  const sb = await createClient();
  const { data, error } = await sb
    .from("creators")
    .insert({
      legal_name: legalName,
      display_name: stripAtSign(input.display_name ?? null),
      email: input.email.trim().toLowerCase(),
      country: input.country?.trim() || null,
      kind: input.kind ?? "ugc",
      preferred_processor: input.preferred_processor ?? "manual",
      manual_payout_notes: input.manual_payout_notes?.trim() || null,
      owned_account_ids: input.owned_account_ids ?? [],
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return { ok: false, error: error?.message ?? "Insert failed" };

  revalidatePath("/creators");
  return { ok: true, data: { id: data.id } };
}

export async function updateCreator(input: { id: string } & Partial<Creator>): Promise<Result> {
  const auth = await assertRole("admin");
  if (!auth.ok) return auth;
  const sb = await createClient();
  const patch: Record<string, unknown> = {};
  for (const k of ["legal_name", "display_name", "email", "country", "preferred_processor", "manual_payout_notes", "owned_account_ids", "status"] as const) {
    if (k in input && input[k] !== undefined) {
      // Strip leading "@" for the two name fields so paste-from-TikTok
      // doesn't leak the prefix into the DB. Other fields pass through.
      if (k === "legal_name" || k === "display_name") {
        patch[k] = stripAtSign(input[k] as string | null);
      } else {
        patch[k] = input[k];
      }
    }
  }
  patch.updated_at = new Date().toISOString();
  const { error } = await sb.from("creators").update(patch).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/creators");
  revalidatePath(`/creators/${input.id}`);
  return { ok: true };
}

/**
 * Replace the campaign-scoped subset of a creator's owned_account_ids
 * in one atomic update.
 *
 * Use case: on /campaigns/<slug>/creators the operator wants to say
 * "these 6 of the campaign's 30 accounts belong to Maya". We can't
 * just overwrite `owned_account_ids` because that would also wipe
 * any accounts Maya owns on OTHER campaigns. So:
 *
 *   1. Load the creator's current owned_account_ids.
 *   2. Compute `keep` = current set MINUS the ids of accounts on THIS
 *      campaign (i.e. all the accounts Maya owns on other campaigns
 *      stay untouched).
 *   3. Validate every incoming accountId actually has campaign_id =
 *      campaignId — otherwise the caller could smuggle in someone
 *      else's account.
 *   4. Strip any incoming accountIds out of every OTHER creator's
 *      array, so one account never has two owners. This is the
 *      one-owner invariant — easy to forget if the caller doesn't.
 *   5. Write the new value: `keep ∪ incoming`.
 *
 * Returns the number of other creators that lost an account in the
 * shuffle (for a confirmation toast like "Reassigned 2 accounts from
 * Thomas to Maya").
 */
export async function setCreatorCampaignAccounts(input: {
  creatorId: string;
  campaignId: string;
  accountIds: string[];
}): Promise<Result<{ ownsNow: number; reassignedFrom: number }>> {
  const auth = await assertRole("admin");
  if (!auth.ok) return auth;
  const sb = await createClient();

  // 1. Pull every account belonging to this campaign + every creator
  //    who currently owns any of those accounts. Two cheap queries,
  //    bounded by campaign size (low double digits in practice).
  const [accountsRes, creatorsRes] = await Promise.all([
    sb.from("accounts")
      .select("id")
      .eq("campaign_id", input.campaignId)
      .returns<Array<{ id: string }>>(),
    // Pull all creators — we need to scan their owned_account_ids
    // arrays for collisions on the incoming ids. At creator-roster
    // sizes (10–50) this is faster than a clever Postgres array-overlap
    // query and easier to reason about.
    sb.from("creators")
      .select("id, owned_account_ids")
      .returns<Array<{ id: string; owned_account_ids: string[] | null }>>(),
  ]);

  const campaignAccountIds = new Set((accountsRes.data ?? []).map((a) => a.id));
  const incoming = new Set(input.accountIds);

  // 2. Validation — every incoming id must be on this campaign. Refuse
  //    silently-buggy clients that try to assign cross-campaign.
  for (const id of incoming) {
    if (!campaignAccountIds.has(id)) {
      return {
        ok: false,
        error: `Account ${id} isn't on this campaign — can't assign it here.`,
      };
    }
  }

  const allCreators = creatorsRes.data ?? [];
  const target = allCreators.find((c) => c.id === input.creatorId);
  if (!target) return { ok: false, error: "Creator not found." };

  // 3. Update the target creator: keep everything they own that's NOT
  //    on this campaign, then add the new selection. This is the
  //    "campaign-scoped replace" — preserves their ownership on
  //    every other campaign exactly.
  const targetCurrent = target.owned_account_ids ?? [];
  const keep = targetCurrent.filter((id) => !campaignAccountIds.has(id));
  const newTargetOwned = [...keep, ...input.accountIds];

  // 4. Strip incoming ids from every OTHER creator. One-owner invariant.
  //    Count how many creators got changed so we can surface it.
  let reassignedFrom = 0;
  const otherUpdates: Array<{ id: string; owned_account_ids: string[] }> = [];
  for (const c of allCreators) {
    if (c.id === input.creatorId) continue;
    const current = c.owned_account_ids ?? [];
    const filtered = current.filter((id) => !incoming.has(id));
    if (filtered.length !== current.length) {
      otherUpdates.push({ id: c.id, owned_account_ids: filtered });
      reassignedFrom += 1;
    }
  }

  // 5. Apply writes. Supabase doesn't have transactions in the JS
  //    client, so this isn't strictly atomic — but the worst case is
  //    a partial update that leaves an account briefly orphaned in a
  //    creator's array, fixable by a re-save. We do the target FIRST
  //    so the chosen creator is always correct, then sweep the rest.
  const now = new Date().toISOString();
  const { error: targetErr } = await sb
    .from("creators")
    .update({ owned_account_ids: newTargetOwned, updated_at: now })
    .eq("id", input.creatorId);
  if (targetErr) return { ok: false, error: `target update: ${targetErr.message}` };

  for (const u of otherUpdates) {
    const { error } = await sb
      .from("creators")
      .update({ owned_account_ids: u.owned_account_ids, updated_at: now })
      .eq("id", u.id);
    if (error) {
      // Don't bail — we already committed the target. Just surface a
      // partial-success warning. Operator can re-save to fix.
      return {
        ok: false,
        error: `partial success — target updated, but another creator's array (${u.id}) failed: ${error.message}`,
      };
    }
  }

  revalidatePath("/accounts");
  revalidatePath("/creators");
  revalidatePath(`/creators/${input.creatorId}`);
  revalidatePath(`/campaigns`);

  return {
    ok: true,
    data: { ownsNow: input.accountIds.length, reassignedFrom },
  };
}

export async function archiveCreator(input: { id: string }): Promise<Result> {
  const auth = await assertRole("admin");
  if (!auth.ok) return auth;
  const sb = await createClient();
  const { error } = await sb.from("creators").update({ status: "archived" }).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/creators");
  return { ok: true };
}

/**
 * Hard-delete a creator. Refuses if the creator has any payouts —
 * those are ledger-bound and removing the creator would orphan
 * approved/paid double-entry rows. Operator must archive instead in
 * that case (or manually clean up via SQL with full awareness).
 *
 * Assignments and post→creator tags are nulled out so the rows
 * remain queryable but no longer attribute to a missing creator.
 *
 * Caller MUST confirm by passing the creator's email as `typedEmail`
 * — same finger-slip gate the campaign delete uses.
 */
export async function deleteCreator(input: {
  id: string;
  typedEmail: string;
}): Promise<Result> {
  const auth = await assertRole("admin");
  if (!auth.ok) return auth;
  const sb = await createClient();

  const { data: creator } = await sb
    .from("creators")
    .select("id, email, legal_name")
    .eq("id", input.id)
    .maybeSingle<{ id: string; email: string; legal_name: string }>();
  if (!creator) return { ok: false, error: "Creator not found" };

  if (input.typedEmail.trim().toLowerCase() !== creator.email.toLowerCase()) {
    return {
      ok: false,
      error: `Type the creator's email exactly to confirm: "${creator.email}"`,
    };
  }

  // Block delete only when there's ACTIVE money on the books —
  // pending/approved/processing payouts mean the calculator or the
  // payout pipeline still considers this creator a live obligation.
  // Terminal payouts (paid/cancelled/failed) have already settled; the
  // ledger entries reference account codes (not creator_id), so they
  // remain valid even after the creator row is gone.
  const { count: activePayoutCount, error: countErr } = await sb
    .from("payouts")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creator.id)
    .in("status", ["pending", "approved", "processing"]);
  if (countErr) return { ok: false, error: countErr.message };
  if ((activePayoutCount ?? 0) > 0) {
    return {
      ok: false,
      error: `This creator has ${activePayoutCount} active payout${activePayoutCount === 1 ? "" : "s"} (pending/approved). Cancel or pay those first, or archive the creator instead.`,
    };
  }

  // Detach assignments + posts, then cascade-delete the terminal
  // payouts (payouts.creator_id is NOT NULL so we can't orphan-to-null).
  // Ledger transactions written when those payouts were approved/paid
  // stay intact — they reference ledger_accounts.code, not creator_id.
  await sb.from("posts").update({ creator_id: null, assignment_id: null }).eq("creator_id", creator.id);
  await sb.from("assignments").delete().eq("creator_id", creator.id);
  await sb.from("payouts").delete().eq("creator_id", creator.id);

  const { error } = await sb.from("creators").delete().eq("id", creator.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/creators");
  return { ok: true };
}

// ─── Assignment CRUD ─────────────────────────────────────────────

interface CreateAssignmentInput {
  creator_id: string;
  campaign_id: string;
  rate_override_cents?: number | null;
  expected_posts?: number;
  due_date?: string | null;
  applied_multipliers?: string[];
  /**
   * `as_invite=true` (default) creates the row in `pending` so the
   * creator must explicitly Accept before anything counts. Setting
   * false skips the handshake (status='active' immediately) for the
   * "we already agreed offline" path.
   */
  as_invite?: boolean;
}

export async function createAssignment(input: CreateAssignmentInput): Promise<Result<{ id: string }>> {
  const auth = await assertRole("admin");
  if (!auth.ok) return auth;
  const sb = await createClient();
  // Default to the invite handshake — admins must opt OUT explicitly
  // when adding someone they've already onboarded by hand.
  const initialStatus = input.as_invite === false ? "active" : "pending";
  const { data, error } = await sb
    .from("assignments")
    .insert({
      creator_id: input.creator_id,
      campaign_id: input.campaign_id,
      rate_override_cents: input.rate_override_cents ?? null,
      expected_posts: input.expected_posts ?? 1,
      due_date: input.due_date ?? null,
      applied_multipliers: input.applied_multipliers ?? [],
      status: initialStatus,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    if (error?.code === "23505") {
      return { ok: false, error: "This creator is already assigned to this campaign." };
    }
    return { ok: false, error: error?.message ?? "Insert failed" };
  }
  // Trigger an immediate recompute so any already-tagged posts produce
  // a pending payout right away. (The next analytics refresh would do
  // it too, but ~6h feels slow.) Inline call is cheap.
  revalidatePath(`/campaigns/${input.campaign_id}/creators`);
  revalidatePath("/payouts");
  return { ok: true, data: { id: data.id } };
}

export async function updateAssignment(input: { id: string } & Partial<Assignment>): Promise<Result> {
  const auth = await assertRole("admin");
  if (!auth.ok) return auth;
  const sb = await createClient();
  const patch: Record<string, unknown> = {};
  for (const k of ["rate_override_cents", "expected_posts", "due_date", "applied_multipliers", "status", "contract_url"] as const) {
    if (k in input && input[k] !== undefined) patch[k] = input[k];
  }
  patch.updated_at = new Date().toISOString();
  if (input.status === "completed") patch.completed_at = new Date().toISOString();
  if (input.status === "accepted") patch.accepted_at = new Date().toISOString();
  const { error } = await sb.from("assignments").update(patch).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/payouts");
  return { ok: true };
}

// ─── Reassignment: hand remaining posts + accounts off to a new creator ─────
//
// When a creator leaves before completing their assigned post count,
// the operator hits Reassign on the campaign roster. We close the
// original creator's assignment cleanly (status='completed', cap
// expected_posts to what they actually delivered so their track
// record is intact) and open a fresh assignment for the replacement
// creator with the REMAINING posts as the new target.
//
// We also move the TikTok account ownership for accounts attached
// to THIS campaign — the new creator can't actually take over the
// workload otherwise (auto-attribution routes by owned_account_ids).
// Accounts on OTHER campaigns owned by the old creator are untouched.
//
// What stays with the original creator:
//   - All posts they already had tagged (posts.assignment_id still
//     points at the old, now-completed assignment).
//   - All payouts already on the books (pending/approved/paid all
//     remain attached to that assignment_id).
//   - Account ownership for accounts on OTHER campaigns.
//
// What flows to the new creator:
//   - The remaining-posts target (campaign_default × multipliers).
//   - Ownership of every account whose campaign_id matches this
//     campaign and that the old creator owned (transferred verbatim).
//   - Future posts on those handles auto-attribute to them via
//     owned_account_ids, so analytics + payouts naturally start fresh.
//
// Side-effects:
//   - Any pending creator_account_requests the old creator had open
//     for this campaign are auto-cancelled (status='rejected' with a
//     reason). The new creator can request fresh ones if needed.
//
// Hard guard: if the old creator has zero accounts on this campaign,
// we refuse to reassign — the operator should attach at least one
// account first (otherwise "reassign" is a no-op from the pipeline's
// perspective and the new creator can't actually post anything).

interface NewCreatorInline {
  /**
   * Inline "invite a new creator at reassign time" payload. The
   * action creates the creators row before opening the assignment,
   * so the operator doesn't have to leave the modal. Defaults
   * mirror createCreator: ugc + manual processor.
   */
  legal_name: string;
  display_name?: string | null;
  email: string;
  country?: string | null;
  kind?: "ugc" | "team_member";
}

interface ReassignInput {
  oldAssignmentId: string;
  /** Existing creator id — mutually exclusive with newCreator. */
  newCreatorId?: string;
  /** Inline create-and-assign — mutually exclusive with newCreatorId. */
  newCreator?: NewCreatorInline;
  /**
   * Expected post count for the NEW creator's assignment. The dialog
   * defaults this to max(remaining, 1) but lets the operator edit it
   * before submit. We require it explicitly so the over-delivery case
   * (277 delivered out of 3 expected → remaining = 0) is handled:
   * the operator states what the new target is rather than us
   * silently picking 0 or refusing.
   */
  expectedPosts: number;
}

export async function reassignAssignment(input: ReassignInput): Promise<Result<{ newAssignmentId: string; remaining: number; expectedPosts: number; createdCreatorId?: string; accountsMoved: number; merged: boolean }>> {
  const auth = await assertRole("admin");
  if (!auth.ok) return auth;
  const sb = await createClient();

  // Exactly one of newCreatorId / newCreator must be present.
  const hasId = !!input.newCreatorId;
  const hasInline = !!input.newCreator;
  if (hasId === hasInline) {
    return {
      ok: false,
      error: "Provide either an existing creator id or new-creator details — not both, not neither.",
    };
  }

  // Resolve to a concrete newCreatorId. When the operator chose
  // "invite new" we create the creators row first; from then on the
  // flow is identical to the existing-creator path.
  let newCreatorId: string;
  let createdCreatorId: string | undefined;
  if (input.newCreator) {
    const legal = stripAtSign(input.newCreator.legal_name);
    if (!legal) return { ok: false, error: "New creator: legal name is required." };
    if (!input.newCreator.email?.trim()) return { ok: false, error: "New creator: email is required." };
    const { data: created, error: createErr } = await sb
      .from("creators")
      .insert({
        legal_name: legal,
        display_name: stripAtSign(input.newCreator.display_name ?? null),
        email: input.newCreator.email.trim().toLowerCase(),
        country: input.newCreator.country?.trim() || null,
        kind: input.newCreator.kind ?? "ugc",
        preferred_processor: "manual",
        owned_account_ids: [],
      })
      .select("id")
      .single<{ id: string }>();
    if (createErr || !created) {
      return { ok: false, error: `Failed to create new creator: ${createErr?.message ?? "unknown"}` };
    }
    newCreatorId = created.id;
    createdCreatorId = created.id;
  } else {
    newCreatorId = input.newCreatorId!;
  }

  // Read the old assignment + its delivered-posts count in parallel.
  const [oldRes, postCountRes] = await Promise.all([
    sb.from("assignments")
      .select("id, creator_id, campaign_id, expected_posts, rate_override_cents, applied_multipliers, status")
      .eq("id", input.oldAssignmentId)
      .maybeSingle<{
        id: string;
        creator_id: string;
        campaign_id: string;
        expected_posts: number;
        rate_override_cents: number | null;
        applied_multipliers: string[];
        status: string;
      }>(),
    sb.from("posts")
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", input.oldAssignmentId),
  ]);

  const old = oldRes.data;
  if (!old) return { ok: false, error: "Original assignment not found" };

  if (old.creator_id === newCreatorId) {
    return { ok: false, error: "Pick a different creator — you can't reassign to the same person." };
  }

  // Guard: the new creator must already be in the directory and
  // onboarded/invited (no resurrecting archived rows by reassigning).
  const { data: newCreator } = await sb
    .from("creators")
    .select("id, status")
    .eq("id", newCreatorId)
    .maybeSingle<{ id: string; status: string }>();
  if (!newCreator) return { ok: false, error: "New creator not found" };
  if (newCreator.status === "archived") {
    return { ok: false, error: "Cannot reassign to an archived creator." };
  }

  // Look up whether the new creator already has an assignment on this
  // campaign. If yes, we take the MERGE path — close the old creator's
  // assignment and bump the existing assignment's expected_posts target
  // by the operator-supplied amount. If no, we take the original NEW
  // path — create a fresh assignment row. Either way, account ownership
  // is moved the same way (Step 3 below).
  //
  // The unique(creator_id, campaign_id) index means we can't have two
  // assignments for the same creator-campaign pair, which is why merge
  // is the only sensible behaviour when picking an on-campaign creator.
  const { data: existingAssignment } = await sb
    .from("assignments")
    .select("id, status, expected_posts")
    .eq("creator_id", newCreatorId)
    .eq("campaign_id", old.campaign_id)
    .maybeSingle<{ id: string; status: string; expected_posts: number }>();
  const mergeMode = !!existingAssignment;
  if (mergeMode && existingAssignment!.status === "completed") {
    // Re-opening a completed assignment is a different operation
    // (probably a mistake) — block it explicitly so we don't silently
    // resurrect old work.
    return {
      ok: false,
      error:
        `That creator's previous assignment on this campaign is marked completed. ` +
        `Pick a different creator, or unarchive the assignment first.`,
    };
  }

  const delivered = postCountRes.count ?? 0;
  const remaining = Math.max(0, old.expected_posts - delivered);

  // Reassignment is about handing off the campaign role (accounts +
  // ongoing responsibility), not just leftover work. So we don't gate
  // on remaining > 0 — even an over-delivered or fully-delivered
  // creator who's leaving needs reassignment. The operator tells us
  // the new target via input.expectedPosts.
  if (!Number.isInteger(input.expectedPosts) || input.expectedPosts < 1) {
    return {
      ok: false,
      error: "New assignment needs an expected-posts target of at least 1.",
    };
  }
  const newExpectedPosts = input.expectedPosts;

  // Pre-compute which accounts move with this reassignment.
  //
  // Rule: an account moves iff its campaign_id matches the assignment's
  // campaign AND it's in the old creator's owned_account_ids array.
  // This scopes the move to "the accounts the old creator was using
  // for THIS campaign" — accounts they own on other campaigns are
  // untouched.
  //
  // We also load the old + new creator's current owned_account_ids so
  // we can splice (remove from old, append-dedupe on new) in a single
  // pass below without an extra round-trip.
  const [oldCreatorRes, newCreatorRowRes] = await Promise.all([
    sb.from("creators")
      .select("owned_account_ids")
      .eq("id", old.creator_id)
      .maybeSingle<{ owned_account_ids: string[] | null }>(),
    sb.from("creators")
      .select("owned_account_ids")
      .eq("id", newCreatorId)
      .maybeSingle<{ owned_account_ids: string[] | null }>(),
  ]);

  const oldOwned = oldCreatorRes.data?.owned_account_ids ?? [];
  const newOwned = newCreatorRowRes.data?.owned_account_ids ?? [];

  // Intersect old creator's accounts with this campaign's accounts.
  // If the intersection is empty we refuse — see the doc-block above.
  const campaignAccountsRes = oldOwned.length === 0
    ? { data: [] as Array<{ id: string }> }
    : await sb
        .from("accounts")
        .select("id")
        .eq("campaign_id", old.campaign_id)
        .in("id", oldOwned)
        .returns<Array<{ id: string }>>();

  const accountsToMove = (campaignAccountsRes.data ?? []).map((a) => a.id);

  // Gate the zero-accounts case differently per mode:
  //   - new-assignment mode: refusing makes sense — spinning up a
  //     fresh assignment with literally nothing to work on is a
  //     pointless row.
  //   - merge mode: 0 accounts is fine. The operator is saying
  //     "this creator is leaving, absorb their commitment into an
  //     existing campaign-mate" — that's a legitimate close-out even
  //     when no account ownership actually moves.
  if (accountsToMove.length === 0 && !mergeMode) {
    return {
      ok: false,
      error:
        "Can't reassign — the original creator has no accounts attached to this campaign. " +
        "Attach at least one account to them first, or assign the new creator directly via Assign creator.",
    };
  }

  // 1. Close the old assignment. Cap expected_posts to delivered so
  //    the original creator's record reads as "delivered N of N"
  //    instead of the misleading "delivered 4 of 10" forever.
  const nowIso = new Date().toISOString();
  const { error: closeErr } = await sb
    .from("assignments")
    .update({
      status: "completed",
      expected_posts: delivered,
      completed_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", old.id);
  if (closeErr) return { ok: false, error: `Failed closing original assignment: ${closeErr.message}` };

  // 2. Land the new assignment.
  //
  //    NEW mode  → insert a fresh assignments row for the new creator
  //                with the operator-supplied target.
  //    MERGE mode → bump the existing assignment's expected_posts by
  //                 input.expectedPosts (additive — the operator is
  //                 saying "they need to deliver this many MORE posts
  //                 to absorb the leaving creator's work"). We don't
  //                 touch rate_override or multipliers because the
  //                 existing assignment already has the operator's
  //                 chosen deal for that creator.
  let newAssignmentId: string;
  let resultingExpectedPosts: number;
  if (mergeMode) {
    resultingExpectedPosts = existingAssignment!.expected_posts + newExpectedPosts;
    const { error: mergeErr } = await sb
      .from("assignments")
      .update({
        expected_posts: resultingExpectedPosts,
        // If the assignment was paused/declined and the operator's
        // picking them now, reactivate it. Active/accepted stay as-is.
        status: existingAssignment!.status === "active" || existingAssignment!.status === "accepted"
          ? existingAssignment!.status
          : "active",
        updated_at: nowIso,
      })
      .eq("id", existingAssignment!.id);
    if (mergeErr) {
      // Roll back the old-assignment close so the operator can retry.
      await sb
        .from("assignments")
        .update({ status: old.status, expected_posts: old.expected_posts, completed_at: null })
        .eq("id", old.id);
      return { ok: false, error: `Failed merging into existing assignment: ${mergeErr.message}` };
    }
    newAssignmentId = existingAssignment!.id;
  } else {
    const { data: newAssignment, error: createErr } = await sb
      .from("assignments")
      .insert({
        creator_id: newCreatorId,
        campaign_id: old.campaign_id,
        rate_override_cents: old.rate_override_cents,
        expected_posts: newExpectedPosts,
        applied_multipliers: old.applied_multipliers ?? [],
        status: "active",
      })
      .select("id")
      .single<{ id: string }>();

    if (createErr || !newAssignment) {
      // Best-effort rollback: re-open the old assignment so the operator
      // isn't left with a half-finished reassignment.
      await sb
        .from("assignments")
        .update({ status: old.status, expected_posts: old.expected_posts, completed_at: null })
        .eq("id", old.id);
      return { ok: false, error: `Failed creating new assignment: ${createErr?.message ?? "unknown"}` };
    }
    newAssignmentId = newAssignment.id;
    resultingExpectedPosts = newExpectedPosts;
  }

  // 3. Move account ownership: strip campaign-scoped account ids out
  //    of the old creator's array, append them to the new creator's
  //    array (deduped). Two updates because owned_account_ids lives on
  //    the creators row, not on the assignment.
  const moveSet = new Set(accountsToMove);
  const oldNext = oldOwned.filter((id) => !moveSet.has(id));
  const newNext = Array.from(new Set([...newOwned, ...accountsToMove]));

  const moveOldErr = (await sb
    .from("creators")
    .update({ owned_account_ids: oldNext, updated_at: nowIso })
    .eq("id", old.creator_id)).error;

  const moveNewErr = moveOldErr
    ? null
    : (await sb
        .from("creators")
        .update({ owned_account_ids: newNext, updated_at: nowIso })
        .eq("id", newCreatorId)).error;

  if (moveOldErr || moveNewErr) {
    // Rollback any partial creator-row updates so the operator can
    // retry from a consistent state. Only delete the new assignment
    // row when we INSERTED it — in merge mode the assignment already
    // existed and just got its target bumped, so we restore the prior
    // expected_posts instead of deleting.
    await sb
      .from("creators")
      .update({ owned_account_ids: oldOwned, updated_at: nowIso })
      .eq("id", old.creator_id);
    await sb
      .from("creators")
      .update({ owned_account_ids: newOwned, updated_at: nowIso })
      .eq("id", newCreatorId);
    if (mergeMode) {
      await sb
        .from("assignments")
        .update({ expected_posts: existingAssignment!.expected_posts, updated_at: nowIso })
        .eq("id", newAssignmentId);
    } else {
      await sb
        .from("assignments")
        .delete()
        .eq("id", newAssignmentId);
    }
    await sb
      .from("assignments")
      .update({ status: old.status, expected_posts: old.expected_posts, completed_at: null })
      .eq("id", old.id);
    return {
      ok: false,
      error: `Failed moving account ownership: ${(moveOldErr ?? moveNewErr)?.message ?? "unknown"}`,
    };
  }

  // 4. Cancel any pending account requests the old creator had open
  //    on this campaign — they're stale now. Use 'rejected' with a
  //    clear reason so the audit trail is honest. Non-critical: a
  //    failure here doesn't roll back the rest.
  await sb
    .from("creator_account_requests")
    .update({
      status: "rejected",
      reviewed_at: nowIso,
      rejection_reason: "Auto-cancelled: original creator was reassigned off this campaign.",
    })
    .eq("creator_id", old.creator_id)
    .eq("campaign_id", old.campaign_id)
    .eq("status", "pending");

  revalidatePath(`/campaigns`);
  revalidatePath(`/creators/${old.creator_id}`);
  revalidatePath(`/creators/${newCreatorId}`);
  revalidatePath(`/creators`);
  revalidatePath(`/payouts`);
  revalidatePath(`/accounts`);

  return {
    ok: true,
    data: {
      newAssignmentId,
      remaining,
      expectedPosts: resultingExpectedPosts,
      createdCreatorId,
      accountsMoved: accountsToMove.length,
      merged: mergeMode,
    },
  };
}

// ─── Creator-side: payment info (UPI ID + screenshot) ────────────
//
// Creators upload a screenshot of their PhonePe/GPay to the storage
// bucket directly from the browser (RLS scopes them to their own
// folder). After the upload, this action records the storage path
// onto their `creators` row so the admin can render it. The action
// is creator-only — admins can't impersonate, can't typo into another
// creator's row. UPI ID is freeform text; we trim and lowercase
// whitespace but otherwise trust the creator's input.

export async function updateMyPaymentInfo(input: {
  upi_id?: string | null;
  screenshot_path?: string | null;
  cleared_screenshot?: boolean;
}): Promise<Result> {
  const auth = await assertCreator();
  if (!auth.ok) return auth;
  const sb = await createClient();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (input.upi_id !== undefined) {
    const trimmed = input.upi_id?.trim() ?? "";
    patch.payment_upi_id = trimmed === "" ? null : trimmed;
  }

  if (input.screenshot_path !== undefined) {
    // Defense: only allow paths the calling creator owns. The storage
    // RLS policy already enforces this at upload time, but a malicious
    // client could still try to record someone else's storage path.
    if (input.screenshot_path && !input.screenshot_path.startsWith(`${auth.creator.id}/`)) {
      return { ok: false, error: "Invalid screenshot path." };
    }
    patch.payment_screenshot_path = input.screenshot_path;
    patch.payment_screenshot_uploaded_at = input.screenshot_path ? new Date().toISOString() : null;
  }

  if (input.cleared_screenshot) {
    patch.payment_screenshot_path = null;
    patch.payment_screenshot_uploaded_at = null;
  }

  const { error } = await sb
    .from("creators")
    .update(patch)
    .eq("id", auth.creator.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/creator");
  revalidatePath(`/creators/${auth.creator.id}`);
  revalidatePath("/payouts");
  return { ok: true };
}

// ─── Creator-side: request a new account on a campaign ──────────
//
// The creator says "I own @maya_studies on TikTok; I want to use it
// on the MinuteWise campaign." We file a row in
// creator_account_requests with status='pending'. The admin reviews
// it on /accounts, sets up the Blotato side, and approves — which
// creates the real accounts row + links it to the creator's
// owned_account_ids so the runner auto-attributes posts.

interface RequestAccountInput {
  handle: string;
  display_name?: string | null;
  campaign_id?: string | null;
  notes?: string | null;
  /**
   * Email or phone the creator uses to log into TikTok. Often
   * different from the @handle — TikTok login accepts either, and
   * Blotato needs whichever the creator actually uses. Required.
   */
  login_identifier: string;
  /**
   * The creator's TikTok password in plaintext, sent over HTTPS.
   * Encrypted at-rest with AES-256-GCM via credential-vault before
   * insert. Auto-wiped on approve/reject and after 7 days. Required.
   */
  password: string;
}

export async function requestCreatorAccount(input: RequestAccountInput): Promise<Result<{ requestId: string }>> {
  const auth = await assertCreator();
  if (!auth.ok) return auth;
  const sb = await createClient();

  // Normalise the handle: strip leading @, lowercase, trim. Reject
  // empty after that — handles like "  @" should fail visibly.
  const handle = input.handle.trim().replace(/^@+/, "").toLowerCase();
  if (!handle) return { ok: false, error: "Handle is required (e.g. maya_studies)." };
  if (!/^[a-z0-9._-]{2,40}$/.test(handle)) {
    return { ok: false, error: "Handle must be 2–40 chars of letters, digits, ., _, or -." };
  }

  // Credential validation. Keep the rules light — TikTok itself
  // dictates real validity. We only guard against obvious empties
  // and runaway sizes that would balloon the DB column.
  const loginId = input.login_identifier?.trim() ?? "";
  if (!loginId) {
    return { ok: false, error: "Enter the email or phone you use to log into TikTok." };
  }
  if (loginId.length > 320) {
    return { ok: false, error: "Login email/phone is unreasonably long." };
  }
  const password = input.password ?? "";
  if (!password) {
    return { ok: false, error: "Enter your TikTok password so your admin can finish setup." };
  }
  if (password.length > 256) {
    return { ok: false, error: "Password is unreasonably long (max 256 chars)." };
  }

  // Guard against duplicate submissions: same creator + same handle
  // with a pending request is a dupe.
  const { data: existingPending } = await sb
    .from("creator_account_requests")
    .select("id")
    .eq("creator_id", auth.creator.id)
    .eq("handle", handle)
    .eq("status", "pending")
    .maybeSingle<{ id: string }>();
  if (existingPending) {
    return { ok: false, error: "You already have a pending request for that handle." };
  }

  // Also guard against requesting a handle that's already a managed
  // account — admin would just need to add the creator as an owner
  // of the existing account, not create a new one.
  const { data: existingAccount } = await sb
    .from("accounts")
    .select("id, handle")
    .eq("handle", handle)
    .maybeSingle<{ id: string; handle: string }>();
  if (existingAccount) {
    return {
      ok: false,
      error: `@${handle} is already a managed account. Ask your admin to link you as an owner instead.`,
    };
  }

  // Encrypt the password right before insert. If env isn't configured
  // we fail loudly here rather than silently storing plaintext — the
  // vault throws on missing CREDENTIAL_VAULT_KEY.
  let passwordCipher: string;
  try {
    passwordCipher = encryptSecret(password);
  } catch (e) {
    return {
      ok: false,
      error:
        "Server isn't configured to accept passwords right now. " +
        "Tell your admin the credential vault key is missing.",
    };
  }

  const { data, error } = await sb
    .from("creator_account_requests")
    .insert({
      creator_id: auth.creator.id,
      campaign_id: input.campaign_id || null,
      handle,
      display_name: input.display_name?.trim() || null,
      notes: input.notes?.trim() || null,
      login_identifier: loginId,
      password_encrypted: passwordCipher,
      password_set_at: new Date().toISOString(),
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Insert failed" };
  }

  revalidatePath("/creator");
  revalidatePath("/accounts");
  return { ok: true, data: { requestId: data.id } };
}

// ─── Admin-side: approve / reject an account request ──────────

interface ApproveRequestInput {
  requestId: string;
  /**
   * The real Blotato account id — pasted by the admin after they've
   * configured the connection in my.blotato.com. Becomes
   * accounts.id (text). Required because the cycle pipeline uses
   * this id to know which Blotato connection to post via.
   */
  blotato_id: string;
  /** Display name shown in /accounts. Defaults to @handle. */
  display_name?: string | null;
  /** Override which campaign to attach to (default: whichever the creator picked). */
  campaign_id?: string | null;
}

export async function approveCreatorAccountRequest(
  input: ApproveRequestInput,
): Promise<Result<{ accountId: string }>> {
  const auth = await assertRole("admin");
  if (!auth.ok) return auth;
  const sb = await createClient();

  if (!input.blotato_id.trim()) {
    return { ok: false, error: "Blotato ID is required to approve a request." };
  }
  const blotatoId = input.blotato_id.trim();

  const { data: req } = await sb
    .from("creator_account_requests")
    .select("id, creator_id, campaign_id, handle, status")
    .eq("id", input.requestId)
    .maybeSingle<{
      id: string;
      creator_id: string;
      campaign_id: string | null;
      handle: string;
      status: string;
    }>();
  if (!req) return { ok: false, error: "Request not found" };
  if (req.status !== "pending") {
    return { ok: false, error: `Request is already ${req.status}.` };
  }

  // Guard: Blotato id must not already exist in accounts. Stops the
  // admin from accidentally pasting an existing account's id.
  const { data: collision } = await sb
    .from("accounts")
    .select("id, handle")
    .eq("id", blotatoId)
    .maybeSingle<{ id: string; handle: string }>();
  if (collision) {
    return {
      ok: false,
      error: `Blotato id ${blotatoId} already belongs to @${collision.handle}. Use a different one.`,
    };
  }

  const targetCampaignId = input.campaign_id ?? req.campaign_id ?? null;
  const displayName = input.display_name?.trim() || `@${req.handle}`;

  // 1. Create the accounts row. Mark active so the cycle picks it up
  //    immediately; admin can still toggle off from /accounts.
  const { error: insErr } = await sb
    .from("accounts")
    .insert({
      id: blotatoId,
      handle: req.handle,
      name: displayName,
      active: true,
      campaign_id: targetCampaignId,
    });
  if (insErr) return { ok: false, error: `accounts insert: ${insErr.message}` };

  // 2. Append the new account id to the requesting creator's
  //    owned_account_ids so auto-attribution kicks in for future posts.
  const { data: creatorRow } = await sb
    .from("creators")
    .select("owned_account_ids")
    .eq("id", req.creator_id)
    .maybeSingle<{ owned_account_ids: string[] }>();
  const currentOwned = creatorRow?.owned_account_ids ?? [];
  const nextOwned = currentOwned.includes(blotatoId) ? currentOwned : [...currentOwned, blotatoId];
  await sb.from("creators")
    .update({ owned_account_ids: nextOwned, updated_at: new Date().toISOString() })
    .eq("id", req.creator_id);

  // 3. Mark the request approved + stamp who approved. NULL the
  //    encrypted password the moment we approve — the admin has
  //    already used it to set up Blotato, so the row no longer
  //    needs to hold the secret. Belt-and-suspenders with the
  //    7-day TTL sweep.
  await sb.from("creator_account_requests")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
      reviewed_by: auth.user.id,
      approved_account_id: blotatoId,
      password_encrypted: null,
      password_set_at: null,
    })
    .eq("id", input.requestId);

  revalidatePath("/accounts");
  revalidatePath("/creators");
  revalidatePath(`/creators/${req.creator_id}`);
  revalidatePath("/creator");
  return { ok: true, data: { accountId: blotatoId } };
}

export async function rejectCreatorAccountRequest(input: {
  requestId: string;
  reason?: string;
}): Promise<Result> {
  const auth = await assertRole("admin");
  if (!auth.ok) return auth;
  const sb = await createClient();

  const { data: req } = await sb
    .from("creator_account_requests")
    .select("id, creator_id, status")
    .eq("id", input.requestId)
    .maybeSingle<{ id: string; creator_id: string; status: string }>();
  if (!req) return { ok: false, error: "Request not found" };
  if (req.status !== "pending") {
    return { ok: false, error: `Request is already ${req.status}.` };
  }

  const { error } = await sb.from("creator_account_requests")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      reviewed_by: auth.user.id,
      rejection_reason: input.reason?.trim() || null,
      // Rejected requests don't need the stored credentials either —
      // wipe immediately. If the creator wants to retry they'll
      // submit fresh ones.
      password_encrypted: null,
      password_set_at: null,
    })
    .eq("id", input.requestId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/accounts");
  revalidatePath(`/creators/${req.creator_id}`);
  revalidatePath("/creator");
  return { ok: true };
}

/**
 * Admin-only: decrypt and return the stored TikTok password for a
 * given pending request. Intentionally narrow:
 *   - Requires role=admin (assertRole). A creator hitting this for
 *     their own row is blocked — only admins doing the Blotato
 *     setup need the plaintext.
 *   - Only works while the request is still 'pending'. Once
 *     approved/rejected the row's password_encrypted is NULL.
 *   - Returns plaintext in the action result. Caller (admin UI)
 *     is responsible for not echoing it to logs / aria-live /
 *     anywhere it can leak.
 *
 * Throws-on-decrypt are translated to a clean error string so the
 * UI can surface "couldn't decrypt — vault key rotated?" without
 * crashing the whole page.
 */
export async function revealAccountRequestPassword(input: {
  requestId: string;
}): Promise<Result<{ login_identifier: string | null; password: string }>> {
  const auth = await assertRole("admin");
  if (!auth.ok) return auth;
  const sb = await createClient();

  const { data: row } = await sb
    .from("creator_account_requests")
    .select("id, status, login_identifier, password_encrypted, password_set_at")
    .eq("id", input.requestId)
    .maybeSingle<{
      id: string;
      status: string;
      login_identifier: string | null;
      password_encrypted: string | null;
      password_set_at: string | null;
    }>();
  if (!row) return { ok: false, error: "Request not found." };
  if (row.status !== "pending") {
    return {
      ok: false,
      error: `Request is already ${row.status} — password was wiped on action.`,
    };
  }
  if (!row.password_encrypted) {
    return {
      ok: false,
      error:
        "No password on file. The creator may not have included one, " +
        "or it was auto-wiped by the 7-day TTL — ask them to resubmit.",
    };
  }

  let password: string;
  try {
    password = decryptSecret(row.password_encrypted);
  } catch {
    return {
      ok: false,
      error:
        "Stored password could not be decrypted. The vault key may " +
        "have rotated since submission — ask the creator to resubmit.",
    };
  }

  return {
    ok: true,
    data: { login_identifier: row.login_identifier, password },
  };
}

// ─── Creator-side: accept / decline an invite ────────────────────
//
// These two actions are the only writes the creator portal can make.
// Both require role='creator' (assertCreator), require the assignment
// to belong to the calling creator, and require status='pending'.
// Anything else returns a clean error — defense-in-depth in case the
// UI ever ships a stale cached row.

/**
 * Creator accepts a pending invite. Flips status to 'active' and
 * stamps accepted_at. The next analytics tick (or `npm run
 * payouts:recompute`) starts producing pending payouts for posts
 * already on this campaign.
 */
export async function acceptAssignment(input: { id: string }): Promise<Result> {
  const auth = await assertCreator();
  if (!auth.ok) return auth;
  const sb = await createClient();

  const { data: assignment, error: readErr } = await sb
    .from("assignments")
    .select("id, creator_id, status")
    .eq("id", input.id)
    .maybeSingle<{ id: string; creator_id: string; status: string }>();
  if (readErr || !assignment) return { ok: false, error: readErr?.message ?? "Assignment not found" };
  if (assignment.creator_id !== auth.creator.id) {
    return { ok: false, error: "This invite isn't yours." };
  }
  if (assignment.status !== "pending") {
    return { ok: false, error: `Cannot accept — already ${assignment.status}.` };
  }

  const { error } = await sb
    .from("assignments")
    .update({
      status: "active",
      accepted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq("status", "pending");          // belt-and-braces race guard
  if (error) return { ok: false, error: error.message };

  revalidatePath("/creator");
  revalidatePath("/payouts");
  return { ok: true };
}

/**
 * Creator declines a pending invite. Flips status to 'rejected' —
 * terminal state, the admin would create a fresh assignment to
 * re-invite (intentional friction so a declined creator isn't
 * silently re-added).
 */
export async function declineAssignment(input: { id: string }): Promise<Result> {
  const auth = await assertCreator();
  if (!auth.ok) return auth;
  const sb = await createClient();

  const { data: assignment, error: readErr } = await sb
    .from("assignments")
    .select("id, creator_id, status")
    .eq("id", input.id)
    .maybeSingle<{ id: string; creator_id: string; status: string }>();
  if (readErr || !assignment) return { ok: false, error: readErr?.message ?? "Assignment not found" };
  if (assignment.creator_id !== auth.creator.id) {
    return { ok: false, error: "This invite isn't yours." };
  }
  if (assignment.status !== "pending") {
    return { ok: false, error: `Cannot decline — already ${assignment.status}.` };
  }

  const { error } = await sb
    .from("assignments")
    .update({
      status: "rejected",
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq("status", "pending");
  if (error) return { ok: false, error: error.message };

  revalidatePath("/creator");
  revalidatePath("/payouts");
  return { ok: true };
}

// ─── Campaign payout config ──────────────────────────────────────

interface UpsertConfigInput {
  campaign_id: string;
  mode: PayoutMode;
  flat_per_post_cents?: number | null;
  cpm_cents?: number | null;
  cpm_view_window_days?: number;
  hybrid_threshold_views?: number | null;
  milestones?: Array<{ views: number; bonus_cents: number }>;
  multipliers?: Multiplier[];
  total_budget_cents?: number | null;
  currency?: string;
  approval_required?: boolean;
  instant_payout?: boolean;
}

export async function upsertCampaignPayoutConfig(input: UpsertConfigInput): Promise<Result> {
  const auth = await assertRole("admin");
  if (!auth.ok) return auth;
  const sb = await createClient();
  // Validate by mode — refuse to save half-configured rate cards so
  // the calculator never has to guess what the operator meant.
  if (input.mode === "flat" || input.mode === "hybrid") {
    if (!input.flat_per_post_cents || input.flat_per_post_cents <= 0) {
      return { ok: false, error: "Flat-per-post rate is required for flat / hybrid mode." };
    }
  }
  if (input.mode === "cpm" || input.mode === "hybrid") {
    if (!input.cpm_cents || input.cpm_cents <= 0) {
      return { ok: false, error: "CPM rate is required for cpm / hybrid mode." };
    }
  }
  if (input.mode === "hybrid" && !input.hybrid_threshold_views) {
    return { ok: false, error: "Hybrid threshold views is required for hybrid mode." };
  }
  if (input.mode === "milestone" && (!input.milestones || input.milestones.length === 0)) {
    return { ok: false, error: "At least one milestone tier is required for milestone mode." };
  }

  const row: Record<string, unknown> = {
    campaign_id: input.campaign_id,
    mode: input.mode,
    flat_per_post_cents: input.flat_per_post_cents ?? null,
    cpm_cents: input.cpm_cents ?? null,
    cpm_view_window_days: input.cpm_view_window_days ?? 14,
    hybrid_threshold_views: input.hybrid_threshold_views ?? null,
    milestones: input.milestones ?? [],
    multipliers: input.multipliers ?? [],
    total_budget_cents: input.total_budget_cents ?? null,
    currency: input.currency ?? "USD",
    approval_required: input.approval_required ?? true,
    instant_payout: input.instant_payout ?? false,
    updated_at: new Date().toISOString(),
  };

  const { error } = await sb.from("campaign_payout_configs").upsert(row, { onConflict: "campaign_id" });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/campaigns`);
  revalidatePath("/payouts");
  return { ok: true };
}

// ─── Payout state transitions (the LEDGER-writing actions) ───────

/**
 * Approve a pending payout. Writes one balanced ledger transaction:
 *   DR expense:campaigns:payouts (we recognise the cost)
 *   CR liability:creators:unpaid (we now owe the creator)
 * Idempotent via idempotency_key='payout:<id>:approve'.
 *
 * After approval, the calculator no longer touches this payout's
 * amount — it's frozen. New eligible posts produce a fresh `pending`
 * payout for the same assignment on the next runner tick.
 */
export async function approvePayout(input: { id: string }): Promise<Result> {
  const auth = await assertRole("admin");
  if (!auth.ok) return auth;
  const user = auth.user;
  const sb = await createClient();

  // Re-read the payout server-side to guard against stale UI state.
  const { data: payout, error: readErr } = await sb
    .from("payouts")
    .select("id, status, amount_cents, currency, campaign_id, creator_id")
    .eq("id", input.id)
    .maybeSingle<{
      id: string; status: string; amount_cents: number; currency: string;
      campaign_id: string; creator_id: string;
    }>();
  if (readErr || !payout) return { ok: false, error: readErr?.message ?? "Payout not found" };
  if (payout.status !== "pending") {
    return { ok: false, error: `Cannot approve a payout in status "${payout.status}".` };
  }
  if (payout.amount_cents <= 0) {
    return { ok: false, error: "Cannot approve a $0 payout." };
  }

  // Resolve / lazily-create the two ledger accounts this txn touches.
  const expenseCode = `expense:campaign:${payout.campaign_id}:payouts`;
  const liabilityCode = `liability:creator:${payout.creator_id}:unpaid`;
  const expenseAccountId = await ensureAccount(sb, expenseCode, "expense", `Campaign payouts (${payout.campaign_id.slice(0,8)}…)`);
  const liabilityAccountId = await ensureAccount(sb, liabilityCode, "liability", `Owed to creator ${payout.creator_id.slice(0,8)}…`);
  if (!expenseAccountId || !liabilityAccountId) {
    return { ok: false, error: "Could not resolve ledger accounts." };
  }

  // Insert the transaction header + the two balanced entries.
  // Idempotency key: if the operator double-clicks Approve, the
  // second insert collides on idempotency_key and Postgres rejects
  // it — we catch that and report success (it WAS approved).
  const idempotencyKey = `payout:${payout.id}:approve`;
  const { data: txn, error: txnErr } = await sb
    .from("ledger_transactions")
    .insert({
      description: `Approve payout ${payout.id.slice(0,8)}… ($${(payout.amount_cents/100).toFixed(2)})`,
      idempotency_key: idempotencyKey,
      metadata: { payout_id: payout.id, action: "approve" },
    })
    .select("id")
    .single<{ id: string }>();

  if (txnErr) {
    if (txnErr.code === "23505") {
      // Already approved — idempotent success.
      revalidatePath("/payouts");
      return { ok: true };
    }
    return { ok: false, error: txnErr.message };
  }

  // Explicitly set BOTH debit_cents and credit_cents on every entry.
  // The columns have NOT NULL DEFAULT 0 but Supabase JS sends the
  // missing property as null (not undefined), which bypasses the
  // default and trips the NOT NULL constraint. Setting the
  // not-this-side to 0 explicitly is the only reliable pattern.
  const { error: entriesErr } = await sb.from("ledger_entries").insert([
    { transaction_id: txn.id, account_id: expenseAccountId, debit_cents: payout.amount_cents, credit_cents: 0 },
    { transaction_id: txn.id, account_id: liabilityAccountId, debit_cents: 0, credit_cents: payout.amount_cents },
  ]);
  if (entriesErr) {
    // The deferred double-entry trigger will catch unbalanced rows
    // at COMMIT and throw — which Postgres surfaces here. Caller
    // sees the error and the txn is rolled back.
    return { ok: false, error: `Ledger write failed: ${entriesErr.message}` };
  }

  // Flip the payout status. Errors here are recoverable — the ledger
  // write succeeded, so a retry will idempotency-skip the ledger
  // and re-flip the status.
  const { error: updateErr } = await sb
    .from("payouts")
    .update({
      status: "approved",
      approval_ledger_txn_id: txn.id,
      approved_at: new Date().toISOString(),
      approved_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payout.id);
  if (updateErr) return { ok: false, error: updateErr.message };

  revalidatePath("/payouts");
  revalidatePath(`/creators/${payout.creator_id}`);
  return { ok: true };
}

/**
 * Mark an approved payout as paid (externally — no money movement
 * happens here, the operator initiated the transfer themselves).
 * Writes the second balanced ledger transaction:
 *   DR liability:creators:unpaid (we no longer owe)
 *   CR liability:creators:paid_externally (settled)
 */
export async function markPayoutPaid(input: { id: string; reference?: string }): Promise<Result> {
  const auth = await assertRole("admin");
  if (!auth.ok) return auth;
  const sb = await createClient();
  const { data: payout, error: readErr } = await sb
    .from("payouts")
    .select("id, status, amount_cents, creator_id")
    .eq("id", input.id)
    .maybeSingle<{ id: string; status: string; amount_cents: number; creator_id: string }>();
  if (readErr || !payout) return { ok: false, error: readErr?.message ?? "Payout not found" };
  if (payout.status !== "approved") {
    return { ok: false, error: `Cannot mark paid from status "${payout.status}".` };
  }

  const liabilityUnpaid = `liability:creator:${payout.creator_id}:unpaid`;
  const liabilityPaid = `liability:creator:${payout.creator_id}:paid_externally`;
  const unpaidId = await ensureAccount(sb, liabilityUnpaid, "liability", `Owed to creator ${payout.creator_id.slice(0,8)}…`);
  const paidId = await ensureAccount(sb, liabilityPaid, "liability", `Paid externally to ${payout.creator_id.slice(0,8)}…`);
  if (!unpaidId || !paidId) return { ok: false, error: "Could not resolve ledger accounts." };

  const idempotencyKey = `payout:${payout.id}:pay`;
  const { data: txn, error: txnErr } = await sb
    .from("ledger_transactions")
    .insert({
      description: `Mark paid payout ${payout.id.slice(0,8)}… ($${(payout.amount_cents/100).toFixed(2)})`,
      idempotency_key: idempotencyKey,
      external_ref: input.reference ?? null,
      metadata: { payout_id: payout.id, action: "pay", reference: input.reference ?? null },
    })
    .select("id")
    .single<{ id: string }>();
  if (txnErr) {
    if (txnErr.code === "23505") {
      revalidatePath("/payouts");
      return { ok: true };
    }
    return { ok: false, error: txnErr.message };
  }

  const { error: entriesErr } = await sb.from("ledger_entries").insert([
    { transaction_id: txn.id, account_id: unpaidId, debit_cents: payout.amount_cents, credit_cents: 0 },
    { transaction_id: txn.id, account_id: paidId, debit_cents: 0, credit_cents: payout.amount_cents },
  ]);
  if (entriesErr) return { ok: false, error: `Ledger write failed: ${entriesErr.message}` };

  const { error: updateErr } = await sb
    .from("payouts")
    .update({
      status: "paid",
      payment_ledger_txn_id: txn.id,
      paid_at: new Date().toISOString(),
      processor_ref: input.reference ?? null,
      processor: "manual",
      updated_at: new Date().toISOString(),
    })
    .eq("id", payout.id);
  if (updateErr) return { ok: false, error: updateErr.message };

  revalidatePath("/payouts");
  revalidatePath(`/creators/${payout.creator_id}`);
  return { ok: true };
}

/**
 * Cancel a pending payout (operator decided not to pay it). No
 * ledger entry — pending payouts haven't booked anything yet.
 */
export async function cancelPayout(input: { id: string }): Promise<Result> {
  const auth = await assertRole("admin");
  if (!auth.ok) return auth;
  const sb = await createClient();
  const { error } = await sb
    .from("payouts")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("status", "pending");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/payouts");
  return { ok: true };
}

// ─── Post → creator/assignment tagging ───────────────────────────
//
// Bridges UGC posts (which the engine pipeline doesn't auto-attribute)
// to the assignments that drive payout calculations. Without this,
// every UGC payout would require a SQL update — this surface makes
// it a one-click action from the post detail drawer.

/**
 * Attach a post to a creator's assignment on the post's campaign.
 *
 *   - The post's campaign_id must already be set (which is true for
 *     every post the pipeline creates).
 *   - The (creator_id, campaign_id) pair must already have an
 *     assignment row — the modal forces the operator to either pick
 *     an existing one or create the assignment first.
 *   - Already-paid payouts are NOT recomputed; the calculator's next
 *     tick after this tag picks up the post for any new pending row.
 */
export async function tagPostToCreator(input: {
  postId: string;
  creatorId: string;
  assignmentId: string;
}): Promise<Result> {
  const auth = await assertRole("admin");
  if (!auth.ok) return auth;
  const sb = await createClient();

  // Verify the post exists + has a campaign
  const { data: post } = await sb
    .from("posts")
    .select("id, campaign_id")
    .eq("id", input.postId)
    .maybeSingle<{ id: string; campaign_id: string | null }>();
  if (!post) return { ok: false, error: "Post not found" };
  if (!post.campaign_id) {
    return {
      ok: false,
      error: "Post has no campaign assigned. Set the post's campaign first before tagging a creator.",
    };
  }

  // Verify the assignment exists, belongs to the same campaign, and is for the requested creator
  const { data: assignment } = await sb
    .from("assignments")
    .select("id, creator_id, campaign_id, status")
    .eq("id", input.assignmentId)
    .maybeSingle<{ id: string; creator_id: string; campaign_id: string; status: string }>();
  if (!assignment) return { ok: false, error: "Assignment not found" };
  if (assignment.creator_id !== input.creatorId) {
    return { ok: false, error: "Assignment doesn't belong to this creator" };
  }
  if (assignment.campaign_id !== post.campaign_id) {
    return { ok: false, error: "Assignment is on a different campaign than this post" };
  }

  const { error } = await sb
    .from("posts")
    .update({
      creator_id: input.creatorId,
      assignment_id: input.assignmentId,
    })
    .eq("id", input.postId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/payouts");
  revalidatePath(`/creators/${input.creatorId}`);
  return { ok: true };
}

/**
 * Detach a post from its creator/assignment. Used when the operator
 * tagged the wrong creator or wants to retract attribution.
 *
 * Does NOT touch any existing payout rows — those are the calculator
 * runner's responsibility and will be recomputed on the next tick
 * to reflect the post no longer being attributed.
 */
export async function untagPostFromCreator(input: { postId: string }): Promise<Result> {
  const auth = await assertRole("admin");
  if (!auth.ok) return auth;
  const sb = await createClient();
  const { error } = await sb
    .from("posts")
    .update({ creator_id: null, assignment_id: null })
    .eq("id", input.postId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/payouts");
  return { ok: true };
}

// ─── Manual adjustments on a pending payout ──────────────────────

export async function setPayoutAdjustments(input: {
  id: string;
  adjustments: ManualAdjustment[];
}): Promise<Result> {
  const auth = await assertRole("admin");
  if (!auth.ok) return auth;
  const sb = await createClient();
  const { error } = await sb
    .from("payouts")
    .update({ manual_adjustments: input.adjustments, updated_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("status", "pending");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/payouts");
  return { ok: true };
}

// ─── Internal helper: lazy-create ledger account ─────────────────

async function ensureAccount(
  sb: Awaited<ReturnType<typeof createClient>>,
  code: string,
  kind: "asset" | "liability" | "revenue" | "expense",
  displayName: string,
): Promise<string | null> {
  const { data: existing } = await sb
    .from("ledger_accounts")
    .select("id")
    .eq("code", code)
    .maybeSingle<{ id: string }>();
  if (existing) return existing.id;

  const { data: created, error: insertErr } = await sb
    .from("ledger_accounts")
    .insert({ code, kind, display_name: displayName })
    .select("id")
    .single<{ id: string }>();
  if (insertErr || !created) {
    // If two requests created the same account concurrently, the
    // second hits the UNIQUE(code) constraint. Re-read.
    const { data: raced } = await sb
      .from("ledger_accounts")
      .select("id")
      .eq("code", code)
      .maybeSingle<{ id: string }>();
    return raced?.id ?? null;
  }
  return created.id;
}
