/**
 * Read-only audit of the scheduled bank: per-account counts, the full slot
 * table, duplicate detection, and any post left in a non-terminal state.
 *
 *   npx tsx scripts/audit-schedule.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { formatIst } from "../src/lib/bank-schedule";

const __dirname = dirname(fileURLToPath(import.meta.url));

function env(name: string): string {
  for (const file of [".env.local", "../.env.local"]) {
    try {
      const line = readFileSync(resolve(__dirname, "..", file), "utf8")
        .split("\n")
        .find((l) => l.startsWith(`${name}=`));
      if (line) return line.slice(name.length + 1).trim();
    } catch {
      /* try next */
    }
  }
  throw new Error(`Missing ${name}`);
}

async function main() {
  const sb = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"));

  const { data, error } = await sb
    .from("posts")
    .select("id, account, status, failure_resolution_note")
    .in("status", ["banked", "posting", "scheduled", "posted", "error"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const byStatus = new Map<string, number>();
  for (const p of data ?? []) byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1);
  console.log("status counts (whole table):");
  for (const [s, n] of [...byStatus].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${s}`);
  }

  // Anything stuck mid-flight is the thing to catch — a claimed row that never
  // reverted can never be re-scheduled, since the claim requires status=banked.
  const stuck = (data ?? []).filter((p) => p.status === "posting");
  console.log(`\nstuck in "posting": ${stuck.length}`);
  for (const p of stuck) console.log(`  ! ${p.id} (@${p.account})`);

  const stillBanked = (data ?? []).filter((p) => p.status === "banked");
  console.log(`\nstill banked: ${stillBanked.length}`);
  for (const p of stillBanked) console.log(`  - ${p.id} (@${p.account})`);

  interface Row {
    id: string;
    account: string;
    at: string;
  }
  const rows: Row[] = [];
  for (const p of data ?? []) {
    if (p.status !== "scheduled") continue;
    try {
      const at = JSON.parse((p.failure_resolution_note as string) || "{}").scheduledAt;
      if (at) rows.push({ id: p.id as string, account: p.account as string, at });
    } catch {
      /* ignore */
    }
  }
  rows.sort((a, b) => a.at.localeCompare(b.at) || a.account.localeCompare(b.account));

  const perAccount = new Map<string, Row[]>();
  for (const r of rows) {
    if (!perAccount.has(r.account)) perAccount.set(r.account, []);
    perAccount.get(r.account)!.push(r);
  }
  console.log(`\nscheduled with a slot: ${rows.length}`);
  for (const [a, list] of perAccount) {
    console.log(
      `  ${String(list.length).padStart(3)}  @${a.padEnd(20)} ${formatIst(list[0].at)} → ${formatIst(
        list[list.length - 1].at
      )}`
    );
  }

  const seen = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.account}|${r.at}`;
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k)!.push(r);
  }
  const dupes = [...seen.entries()].filter(([, v]) => v.length > 1);
  console.log(`\nduplicate slots: ${dupes.length}`);
  for (const [k, v] of dupes) {
    const [account, at] = k.split("|");
    console.log(`  ! @${account} ${formatIst(at)} × ${v.length}`);
    for (const r of v) console.log(`      ${r.id}`);
  }

  // Gap check: every (account, day) should have the full slot set.
  const days = new Map<string, Set<string>>();
  for (const r of rows) {
    const ist = new Date(new Date(r.at).getTime() + 5.5 * 3_600_000).toISOString();
    const key = `${r.account}|${ist.slice(0, 10)}`;
    if (!days.has(key)) days.set(key, new Set());
    days.get(key)!.add(ist.slice(11, 16));
  }
  console.log("\nper account/day slot coverage:");
  for (const [k, times] of [...days].sort()) {
    const [account, day] = k.split("|");
    // `times` holds IST wall-clock, so compare against the IST slot set.
    const marks = ["08:00", "14:00", "20:00"].map((t) => (times.has(t) ? "●" : "○")).join("");
    console.log(`  ${day} @${account.padEnd(20)} ${marks}  (${[...times].sort().join(", ")})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
