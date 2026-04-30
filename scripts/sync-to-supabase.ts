import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mkqarsodftnlcuscsrii.supabase.co",
  // Use the anon key - RLS policies allow all operations
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rcWFyc29kZnRubGN1c2NzcmlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NDE0MDgsImV4cCI6MjA5MTIxNzQwOH0.ZOwIVVVPmpJcVrE07yJUaQv79LRivNPshADZ5aJ5wtU"
);

const DATA_DIR = join(import.meta.dirname, "..", "data");

function readFile(name: string): string {
  try {
    return readFileSync(join(DATA_DIR, name), "utf-8");
  } catch {
    console.log(`  Skipping ${name} (not found)`);
    return "";
  }
}

function parseMarkdownTable(md: string): Record<string, string>[] {
  const lines = md.split("\n").filter((l) => l.startsWith("|"));
  if (lines.length < 3) return []; // header + separator + at least 1 row
  const headers = lines[0]
    .split("|")
    .map((h) => h.trim())
    .filter(Boolean);
  return lines.slice(2).map((line) => {
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((_, i, arr) => i > 0 && i < arr.length); // skip empty first/last
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

function cleanNum(val: string): number {
  if (!val || val === "-" || val === "N/A") return 0;
  return parseFloat(val.replace("%", "")) || 0;
}

function parseAccount(status: string, tiktokUrl?: string): string | null {
  // Extract @handle from status like "scheduled (@yournotetaker, animated)"
  const statusMatch = status?.match(/@([\w.]+)/);
  if (statusMatch) return statusMatch[1];
  // Fallback: extract from TikTok URL like tiktok.com/@yournotetaker/...
  if (tiktokUrl && tiktokUrl !== "-") {
    const urlMatch = tiktokUrl.match(/tiktok\.com\/@([\w.]+)/);
    if (urlMatch) return urlMatch[1];
  }
  return null;
}

function parseHashtags(hashtagStr: string): string[] {
  if (!hashtagStr || hashtagStr === "-") return [];
  return hashtagStr
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
}

async function syncPosts() {
  console.log("Syncing posts...");
  const md = readFile("POST-TRACKER.md");
  if (!md) return;
  const rows = parseMarkdownTable(md);

  const posts = rows.map((r) => ({
    id: r["Post ID"],
    date: r["Date"] || null,
    hook_style: r["Hook Style"] || null,
    format: r["Format"] || null,
    hashtags: parseHashtags(r["Hashtags"]),
    views: cleanNum(r["Views"]),
    likes: cleanNum(r["Likes"]),
    saves: cleanNum(r["Saves"]),
    shares: cleanNum(r["Shares"]),
    comments: cleanNum(r["Comments"]),
    save_rate: cleanNum(r["Save Rate"]),
    status: r["Status"]?.replace(/ \(.*\)/, "") || "unknown",
    tiktok_url: r["TikTok URL"] === "-" ? null : r["TikTok URL"] || null,
    account: parseAccount(r["Status"], r["TikTok URL"]) || "yournotetaker",
    flow: null as string | null,
  }));

  // Try to infer flow from status field
  for (const p of posts) {
    const status = rows.find((r) => r["Post ID"] === p.id)?.["Status"] || "";
    if (status.includes("animated")) p.flow = "animated";
    else if (status.includes("emoji")) p.flow = "emoji";
    else if (status.includes("photo")) p.flow = "photorealistic";
  }

  // Upsert in batches of 50
  for (let i = 0; i < posts.length; i += 50) {
    const batch = posts.slice(i, i + 50);
    const { error } = await supabase.from("posts").upsert(batch, {
      onConflict: "id",
    });
    if (error) console.error("  Posts upsert error:", error.message);
  }
  console.log(`  Synced ${posts.length} posts`);
}

async function syncAccountStats() {
  console.log("Syncing account stats...");
  const md = readFile("ACCOUNT-STATS.md");
  if (!md) return;

  // Parse the "Current" table
  const currentTable = md.split("## Current")[1]?.split("## History")[0] || "";
  const rows = parseMarkdownTable(currentTable);

  const today = new Date().toISOString().split("T")[0];
  const stats = rows.map((r) => ({
    date: today,
    account: r["Account"]?.replace(/^@/, ""),
    followers: cleanNum(r["Followers"]),
    total_likes: cleanNum(r["Total Likes"]),
    views: cleanNum(r["Views"]),
    videos: cleanNum(r["Videos"]),
  }));

  for (const stat of stats) {
    const { error } = await supabase.from("account_stats").upsert(stat, {
      onConflict: "date,account",
    });
    if (error) console.error("  Account stats upsert error:", error.message);
  }
  console.log(`  Synced ${stats.length} account stats`);
}

async function syncExperiments() {
  console.log("Syncing experiments...");

  // Primary source: results.tsv (has the actual numbers)
  const tsv = readFile("results.tsv");
  if (!tsv) return;

  const lines = tsv.split("\n").filter((l) => l.trim() && !l.startsWith("experiment_id"));

  // Secondary source: EXPERIMENT-LOG.md for verdict descriptions
  const md = readFile("EXPERIMENT-LOG.md");
  const verdictMap = new Map<string, string>();
  if (md) {
    const blocks = md.split("### Experiment").filter((b) => b.trim());
    for (const block of blocks) {
      const idMatch = block.match(/#(\S+)/);
      const verdictMatch = block.match(/Verdict[:\s]*(.+)/i);
      if (idMatch && verdictMatch) {
        verdictMap.set(idMatch[1], verdictMatch[1].replace(/\*+/g, "").trim());
      }
    }
  }

  // Deduplicate by id (keep last entry per experiment)
  const expMap = new Map<string, typeof experiments[0]>();

  const experiments: Array<{
    id: string;
    date: string;
    variable: string;
    variant_a: string;
    variant_b: string;
    views_a: number;
    views_b: number;
    saves_a: number;
    saves_b: number;
    save_rate_a: number;
    save_rate_b: number;
    status: string;
    winner: string | null;
    description: string;
  }> = [];

  for (const line of lines) {
    const cols = line.split("\t");
    if (cols.length < 12) continue;

    const [id, date, account, variable, variant_a, variant_b, metric_a, metric_b, views_a, views_b, saves_a, saves_b, status, description] = cols;

    if (!id || id === "-") continue;

    // Normalize status
    let dbStatus = "active";
    if (status === "keep") dbStatus = "winner";
    else if (status === "discard") dbStatus = "loser";
    else if (status === "inconclusive" || status === "wasted") dbStatus = "inconclusive";
    else if (status === "in_progress") dbStatus = "active";

    const verdict = verdictMap.get(id) || description || "";

    expMap.set(id, {
      id,
      date: date || "",
      account: account || null,
      variable: variable || "hook_style",
      variant_a: variant_a || "",
      variant_b: variant_b || "",
      views_a: cleanNum(views_a),
      views_b: cleanNum(views_b),
      saves_a: cleanNum(saves_a),
      saves_b: cleanNum(saves_b),
      save_rate_a: cleanNum(metric_a),
      save_rate_b: cleanNum(metric_b),
      status: dbStatus,
      winner: dbStatus === "winner" ? "A" : null,
      description: verdict || description || "",
    });
  }

  const toUpsert = Array.from(expMap.values());

  if (toUpsert.length > 0) {
    const { error } = await supabase.from("experiments").upsert(toUpsert, {
      onConflict: "id",
    });
    if (error) console.error("  Experiments upsert error:", error.message);
  }
  console.log(`  Synced ${toUpsert.length} experiments`);
}

async function syncFormatRankings() {
  console.log("Syncing format rankings...");
  const md = readFile("FORMAT-WINNERS.md");
  if (!md) return;
  const rows = parseMarkdownTable(md);

  // Clear old rankings first
  await supabase.from("format_rankings").delete().neq("id", 0);

  const rankings = rows
    .filter((r) => r["Rank"] && !isNaN(Number(r["Rank"])) && r["Hook Style"] && r["Hook Style"] !== "Hook Style")
    .map((r) => ({
      rank: cleanNum(r["Rank"]),
      hook_style: r["Hook Style"],
      avg_views: cleanNum(r["Avg Views"]),
      avg_save_rate: cleanNum(r["Avg Save Rate"]),
      post_count: cleanNum(r["Posts"]),
      last_used: r["Last Used"] && r["Last Used"].match(/^\d{4}-\d{2}-\d{2}$/) ? r["Last Used"] : null,
    }));

  if (rankings.length > 0) {
    const { error } = await supabase.from("format_rankings").insert(rankings);
    if (error) console.error("  Format rankings insert error:", error.message);
  }
  console.log(`  Synced ${rankings.length} format rankings`);
}

async function syncAutoFixLog() {
  console.log("Syncing auto-fix events...");
  const md = readFile("auto-fix-log.md");
  if (!md) return;

  const lines = md.split("\n").filter((l) => /^\|\s*\d{4}-\d{2}-\d{2}/.test(l));
  if (!lines.length) {
    console.log("  No event rows found");
    return;
  }

  const events = lines
    .map((line) => {
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter((_, i, arr) => i > 0 && i < arr.length);
      // Columns: Timestamp | Tier | Source | Status | Signature | Action | Handled
      const [ts, tier, source, status, sigCell, action, handled] = cells;
      if (!ts || !sigCell) return null;
      const sigMatch = sigCell.match(/`([^`]+)`/);
      const signature = sigMatch ? sigMatch[1] : sigCell;
      const occurredAt = new Date(ts.replace(" ", "T") + "Z").toISOString();
      const statusNum = status === "-" || !status ? null : parseInt(status, 10);
      return {
        occurred_at: occurredAt,
        tier: tier || "UNKNOWN",
        source: source || "unknown",
        status: Number.isFinite(statusNum as number) ? statusNum : null,
        signature,
        action: action?.replace(/\\\|/g, "|") || null,
        handled: handled || "pending",
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  for (let i = 0; i < events.length; i += 100) {
    const batch = events.slice(i, i + 100);
    const { error } = await supabase
      .from("auto_fix_events")
      .upsert(batch, { onConflict: "occurred_at,signature" });
    if (error) console.error("  Auto-fix events upsert error:", error.message);
  }
  console.log(`  Synced ${events.length} auto-fix events`);
}

export async function syncToSupabase() {
  console.log("Starting Supabase sync...\n");
  await syncPosts();
  await syncAccountStats();
  await syncExperiments();
  await syncFormatRankings();
  await syncAutoFixLog();
  console.log("\nSync complete!");
}

// Allow running standalone: npm run sync
if (process.argv[1]?.includes("sync-to-supabase")) {
  syncToSupabase().catch(console.error);
}
