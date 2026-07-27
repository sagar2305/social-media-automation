/**
 * Preflight for the Content Bank: checks every banked post for anything that
 * would make a Blotato submission fail, WITHOUT submitting anything.
 *
 * Checks, per post:
 *   - meta JSON parses; caption + title present and within limits
 *   - slide count within TikTok's photo-post range
 *   - every slide URL actually resolves (status, content-type, byte size)
 *   - the account maps to a LIVE Blotato account id
 *
 *   npx tsx scripts/preflight-bank.ts
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

// TikTok photo posts: 1-35 images. Caption cap is 2200 chars; title 90.
const MAX_SLIDES = 35;
const MAX_CAPTION = 2200;
const MAX_TITLE = 90;
// Blotato's media converter has intermittently failed on heavy PNGs (~3MB).
const HEAVY_BYTES = 2_000_000;

async function main() {
  const sb = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"));

  // 1. Live Blotato accounts — the source of truth for account ids.
  const accRes = await fetch("https://backend.blotato.com/v2/users/me/accounts?platform=tiktok", {
    headers: { "blotato-api-key": env("BLOTATO_API_KEY") },
  });
  if (!accRes.ok) {
    console.error(`FATAL: Blotato accounts endpoint returned ${accRes.status}`);
    process.exit(1);
  }
  const accJson = (await accRes.json()) as { items: { id: string; username?: string }[] };
  const liveIds = new Map<string, string>();
  for (const a of accJson.items) if (a.username) liveIds.set(a.username.toLowerCase(), a.id);
  console.log("live Blotato TikTok accounts:");
  for (const [u, id] of liveIds) console.log(`  @${u.padEnd(22)} ${id}`);

  // 2. Banked posts.
  const { data, error } = await sb
    .from("posts")
    .select("id, account, created_at, failure_resolution_note")
    .eq("status", "banked")
    .order("created_at", { ascending: true });
  if (error) {
    console.error(error);
    process.exit(1);
  }

  const problems: string[] = [];
  const warnings: string[] = [];
  let totalSlides = 0;
  let checkedUrls = 0;
  const byAccount = new Map<string, number>();
  const sizes: number[] = [];

  console.log(`\nchecking ${data!.length} banked posts…\n`);

  for (const p of data!) {
    const id = p.id as string;
    const account = p.account as string;
    byAccount.set(account, (byAccount.get(account) ?? 0) + 1);

    let meta: { caption?: string; title?: string; slideUrls?: string[] };
    try {
      meta = JSON.parse((p.failure_resolution_note as string) || "{}");
    } catch (e) {
      problems.push(`${id}: meta JSON is unparseable — ${e instanceof Error ? e.message : e}`);
      continue;
    }

    if (!liveIds.has(account.toLowerCase())) {
      problems.push(`${id}: account @${account} has no live Blotato connection`);
    }

    const caption = meta.caption ?? "";
    if (!caption.trim()) problems.push(`${id}: empty caption`);
    if (caption.length > MAX_CAPTION) {
      problems.push(`${id}: caption ${caption.length} chars > ${MAX_CAPTION}`);
    }
    if ((meta.title ?? "").length > MAX_TITLE) {
      warnings.push(`${id}: title ${(meta.title ?? "").length} chars — will be truncated to ${MAX_TITLE}`);
    }

    const slides = meta.slideUrls ?? [];
    if (!slides.length) {
      problems.push(`${id}: no slideUrls`);
      continue;
    }
    if (slides.length > MAX_SLIDES) problems.push(`${id}: ${slides.length} slides > ${MAX_SLIDES}`);
    totalSlides += slides.length;

    // 3. Every slide URL must actually be fetchable by Blotato.
    for (let i = 0; i < slides.length; i++) {
      const url = slides[i];
      checkedUrls++;
      try {
        let r = await fetch(url, { method: "HEAD" });
        // Some CDNs don't answer HEAD — fall back to a ranged GET.
        if (r.status === 405 || r.status === 501) {
          r = await fetch(url, { headers: { Range: "bytes=0-1" } });
        }
        if (!r.ok && r.status !== 206) {
          problems.push(`${id} slide ${i + 1}: HTTP ${r.status} — ${url}`);
          continue;
        }
        const type = r.headers.get("content-type") ?? "";
        const len = Number(r.headers.get("content-length") ?? 0);
        if (!type.startsWith("image/")) {
          problems.push(`${id} slide ${i + 1}: content-type "${type}" is not an image — ${url}`);
        }
        if (len) {
          sizes.push(len);
          if (len > HEAVY_BYTES) {
            warnings.push(
              `${id} slide ${i + 1}: ${(len / 1e6).toFixed(2)}MB ${type} — heavy, Blotato conversion has failed on these`
            );
          }
        }
      } catch (e) {
        problems.push(
          `${id} slide ${i + 1}: unreachable — ${e instanceof Error ? e.message : e} — ${url}`
        );
      }
    }
  }

  console.log("posts per account:");
  for (const [a, n] of byAccount) {
    console.log(`  ${String(n).padStart(3)}  @${a}${liveIds.has(a.toLowerCase()) ? "" : "   ← NO BLOTATO ACCOUNT"}`);
  }

  sizes.sort((a, b) => a - b);
  if (sizes.length) {
    const sum = sizes.reduce((a, b) => a + b, 0);
    console.log(
      `\nslide media: ${checkedUrls} urls, ${totalSlides} slides, ` +
        `min ${(sizes[0] / 1e6).toFixed(2)}MB / median ${(sizes[Math.floor(sizes.length / 2)] / 1e6).toFixed(2)}MB / ` +
        `max ${(sizes[sizes.length - 1] / 1e6).toFixed(2)}MB, avg ${(sum / sizes.length / 1e6).toFixed(2)}MB`
    );
    console.log(`slides over ${(HEAVY_BYTES / 1e6).toFixed(1)}MB: ${sizes.filter((s) => s > HEAVY_BYTES).length}`);
  }

  console.log(`\n=== ${problems.length} BLOCKING problems ===`);
  for (const p of problems.slice(0, 60)) console.log(`  ✗ ${p}`);
  if (problems.length > 60) console.log(`  … and ${problems.length - 60} more`);

  console.log(`\n=== ${warnings.length} warnings ===`);
  for (const w of warnings.slice(0, 30)) console.log(`  ! ${w}`);
  if (warnings.length > 30) console.log(`  … and ${warnings.length - 30} more`);
}

main();
