/**
 * Notifier — surfaces high-priority classified errors to the human.
 *
 * Channels (first configured wins):
 *   1. Slack incoming webhook  →  SLACK_ALERT_WEBHOOK in .env.local
 *   2. File fallback            →  data/auto-fix-alerts.md (always on)
 *
 * Firing rules:
 *   - Always alerts on tier HUMAN-ONLY, ASK, UNKNOWN.
 *   - Skips RETRY (transient, recovers on its own) and AUTO-FIX (no human
 *     attention needed) to avoid notification fatigue.
 *   - Deduplicates: skips if the same signature was already alerted within
 *     DEDUP_WINDOW_MS.
 */

import { readFile, writeFile, mkdir, appendFile } from 'fs/promises';
import { dirname } from 'path';
import type { ClassifiedError } from './classifier.js';

const FILE_PATH = 'data/auto-fix-alerts.md';
const DEDUP_STATE_PATH = 'data/auto-fix-alerts.state.json';
const DEDUP_WINDOW_MS = 30 * 60 * 1000; // 30 min

const ALERT_TIERS = new Set<ClassifiedError['tier']>(['HUMAN-ONLY', 'ASK', 'UNKNOWN']);

// ─── Dedup state (per-signature last-alerted timestamp) ─────

interface DedupState {
  [signature: string]: number; // ms since epoch
}

async function loadDedup(): Promise<DedupState> {
  try {
    return JSON.parse(await readFile(DEDUP_STATE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

async function saveDedup(state: DedupState): Promise<void> {
  await mkdir(dirname(DEDUP_STATE_PATH), { recursive: true });
  await writeFile(DEDUP_STATE_PATH, JSON.stringify(state, null, 2));
}

function shouldSkipAsDedup(state: DedupState, signature: string): boolean {
  const last = state[signature];
  if (!last) return false;
  return Date.now() - last < DEDUP_WINDOW_MS;
}

// ─── Channel: Slack ─────────────────────────────────────────

async function sendSlack(webhook: string, text: string): Promise<void> {
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`Slack webhook ${res.status}: ${await res.text()}`);
  } catch (err) {
    // Fall back to file if Slack fails
    await appendFileFallback(`[slack-failed] ${err}\n${text}`);
  }
}

// ─── Channel: File ──────────────────────────────────────────

async function appendFileFallback(text: string): Promise<void> {
  await mkdir(dirname(FILE_PATH), { recursive: true });
  const ts = new Date().toISOString();
  await appendFile(FILE_PATH, `\n---\n_${ts}_\n\n${text}\n`);
}

// ─── Formatting ─────────────────────────────────────────────

function formatAlert(c: ClassifiedError): string {
  const emoji = c.tier === 'HUMAN-ONLY' ? '🚨' : c.tier === 'ASK' ? '❓' : '⚠️';
  const lines = [
    `${emoji} *[${c.tier}]* ${c.source}${c.status ? ` (HTTP ${c.status})` : ''}`,
    `*Signature:* \`${c.signature}\``,
    `*Error:* ${c.message.slice(0, 500)}${c.message.length > 500 ? '…' : ''}`,
    `*Suggested action:* ${c.action}`,
  ];
  if (c.entry?.docs) lines.push(`*Docs:* ${c.entry.docs}`);
  if (c.requestUrl) lines.push(`*URL:* ${c.requestUrl}`);
  return lines.join('\n');
}

// ─── Public entry point ─────────────────────────────────────

export async function maybeNotify(c: ClassifiedError): Promise<'sent' | 'skipped-tier' | 'skipped-dedup'> {
  if (!ALERT_TIERS.has(c.tier)) return 'skipped-tier';

  const state = await loadDedup();
  if (shouldSkipAsDedup(state, c.signature)) return 'skipped-dedup';

  const text = formatAlert(c);
  const webhook = process.env.SLACK_ALERT_WEBHOOK;
  if (webhook) {
    await sendSlack(webhook, text);
  } else {
    await appendFileFallback(text);
  }

  state[c.signature] = Date.now();
  // Trim old entries (older than 24h) while we're here
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  for (const sig of Object.keys(state)) {
    if (state[sig] < dayAgo) delete state[sig];
  }
  await saveDedup(state);

  return 'sent';
}
