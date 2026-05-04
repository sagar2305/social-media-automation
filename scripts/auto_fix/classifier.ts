/**
 * Error classifier — normalises any error (Error instance, fetch rejection,
 * non-OK response body) into a ClassifiedError record. Infers the upstream
 * source from request URL when the caller doesn't pass one.
 *
 * The classifier is pure — no I/O, no state mutation. It's safe to call from
 * any catch block. All side effects (logging, notifying, retrying) live in
 * other modules that consume this result.
 */

import {
  ERROR_CATALOG,
  lookupCatalogEntry,
  signatureFor,
  type CatalogEntry,
  type ErrorSource,
  type ActionTier,
} from './error_catalog.js';

// ─── Types ────────────────────────────────────────────────────

export interface ClassifyContext {
  /** Known upstream source. If omitted, we'll try to infer from `url`. */
  source?: ErrorSource;
  /** Request URL that produced the error. Used to infer source. */
  url?: string;
  /** Known HTTP status. If omitted, we'll try to extract from the error message. */
  status?: number;
}

export interface ClassifiedError {
  source: ErrorSource;
  status: number | null;
  /** Trimmed, whitespace-collapsed error text used for matching and logging. */
  message: string;
  /** Full original error text (useful for audit log). */
  rawMessage: string;
  entry: CatalogEntry | null;
  tier: ActionTier | 'UNKNOWN';
  action: string;
  /** Stable id for circuit-breaker / dedup state. */
  signature: string;
  requestUrl?: string;
}

// ─── URL → source inference ──────────────────────────────────

// Order matters — more specific hosts first.
const URL_SOURCE_MAP: Array<{ pattern: RegExp; source: ErrorSource }> = [
  { pattern: /generativelanguage\.googleapis\.com/i, source: 'gemini' },
  { pattern: /backend\.blotato\.com|database\.blotato\.io/i, source: 'blotato' },
  { pattern: /api\.scrapecreators\.com/i, source: 'scrapeCreators' },
  { pattern: /api\.virlo\.(ai|io)/i, source: 'virlo' },
  { pattern: /tmpfiles\.org/i, source: 'tmpfiles' },
  { pattern: /catbox\.moe/i, source: 'catbox' },
  { pattern: /tiktokapis|tiktok\.com/i, source: 'tiktok' },
];

function inferSourceFromUrl(url?: string): ErrorSource {
  if (!url) return 'unknown';
  for (const { pattern, source } of URL_SOURCE_MAP) {
    if (pattern.test(url)) return source;
  }
  return 'unknown';
}

// ─── Message-based source inference (fallback) ───────────────

// Matches the api-client error format: `${service} ${method} ${path} → ${status}: ${body}`.
// We stamp the service name at the start, so parsing it out is cheap and unambiguous.
const API_CLIENT_PREFIX_RE = /^(blotato|gemini|virlo|scrapeCreators)\s+/i;

// POSIX errno codes + Node-specific local-error markers. Anything matching
// here is a local (non-API) error and should be classified accordingly so
// the dashboard can split "API errors" from "local errors".
const LOCAL_ERROR_RE =
  /\b(?:ENOENT|EACCES|ENOSPC|EMFILE|EBUSY|EISDIR|ENOTDIR|EEXIST|EAGAIN|ETIMEDOUT)\b|Cannot find module|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|SyntaxError.*JSON|Unexpected token.*in JSON|Command failed:|spawn .* ENOENT/i;

function inferSourceFromMessage(message: string): ErrorSource {
  const m = message.match(API_CLIENT_PREFIX_RE);
  if (m) return m[1].toLowerCase() as ErrorSource;
  // Fallback: search common host-name fragments inside the body
  if (/Gemini API \d+:/i.test(message)) return 'gemini';
  if (/blotato/i.test(message)) return 'blotato';
  if (/scrapecreators/i.test(message)) return 'scrapeCreators';
  if (/tmpfiles/i.test(message)) return 'tmpfiles';
  if (/catbox/i.test(message)) return 'catbox';
  if (LOCAL_ERROR_RE.test(message)) return 'local';
  return 'unknown';
}

// ─── Status code extraction ──────────────────────────────────

const STATUS_PATTERNS = [
  /→\s*(\d{3})\s*:/, // api-client format: "... → 429: { ... }"
  /API\s+(\d{3})\s*:/i, // "Gemini API 429: ..."
  /HTTP\s+(\d{3})/i, // "HTTP 502"
  /status[":\s]+(\d{3})/i, // "status: 429" or "\"status\": 429"
  /upload failed:\s*(\d{3})/i, // "tmpfiles upload failed: 502"
];

function extractStatus(message: string): number | null {
  for (const re of STATUS_PATTERNS) {
    const m = message.match(re);
    if (m) {
      const n = parseInt(m[1]);
      if (!isNaN(n) && n >= 100 && n < 600) return n;
    }
  }
  return null;
}

// ─── Error normalisation ─────────────────────────────────────

function normaliseError(error: unknown): { message: string; rawMessage: string } {
  let rawMessage: string;
  if (error instanceof Error) rawMessage = `${error.name}: ${error.message}`;
  else if (typeof error === 'string') rawMessage = error;
  else if (error && typeof error === 'object' && 'message' in error) {
    rawMessage = String((error as { message: unknown }).message);
  } else {
    rawMessage = String(error);
  }
  const message = rawMessage.replace(/\s+/g, ' ').trim().slice(0, 2000);
  return { message, rawMessage };
}

// ─── Public entry point ──────────────────────────────────────

export function classifyError(error: unknown, context: ClassifyContext = {}): ClassifiedError {
  const { message, rawMessage } = normaliseError(error);

  const inferredSource: ErrorSource =
    context.source && context.source !== 'unknown'
      ? context.source
      : inferSourceFromUrl(context.url) !== 'unknown'
        ? inferSourceFromUrl(context.url)
        : inferSourceFromMessage(message);

  const status = context.status ?? extractStatus(message);

  const entry = lookupCatalogEntry({ message, source: inferredSource, status: status ?? undefined });
  const signature = signatureFor(entry, message);

  // When a catalog entry matches, its `source` is authoritative — it's set
  // by hand and knows the difference between e.g. 'local' (a file/parse
  // error) and 'unknown' (we genuinely could not classify the origin).
  const source: ErrorSource = entry?.source ?? inferredSource;

  return {
    source,
    status,
    message,
    rawMessage,
    entry,
    tier: entry?.tier ?? 'UNKNOWN',
    action: entry?.action ?? 'Unknown error — manual investigation required.',
    signature,
    requestUrl: context.url,
  };
}

// ─── Convenience for humans reading logs ─────────────────────

export function formatClassified(c: ClassifiedError): string {
  const parts = [
    `[${c.tier}]`,
    c.source !== 'unknown' ? c.source : null,
    c.status ? `HTTP ${c.status}` : null,
    `"${c.message.slice(0, 120)}${c.message.length > 120 ? '…' : ''}"`,
    `→ ${c.action}`,
  ].filter(Boolean);
  return parts.join(' ');
}

// Re-export tier/source types for downstream modules
export type { ErrorSource, ActionTier } from './error_catalog.js';

// Guard: fail loudly if the catalog is empty (misconfiguration).
if (ERROR_CATALOG.length === 0) {
  throw new Error('auto_fix: ERROR_CATALOG is empty. Classifier cannot function.');
}
