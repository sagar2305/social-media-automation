"use server";

/**
 * Server actions for /campaigns/[slug]/reports.
 *
 * sendTestDigest builds a 1-day test digest and ships it via Resend.
 * Logic is intentionally duplicated (~not imported) from
 * scripts/lib/email-digest.ts because that file lives outside the
 * dashboard's compilation root and Next.js can't transpile it at
 * server-action runtime. The cron uses the script-side copy; the
 * dashboard uses this one. Keep both in sync when extending.
 *
 * Both copies write to the same email_reports_log table and use the
 * same RESEND_API_KEY, so the user sees one unified sent-history list.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase";
import type { Campaign } from "@/lib/types";

const RESEND_API = "https://api.resend.com/emails";
const FROM_DEFAULT = "MinuteWise Automation <onboarding@resend.dev>";

type ActionResult =
  | { ok: true; resend_id?: string }
  | { ok: false; error: string };

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function kpiCell(label: string, value: string): string {
  return `
    <td style="padding:8px;background:#f5f5f7;border-radius:8px;width:25%;">
      <div style="padding:8px;">
        <div style="font-size:11px;color:#86868b;text-transform:uppercase;letter-spacing:0.05em;">${label}</div>
        <div style="font-size:20px;font-weight:700;color:#1d1d1f;font-variant-numeric:tabular-nums;margin-top:2px;">${value}</div>
      </div>
    </td>
  `;
}

interface PostRow {
  id: string;
  hook_style: string | null;
  account: string | null;
  views: number | null;
  likes: number | null;
  saves: number | null;
  shares: number | null;
  comments: number | null;
  save_rate: number | null;
  status: string | null;
  tiktok_url: string | null;
  date: string | null;
}

function renderHtml(campaign: Campaign, posts: PostRow[], windowDays: number): string {
  const include = campaign.email_include ?? {};
  const published = posts.filter((p) => p.status === "published");
  const failed = posts.filter((p) => p.status === "failed" || p.status === "error").length;

  const totals = {
    views: published.reduce((s, p) => s + (p.views ?? 0), 0),
    likes: published.reduce((s, p) => s + (p.likes ?? 0), 0),
    saves: published.reduce((s, p) => s + (p.saves ?? 0), 0),
    shares: published.reduce((s, p) => s + (p.shares ?? 0), 0),
    comments: published.reduce((s, p) => s + (p.comments ?? 0), 0),
    saveRate: published.length > 0
      ? published.reduce((s, p) => s + Number(p.save_rate ?? 0), 0) / published.length
      : 0,
  };

  const top5 = [...published]
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
    .slice(0, 5);

  const blocks: string[] = [];

  blocks.push(`
    <h1 style="margin:0 0 4px 0;font-size:24px;font-weight:700;letter-spacing:-0.02em;">${escapeHtml(campaign.name)}</h1>
    <p style="margin:0 0 24px 0;color:#86868b;font-size:14px;">
      ${windowDays === 1 ? "Test digest" : `Weekly digest · last ${windowDays} day${windowDays === 1 ? "" : "s"}`}
    </p>
  `);

  if (include.kpis !== false) {
    blocks.push(`
      <table role="presentation" cellspacing="0" cellpadding="0" border="0"
             style="width:100%;margin:0 0 24px 0;border-collapse:separate;border-spacing:0 8px;">
        <tr>
          ${kpiCell("Videos", String(published.length))}
          ${kpiCell("Views", fmtNum(totals.views))}
          ${kpiCell("Likes", fmtNum(totals.likes))}
          ${kpiCell("Saves", fmtNum(totals.saves))}
        </tr>
        <tr>
          ${kpiCell("Shares", fmtNum(totals.shares))}
          ${kpiCell("Comments", fmtNum(totals.comments))}
          ${kpiCell("Avg save %", `${totals.saveRate.toFixed(2)}%`)}
          ${kpiCell("Failed", String(failed))}
        </tr>
      </table>
    `);
  }

  if (include.top_posts !== false && top5.length > 0) {
    blocks.push(`
      <h2 style="margin:32px 0 12px 0;font-size:16px;font-weight:600;">Top posts</h2>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
        ${top5.map((post, i) => `
          <tr>
            <td style="padding:10px 12px;border-bottom:1px solid #e8e8ed;font-size:13px;">
              <span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;background:#f5f5f7;color:#1d1d1f;font-weight:600;font-size:11px;margin-right:8px;">${i + 1}</span>
              <strong>${escapeHtml(post.hook_style ?? "post")}</strong>
              ${post.account ? `<span style="color:#86868b;"> · @${escapeHtml(post.account)}</span>` : ""}
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #e8e8ed;text-align:right;font-size:13px;color:#1d1d1f;font-variant-numeric:tabular-nums;">
              ${fmtNum(post.views ?? 0)} views · ${post.saves ?? 0} saves
              ${post.tiktok_url && post.tiktok_url !== "-" ? ` · <a href="${escapeHtml(post.tiktok_url)}" style="color:#16a34a;text-decoration:none;">View →</a>` : ""}
            </td>
          </tr>
        `).join("")}
      </table>
    `);
  }

  if (include.failed_posts !== false && failed > 0) {
    blocks.push(`
      <div style="margin:24px 0;padding:12px 14px;background:#fff5e6;border-left:3px solid #bf4800;border-radius:4px;">
        <p style="margin:0;font-size:13px;color:#1d1d1f;">
          <strong>${failed} post${failed === 1 ? "" : "s"} failed</strong> in the last ${windowDays} day${windowDays === 1 ? "" : "s"}.
        </p>
      </div>
    `);
  }

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1d1d1f;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;padding:32px;border-radius:12px;">
    ${blocks.join("")}
    <hr style="margin:32px 0 16px 0;border:none;border-top:1px solid #e8e8ed;">
    <p style="margin:0;font-size:11px;color:#86868b;">
      Sent by MinuteWise Automation. Manage recipients on the campaign's Reports tab.
    </p>
  </div>
</body></html>`;
}

export async function sendTestDigest(input: { slug: string }): Promise<ActionResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: "RESEND_API_KEY not set. Add it to .env.local on the server.",
    };
  }

  const sb = await createClient();
  const { data: campaign } = await sb
    .from("campaigns")
    .select("*")
    .eq("slug", input.slug)
    .maybeSingle<Campaign>();
  if (!campaign) return { ok: false, error: "Campaign not found" };

  const recipients = campaign.email_recipients ?? [];
  if (recipients.length === 0) {
    return {
      ok: false,
      error: "No recipients configured for this campaign. Add at least one on the edit page.",
    };
  }

  // Test = 1-day window so the email isn't empty for brand-new campaigns
  // that haven't accumulated a full week yet.
  const windowDays = 1;
  const cutoff = new Date(Date.now() - windowDays * 86_400_000)
    .toISOString().slice(0, 10);

  const { data: posts } = await sb
    .from("posts")
    .select(
      "id, hook_style, account, views, likes, saves, shares, comments, save_rate, status, tiktok_url, date",
    )
    .eq("campaign_id", campaign.id)
    .gte("date", cutoff)
    .order("date", { ascending: false });

  const html = renderHtml(campaign, (posts ?? []) as PostRow[], windowDays);
  const subject = `${campaign.name} — Test digest`;
  const from = process.env.RESEND_FROM || FROM_DEFAULT;

  let resendId: string | null = null;
  let errorMsg: string | null = null;
  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: recipients, subject, html }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      errorMsg = body?.message || `Resend ${res.status}`;
    } else {
      resendId = body?.id ?? null;
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  // Always log — operator wants the whole timeline, including failures.
  await sb.from("email_reports_log").insert({
    campaign_id: campaign.id,
    recipients,
    subject,
    status: errorMsg ? "failed" : "test",
    resend_id: resendId,
    trigger: "test",
    error_message: errorMsg,
    metadata: {
      window_days: windowDays,
      posts_count: (posts ?? []).filter((p) => p.status === "published").length,
    },
  });

  revalidatePath(`/campaigns/${input.slug}/reports`);

  if (errorMsg) return { ok: false, error: errorMsg };
  return { ok: true, resend_id: resendId ?? undefined };
}
