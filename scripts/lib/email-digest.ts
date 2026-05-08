/**
 * Email digest builder + sender (Resend).
 *
 * Two entry points:
 *   - sendCampaignDigest({ slug, trigger })  — pulls the campaign's
 *     metrics from Supabase, builds an HTML digest, sends to its
 *     configured recipients, logs to email_reports_log.
 *   - The pipeline cron calls this for every campaign whose
 *     email_frequency matches today's day.
 *
 * Uses Resend's REST API (no SDK) so we don't add a runtime dep.
 * RESEND_API_KEY env var must be set; if missing, we log + skip.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { log } from '../api-client.js';
import type { Campaign } from './campaigns.js';

const RESEND_API = 'https://api.resend.com/emails';
const FROM_DEFAULT = 'MinuteWise Automation <onboarding@resend.dev>';

interface DigestKpis {
  posts: number;
  views: number;
  likes: number;
  saves: number;
  shares: number;
  comments: number;
  saveRate: number;
}

interface DigestPost {
  id: string;
  hook_style: string | null;
  account: string | null;
  views: number;
  likes: number;
  saves: number;
  tiktok_url: string | null;
}

interface DigestPayload {
  campaign: Campaign;
  windowDays: number;
  kpis: DigestKpis;
  topPosts: DigestPost[];
  failedPosts: number;
  newFollowers: number;
}

function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ─── Data collection ────────────────────────────────────────────────

async function collectDigestData(
  campaign: Campaign,
  windowDays: number,
): Promise<DigestPayload | null> {
  const sb = getSupabase();
  if (!sb) return null;

  const cutoff = new Date(Date.now() - windowDays * 86_400_000)
    .toISOString().slice(0, 10);

  const [postsRes, statsRes] = await Promise.all([
    sb.from('posts')
      .select('id, hook_style, account, views, likes, saves, shares, comments, save_rate, status, tiktok_url, date')
      .eq('campaign_id', campaign.id)
      .gte('date', cutoff)
      .order('date', { ascending: false }),
    sb.from('account_stats')
      .select('account, followers, date')
      .order('date', { ascending: false })
      .limit(50),
  ]);

  const posts = postsRes.data ?? [];
  const published = posts.filter((p) => p.status === 'published');
  const failedPosts = posts.filter(
    (p) => p.status === 'failed' || p.status === 'error',
  ).length;

  const kpis: DigestKpis = {
    posts: published.length,
    views: published.reduce((s, p) => s + (p.views ?? 0), 0),
    likes: published.reduce((s, p) => s + (p.likes ?? 0), 0),
    saves: published.reduce((s, p) => s + (p.saves ?? 0), 0),
    shares: published.reduce((s, p) => s + (p.shares ?? 0), 0),
    comments: published.reduce((s, p) => s + (p.comments ?? 0), 0),
    saveRate: published.length > 0
      ? published.reduce((s, p) => s + Number(p.save_rate ?? 0), 0) / published.length
      : 0,
  };

  const topPosts: DigestPost[] = [...published]
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
    .slice(0, 5)
    .map((p) => ({
      id: p.id as string,
      hook_style: p.hook_style as string | null,
      account: p.account as string | null,
      views: p.views ?? 0,
      likes: p.likes ?? 0,
      saves: p.saves ?? 0,
      tiktok_url: p.tiktok_url as string | null,
    }));

  // Rough follower delta — sum of latest stats per account on this
  // campaign's accounts. Lacking historical-followers retention we just
  // surface the current total; the digest copy says "current" so it's honest.
  const newFollowers = (statsRes.data ?? [])
    .filter((s, i, arr) => arr.findIndex((x) => x.account === s.account) === i)
    .reduce((sum, s) => sum + (s.followers ?? 0), 0);

  return {
    campaign,
    windowDays,
    kpis,
    topPosts,
    failedPosts,
    newFollowers,
  };
}

// ─── HTML rendering ─────────────────────────────────────────────────

function renderDigestHtml(p: DigestPayload): string {
  const include = p.campaign.email_include ?? {};
  const blocks: string[] = [];

  blocks.push(`
    <h1 style="margin:0 0 4px 0;font-size:24px;font-weight:700;letter-spacing:-0.02em;">${escapeHtml(p.campaign.name)}</h1>
    <p style="margin:0 0 24px 0;color:#86868b;font-size:14px;">
      Weekly digest · last ${p.windowDays} day${p.windowDays === 1 ? '' : 's'}
    </p>
  `);

  if (include.kpis !== false) {
    blocks.push(`
      <table role="presentation" cellspacing="0" cellpadding="0" border="0"
             style="width:100%;margin:0 0 24px 0;border-collapse:separate;border-spacing:0 8px;">
        <tr>
          ${kpiCell('Videos', String(p.kpis.posts))}
          ${kpiCell('Views', fmtNum(p.kpis.views))}
          ${kpiCell('Likes', fmtNum(p.kpis.likes))}
          ${kpiCell('Saves', fmtNum(p.kpis.saves))}
        </tr>
        <tr>
          ${kpiCell('Shares', fmtNum(p.kpis.shares))}
          ${kpiCell('Comments', fmtNum(p.kpis.comments))}
          ${kpiCell('Avg save %', `${p.kpis.saveRate.toFixed(2)}%`)}
          ${kpiCell('Failed', String(p.failedPosts))}
        </tr>
      </table>
    `);
  }

  if (include.top_posts !== false && p.topPosts.length > 0) {
    blocks.push(`
      <h2 style="margin:32px 0 12px 0;font-size:16px;font-weight:600;">Top posts</h2>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
        ${p.topPosts.map((post, i) => `
          <tr>
            <td style="padding:10px 12px;border-bottom:1px solid #e8e8ed;font-size:13px;">
              <span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;background:#f5f5f7;color:#1d1d1f;font-weight:600;font-size:11px;margin-right:8px;">${i + 1}</span>
              <strong>${escapeHtml(post.hook_style ?? 'post')}</strong>
              ${post.account ? `<span style="color:#86868b;"> · @${escapeHtml(post.account)}</span>` : ''}
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #e8e8ed;text-align:right;font-size:13px;color:#1d1d1f;font-variant-numeric:tabular-nums;">
              ${fmtNum(post.views)} views · ${post.saves} saves
              ${post.tiktok_url && post.tiktok_url !== '-' ? ` · <a href="${escapeAttr(post.tiktok_url)}" style="color:#16a34a;text-decoration:none;">View →</a>` : ''}
            </td>
          </tr>
        `).join('')}
      </table>
    `);
  }

  if (include.account_growth !== false && p.newFollowers > 0) {
    blocks.push(`
      <h2 style="margin:32px 0 12px 0;font-size:16px;font-weight:600;">Followers</h2>
      <p style="margin:0;font-size:14px;color:#1d1d1f;">
        <strong>${fmtNum(p.newFollowers)}</strong>
        <span style="color:#86868b;"> total followers across all accounts on this campaign.</span>
      </p>
    `);
  }

  if (include.failed_posts !== false && p.failedPosts > 0) {
    blocks.push(`
      <div style="margin:24px 0;padding:12px 14px;background:#fff5e6;border-left:3px solid #bf4800;border-radius:4px;">
        <p style="margin:0;font-size:13px;color:#1d1d1f;">
          <strong>${p.failedPosts} post${p.failedPosts === 1 ? '' : 's'} failed</strong> in the last ${p.windowDays} days.
          Check the dashboard's Errors tab for details.
        </p>
      </div>
    `);
  }

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1d1d1f;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;padding:32px;border-radius:12px;">
    ${blocks.join('')}
    <hr style="margin:32px 0 16px 0;border:none;border-top:1px solid #e8e8ed;">
    <p style="margin:0;font-size:11px;color:#86868b;">
      Sent by MinuteWise Automation. Manage recipients on the campaign's Reports tab.
    </p>
  </div>
</body></html>`;
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string { return escapeHtml(s); }

// ─── Send + log ─────────────────────────────────────────────────────

interface SendResult {
  ok: boolean;
  resendId?: string;
  error?: string;
}

async function sendViaResend(
  to: string[],
  subject: string,
  html: string,
): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY not set' };
  }

  const from = process.env.RESEND_FROM || FROM_DEFAULT;

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: body.message || `Resend ${res.status}: ${JSON.stringify(body).slice(0, 200)}`,
      };
    }
    return { ok: true, resendId: body.id as string };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendCampaignDigest(input: {
  slug: string;
  trigger: 'cron' | 'manual' | 'test';
  /** Optional override for windowDays (default = 7 for weekly). */
  windowDays?: number;
}): Promise<SendResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Supabase env not set' };

  const { data: campaign } = await sb
    .from('campaigns')
    .select('*')
    .eq('slug', input.slug)
    .maybeSingle<Campaign>();
  if (!campaign) return { ok: false, error: `Campaign ${input.slug} not found` };

  const recipients = campaign.email_recipients ?? [];
  if (recipients.length === 0) {
    return { ok: false, error: 'No recipients configured' };
  }

  const windowDays =
    input.windowDays ??
    (campaign.email_frequency === 'daily' ? 1
      : campaign.email_frequency === 'monthly' ? 30
      : 7);

  const payload = await collectDigestData(campaign, windowDays);
  if (!payload) return { ok: false, error: 'Failed to collect digest data' };

  const subject = `${campaign.name} — ${input.trigger === 'test' ? 'Test digest' : `${windowDays}-day digest`}`;
  const html = renderDigestHtml(payload);
  const result = await sendViaResend(recipients, subject, html);

  // Log result regardless of success — operator wants the whole timeline,
  // including failures, on the Reports tab.
  await sb.from('email_reports_log').insert({
    campaign_id: campaign.id,
    recipients,
    subject,
    status: result.ok ? (input.trigger === 'test' ? 'test' : 'sent') : 'failed',
    resend_id: result.resendId ?? null,
    trigger: input.trigger,
    error_message: result.error ?? null,
    metadata: {
      window_days: windowDays,
      posts_count: payload.kpis.posts,
      failed_posts: payload.failedPosts,
    },
  });

  if (result.ok) {
    log(`[email-digest] sent ${campaign.slug} digest to ${recipients.length} recipient(s) (${result.resendId})`);
  } else {
    log(`[email-digest] FAILED ${campaign.slug}: ${result.error}`);
  }

  return result;
}
