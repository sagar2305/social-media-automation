/**
 * Read-only dry run of the Content Bank scheduler: loads the real banked posts
 * and prints the exact slot plan the /bank "Preview" button produces. Makes no
 * Blotato calls and writes nothing.
 *
 *   npx tsx scripts/preview-bank-schedule.ts [YYYY-MM-DD]
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { buildSchedulePlan, type BankPostLite } from "../src/lib/bank-schedule";

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
  const supabase = createClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );

  const { data, error } = await supabase
    .from("posts")
    .select("id, account, created_at, failure_resolution_note")
    .eq("status", "banked")
    .order("created_at", { ascending: true });
  if (error) {
    console.error(error);
    process.exit(1);
  }

  const posts: BankPostLite[] = (data ?? []).map((p) => {
    let title: string | undefined;
    try {
      title = JSON.parse((p.failure_resolution_note as string) || "{}").title;
    } catch {
      /* ignore */
    }
    return {
      id: p.id as string,
      account: p.account as string,
      created_at: p.created_at as string,
      title,
    };
  });

  // Connected handles come from the live Blotato account list, never from a
  // hardcoded map — config/config.ts is stale for @yournotetaker.
  const accRes = await fetch("https://backend.blotato.com/v2/users/me/accounts?platform=tiktok", {
    headers: { "blotato-api-key": env("BLOTATO_API_KEY") },
  });
  if (!accRes.ok) {
    console.error(`FATAL: Blotato accounts endpoint returned ${accRes.status}`);
    process.exit(1);
  }
  const accJson = (await accRes.json()) as { items: { id: string; username?: string }[] };
  const connected = new Set(
    (accJson.items ?? []).filter((a) => a.username).map((a) => a.username!.toLowerCase())
  );

  const startDate = process.argv[2] ?? "2026-07-28";
  const plan = buildSchedulePlan({ posts, startDate, connected });

  console.log(`banked posts: ${posts.length}`);
  console.log(`planned:      ${plan.items.length}`);
  for (const s of plan.skipped) {
    console.log(`skipped:      ${s.count} × @${s.account} — ${s.reason}`);
  }

  const byAccount = new Map<string, number>();
  for (const it of plan.items) byAccount.set(it.account, (byAccount.get(it.account) ?? 0) + 1);
  console.log("\nper account:");
  for (const [a, n] of byAccount) console.log(`  ${String(n).padStart(3)}  @${a}`);

  console.log("\nfull slot plan:");
  for (const it of plan.items) {
    console.log(`  ${it.istLabel}  @${it.account.padEnd(20)} ${(it.title ?? "").slice(0, 44)}`);
  }
  console.log(`\nfirst: ${plan.items[0]?.istLabel}`);
  console.log(`last:  ${plan.items[plan.items.length - 1]?.istLabel}`);
}

main();
