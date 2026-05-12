import { createClient } from "@/lib/supabase";
import { NotificationsBellClient, type NotificationItem } from "./notifications-bell-client";

/**
 * Server component that aggregates "needs your attention" items into
 * one notifications dropdown. Currently surfaces:
 *
 *   - pending creator_account_requests   → /accounts
 *   - pending payouts                    → /payouts
 *
 * Add to this list when new admin-action queues appear; each row
 * just needs to map to one NotificationItem with a clickable href.
 *
 * Renders a thin client component for the open/close UX; the data
 * itself comes from a single server-side fetch so we don't pay the
 * Supabase round-trip on every hover.
 */
export async function NotificationsBell() {
  const sb = await createClient();

  const [acctReqRes, payoutsRes] = await Promise.all([
    sb.from("creator_account_requests")
      .select("id, handle, created_at, creator:creator_id(legal_name, display_name)")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(10)
      .returns<Array<{
        id: string; handle: string; created_at: string;
        creator: { legal_name: string; display_name: string | null } |
                 { legal_name: string; display_name: string | null }[] | null;
      }>>(),
    sb.from("payouts")
      .select("id, amount_cents, currency, created_at, creator:creator_id(legal_name, display_name)")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(10)
      .returns<Array<{
        id: string; amount_cents: number; currency: string; created_at: string;
        creator: { legal_name: string; display_name: string | null } |
                 { legal_name: string; display_name: string | null }[] | null;
      }>>(),
  ]);

  const items: NotificationItem[] = [];

  for (const r of acctReqRes.data ?? []) {
    const c = Array.isArray(r.creator) ? r.creator[0] : r.creator;
    const who = c?.display_name || c?.legal_name || "A creator";
    items.push({
      id: `acctreq:${r.id}`,
      kind: "account_request",
      title: `${who} wants to add @${r.handle}`,
      hint: "Account request — review on Accounts",
      href: "/accounts",
      timestamp: r.created_at,
    });
  }

  for (const p of payoutsRes.data ?? []) {
    const c = Array.isArray(p.creator) ? p.creator[0] : p.creator;
    const who = c?.display_name || c?.legal_name || "A creator";
    const sym = p.currency === "USD" ? "$" : p.currency === "INR" ? "₹" : "";
    const amt = `${sym}${(p.amount_cents / 100).toFixed(2)}`;
    items.push({
      id: `payout:${p.id}`,
      kind: "payout",
      title: `${amt} pending for ${who}`,
      hint: "Payout — approve on Payouts",
      href: "/payouts",
      timestamp: p.created_at,
    });
  }

  // Most recent first across both buckets.
  items.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));

  return <NotificationsBellClient items={items} />;
}
