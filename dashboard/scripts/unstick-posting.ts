/**
 * Recovery for posts stranded in `posting`.
 *
 * A post is claimed banked → posting before it is submitted, and reverted on
 * failure. If the revert write itself fails (network blip mid-run), the row is
 * stranded: it can never be re-scheduled, because the claim requires
 * status = "banked". This puts such rows back.
 *
 * IMPORTANT: only run when no scheduler is in flight — a row legitimately in
 * `posting` right now belongs to a live run, and resetting it could let a
 * second run submit the same post twice.
 *
 *   npx tsx scripts/unstick-posting.ts          # list only
 *   npx tsx scripts/unstick-posting.ts --apply  # revert to banked
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

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
  const apply = process.argv.includes("--apply");
  const sb = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"));

  const { data, error } = await sb
    .from("posts")
    .select("id, account, failure_resolution_note")
    .eq("status", "posting");
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  console.log(`stranded in "posting": ${rows.length}`);
  for (const p of rows) {
    // A stranded row that already has a scheduledAt was actually submitted —
    // reverting that one would double-book on the next run, so leave it.
    let scheduledAt: string | undefined;
    try {
      scheduledAt = JSON.parse((p.failure_resolution_note as string) || "{}").scheduledAt;
    } catch {
      /* ignore */
    }
    const safe = !scheduledAt;
    console.log(`  ${safe ? "-" : "!"} ${p.id} (@${p.account})${safe ? "" : ` — ALREADY SUBMITTED for ${scheduledAt}, leaving as is`}`);
    if (!apply || !safe) continue;
    const { error: upErr } = await sb
      .from("posts")
      .update({ status: "banked" })
      .eq("id", p.id)
      .eq("status", "posting");
    console.log(upErr ? `      revert FAILED: ${upErr.message}` : "      → banked");
  }
  if (!apply && rows.length) console.log("\nre-run with --apply to revert these to banked");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
