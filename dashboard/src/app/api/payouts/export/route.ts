/**
 * GET /api/payouts/export?from=YYYY-MM-DD&to=YYYY-MM-DD&status=...
 *
 * CSV export of payouts in a date range. Useful for:
 *   - Handing off to a bookkeeper for manual 1099-NEC / 1042-S filing
 *     (we don't run the processor so we don't auto-file taxes).
 *   - Reconciling against your bank's transfer history.
 *   - Annual reporting per creator.
 *
 * The CSV columns mirror what an accountant typically wants:
 *   creator legal name, country, campaign, rule, post count, amount,
 *   status, approved date, paid date, processor reference.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase";
import { assertRole } from "@/lib/auth";
import type { PayoutWithJoins } from "@/lib/types";

export const dynamic = "force-dynamic";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest) {
  // Payouts export contains every creator's legal name, email, country,
  // amounts, and processor refs — admin-only. Without this guard any
  // signed-in user (including a creator viewing their own dashboard)
  // could GET this route and dump the entire table. RLS would normally
  // be the second line of defence, but the join on `creator:creator_id`
  // pulls fields that may not be RLS-restricted to the requester, so we
  // gate at the route level too.
  const auth = await assertRole("admin");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const from = params.get("from"); // ISO date YYYY-MM-DD
  const to = params.get("to");
  const status = params.get("status"); // optional: pending|approved|paid|...

  const sb = await createClient();
  let q = sb
    .from("payouts")
    .select(
      "*, creator:creator_id(id, legal_name, display_name, email, country, preferred_processor), campaign:campaign_id(id, slug, name)"
    )
    .order("created_at", { ascending: true });
  if (from) q = q.gte("created_at", `${from}T00:00:00Z`);
  if (to)   q = q.lte("created_at", `${to}T23:59:59Z`);
  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = ((data ?? []) as unknown as Array<PayoutWithJoins & {
    creator: PayoutWithJoins["creator"] | PayoutWithJoins["creator"][] | (PayoutWithJoins["creator"] & { country: string | null });
    campaign: PayoutWithJoins["campaign"] | PayoutWithJoins["campaign"][];
  }>).map((row) => ({
    ...row,
    creator: Array.isArray(row.creator) ? row.creator[0] : row.creator,
    campaign: Array.isArray(row.campaign) ? row.campaign[0] : row.campaign,
  }));

  const headers = [
    "payout_id",
    "created_at",
    "campaign_slug",
    "campaign_name",
    "creator_legal_name",
    "creator_display_name",
    "creator_email",
    "creator_country",
    "creator_processor",
    "rule",
    "post_count",
    "amount_cents",
    "amount",
    "currency",
    "status",
    "approved_at",
    "paid_at",
    "processor_ref",
  ];

  const lines: string[] = [headers.join(",")];
  for (const r of rows) {
    const c = r.creator as (PayoutWithJoins["creator"] & { country?: string | null }) | undefined;
    lines.push([
      r.id,
      r.created_at,
      r.campaign?.slug ?? "",
      r.campaign?.name ?? "",
      c?.legal_name ?? "",
      c?.display_name ?? "",
      c?.email ?? "",
      c?.country ?? "",
      c?.preferred_processor ?? "",
      r.computed_from?.rule ?? "",
      r.computed_from?.contributing_post_ids?.length ?? 0,
      r.amount_cents,
      (r.amount_cents / 100).toFixed(2),
      r.currency,
      r.status,
      r.approved_at ?? "",
      r.paid_at ?? "",
      r.processor_ref ?? "",
    ].map(csvEscape).join(","));
  }

  const filename = `payouts-${from ?? "all"}-${to ?? "now"}.csv`;
  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
