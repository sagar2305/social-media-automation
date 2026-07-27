/**
 * Content Bank scheduling — slot assignment.
 *
 * Banked posts each carry a fixed `account`, so scheduling is done per account
 * independently: every account gets its own 3-slots-a-day lane (08:00 / 14:00 /
 * 20:00 IST by default), which reproduces the cadence the accounts ran on
 * through 21 Jul.
 *
 * Everything here is pure so the preview the user confirms and the plan the
 * executor submits are produced by the same code path — no chance of the
 * confirmed table and the real submission drifting apart.
 *
 * Timezone: Asia/Kolkata is a fixed UTC+5:30 offset (no DST), so slot math is
 * plain arithmetic rather than an Intl round-trip.
 */

export const IST_OFFSET_MIN = 5 * 60 + 30;

/**
 * Blotato account ids are deliberately NOT hardcoded here. The ids in
 * config/config.ts are stale (@yournotetaker is 36969 upstream, not the `cmm…`
 * id checked in), so callers pass the live connected-handle set resolved from
 * /users/me/accounts. See lib/blotato.ts.
 */

/** The three accounts actually in rotation. */
export const DEFAULT_ACCOUNTS = [
  "yournotetaker",
  "grow.with.claudia",
  "miniutewise_thomas",
] as const;

export const DEFAULT_TIMES = ["08:00", "14:00", "20:00"];

/**
 * Blotato rejects a scheduledTime in the past. Slots are also skipped when
 * they're too close to now — a submission that lands seconds before its slot is
 * the same 422 in practice.
 */
export const MIN_LEAD_MINUTES = 15;

/** Guard against an unbounded walk if a caller passes a huge post list. */
const MAX_DAYS = 120;

export interface BankPostLite {
  id: string;
  account: string;
  title?: string;
  created_at: string;
}

export interface PlanItem {
  id: string;
  account: string;
  title: string;
  /** UTC instant handed to Blotato as `scheduledTime`. */
  scheduledAt: string;
  /** Same instant rendered in IST, for the confirmation table. */
  istLabel: string;
}

export interface SchedulePlan {
  items: PlanItem[];
  skipped: { account: string; count: number; reason: string }[];
}

/** IST wall-clock (`YYYY-MM-DD`, `HH:MM`) → UTC instant. */
export function istToUtc(dateStr: string, timeStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MIN * 60_000);
}

/** UTC instant → `DD MMM, HH:MM IST` for display. */
export function formatIst(iso: string): string {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MIN * 60_000);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())} ${months[d.getUTCMonth()]}, ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes()
  )} IST`;
}

/** Advance an IST `YYYY-MM-DD` by one day. */
function nextDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

/**
 * Assign posts to slots, one independent lane per account.
 *
 * Posts are taken oldest-first so repeated previews are stable, and any slot
 * already in the past (or inside the lead-time window) is skipped rather than
 * submitted — Blotato would 422 the whole request otherwise.
 */
/** Key for an account's claim on one instant: `handle|ISO`. */
export function slotKey(account: string, iso: string): string {
  return `${account.toLowerCase()}|${iso}`;
}

export function buildSchedulePlan(opts: {
  posts: BankPostLite[];
  startDate: string;
  times?: string[];
  accounts?: readonly string[];
  /** Handles with a live Blotato connection, lowercased. */
  connected: ReadonlySet<string>;
  /**
   * Slots already claimed by previously scheduled posts, as slotKey() strings.
   *
   * Without this a second run re-starts each account's lane at startDate and
   * double-books slots the first run already filled — and since Blotato has no
   * delete endpoint, a double-booking cannot be undone. Always pass the current
   * `scheduled` set.
   */
  occupied?: ReadonlySet<string>;
  now?: Date;
}): SchedulePlan {
  const times = (opts.times?.length ? opts.times : DEFAULT_TIMES).slice().sort();
  // A malformed startDate yields Invalid Date, whose getTime() is NaN — every
  // comparison against it is false, so it would slip past the past-slot guard
  // and throw on toISOString(). Fail loudly here instead.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.startDate) || isNaN(istToUtc(opts.startDate, "00:00").getTime())) {
    throw new Error(`Invalid startDate "${opts.startDate}" — expected YYYY-MM-DD`);
  }
  const allowed = new Set(opts.accounts ?? DEFAULT_ACCOUNTS);
  const now = opts.now ?? new Date();
  const cutoff = now.getTime() + MIN_LEAD_MINUTES * 60_000;
  const isConnected = (a: string) => opts.connected.has(a.toLowerCase());
  const occupied = opts.occupied ?? new Set<string>();

  const byAccount = new Map<string, BankPostLite[]>();
  const skipped: SchedulePlan["skipped"] = [];

  for (const p of opts.posts) {
    if (!allowed.has(p.account)) continue;
    if (!isConnected(p.account)) continue;
    if (!byAccount.has(p.account)) byAccount.set(p.account, []);
    byAccount.get(p.account)!.push(p);
  }

  // Anything filtered out above is reported so the UI can never imply a post
  // was scheduled when it silently wasn't.
  const excluded = new Map<string, number>();
  for (const p of opts.posts) {
    if (!allowed.has(p.account) || !isConnected(p.account)) {
      excluded.set(p.account, (excluded.get(p.account) ?? 0) + 1);
    }
  }
  for (const [account, count] of excluded) {
    skipped.push({
      account,
      count,
      reason: isConnected(account) ? "not in the selected accounts" : "no Blotato account connected",
    });
  }

  const items: PlanItem[] = [];

  for (const [account, posts] of byAccount) {
    posts.sort((a, b) => a.created_at.localeCompare(b.created_at));
    let day = opts.startDate;
    let i = 0;
    let days = 0;

    while (i < posts.length && days < MAX_DAYS) {
      for (const t of times) {
        if (i >= posts.length) break;
        const at = istToUtc(day, t);
        if (at.getTime() < cutoff) continue; // slot already gone
        // Never re-use a slot this account already has a post in — Blotato
        // can't delete a double-booking once it's submitted.
        if (occupied.has(slotKey(account, at.toISOString()))) continue;
        const p = posts[i++];
        items.push({
          id: p.id,
          account,
          title: p.title || "Untitled",
          scheduledAt: at.toISOString(),
          istLabel: formatIst(at.toISOString()),
        });
      }
      day = nextDay(day);
      days++;
    }

    // If the walk hit MAX_DAYS with posts left over, say so. Silently dropping
    // them would let the UI report a plan that covers fewer posts than it
    // appears to.
    if (i < posts.length) {
      skipped.push({
        account,
        count: posts.length - i,
        reason: `no free slot within ${MAX_DAYS} days of ${opts.startDate}`,
      });
    }
  }

  items.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  return { items, skipped };
}
