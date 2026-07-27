/**
 * Exercises the real media pipeline (fetch → sharp JPEG q85 → Blotato /v2/media)
 * on one banked post. Uploads media but publishes NOTHING — no /v2/posts call.
 *
 *   npx tsx scripts/test-media-prep.ts [postId]
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { prepareMediaUrls, getTiktokAccounts } from "../src/lib/blotato";

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

async function bytes(url: string): Promise<number> {
  const r = await fetch(url, { method: "HEAD" });
  return Number(r.headers.get("content-length") ?? 0);
}

async function main() {
  const apiKey = env("BLOTATO_API_KEY");
  const sb = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"));

  console.log("account resolution:");
  const accounts = await getTiktokAccounts(apiKey);
  for (const h of ["yournotetaker", "grow.with.claudia", "miniutewise_thomas"]) {
    console.log(`  @${h.padEnd(22)} → ${accounts.get(h) ?? "MISSING"}`);
  }

  const id = process.argv[2] ?? "2026-06-27_15-03-38_@miniutewise_thomas";
  const { data, error } = await sb
    .from("posts")
    .select("id, account, failure_resolution_note")
    .eq("id", id)
    .single();
  if (error || !data) {
    console.error("post not found:", error?.message);
    process.exit(1);
  }

  const meta = JSON.parse((data.failure_resolution_note as string) || "{}") as {
    slideUrls?: string[];
  };
  const slides = meta.slideUrls ?? [];
  console.log(`\npost ${id} — @${data.account}, ${slides.length} slides`);

  let before = 0;
  for (const s of slides) before += await bytes(s);
  console.log(`source total: ${(before / 1e6).toFixed(2)}MB`);

  const t0 = Date.now();
  const prepared = await prepareMediaUrls(slides, apiKey);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  let after = 0;
  for (const u of prepared) after += await bytes(u);

  console.log(`prepared:     ${(after / 1e6).toFixed(2)}MB in ${secs}s`);
  console.log(`reduction:    ${(100 - (after / before) * 100).toFixed(0)}%`);
  console.log("\nblotato urls:");
  for (const u of prepared) console.log(`  ${u}`);
}

main();
