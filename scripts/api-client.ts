import { config } from '../config/config.js';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  formData?: FormData;
  maxRetries?: number;
}

type ApiService = 'virlo' | 'scrapeCreators' | 'blotato';

interface RateLimitState {
  requests: number[];
  maxPerHour: number;
}

const rateLimits: Record<string, RateLimitState> = {
  blotato: { requests: [], maxPerHour: 1800 }, // 30/min = 1800/hour
  scrapeCreators: { requests: [], maxPerHour: 120 },
};

function cleanOldRequests(state: RateLimitState): void {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  state.requests = state.requests.filter((t) => t > oneHourAgo);
}

async function waitForRateLimit(service: string): Promise<void> {
  const state = rateLimits[service];
  if (!state) return;

  cleanOldRequests(state);
  if (state.requests.length >= state.maxPerHour) {
    const oldestInWindow = state.requests[0];
    const waitMs = oldestInWindow + 60 * 60 * 1000 - Date.now() + 1000;
    console.log(`[rate-limit] ${service}: waiting ${Math.round(waitMs / 1000)}s`);
    await new Promise((r) => setTimeout(r, waitMs));
    cleanOldRequests(state);
  }
  state.requests.push(Date.now());
}

function getAuthHeader(service: ApiService): Record<string, string> {
  switch (service) {
    case 'virlo':
      return { Authorization: `Bearer ${config.virlo.apiKey}` };
    case 'scrapeCreators':
      return { 'x-api-key': config.scrapeCreators.apiKey };
    case 'blotato':
      return { 'blotato-api-key': config.blotato.apiKey };
  }
}

function getBaseUrl(service: ApiService): string {
  return config[service].baseUrl;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Distil an error-response body to something readable. When upstream APIs
 * (Blotato Cloudflare challenges, auth-wall redirects, maintenance pages,
 * default nginx 4xx/5xx pages) return HTML, dumping the full <!DOCTYPE>
 * blob into logs and the dashboard's cycle_events detail field is useless
 * noise. Extract the <title> (or first <h1>) instead and report the byte
 * size so the operator knows it WAS HTML, not a partial JSON parse.
 * Plain-text / JSON bodies are returned as-is, truncated to 500 chars.
 */
function summariseErrorBody(body: string, contentType: string | null): string {
  const trimmed = body.trim();
  const isHtml = contentType?.toLowerCase().includes('text/html') || trimmed.startsWith('<');
  if (!isHtml) {
    return trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed;
  }
  const title = trimmed.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
  const h1 = trimmed.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const label = title || h1 || 'HTML response (no title)';
  return `${label} (HTML error page, ${trimmed.length} bytes)`;
}

export async function apiRequest<T>(
  service: ApiService,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, headers = {}, formData } = options;
  // `maxRetries` is mutable — catalog can clamp it after the first failure.
  let maxRetries = options.maxRetries ?? 3;

  if (rateLimits[service]) {
    await waitForRateLimit(service);
  }

  const url = `${getBaseUrl(service)}${path}`;
  const authHeaders = getAuthHeader(service);

  const fetchOptions: RequestInit = {
    method,
    headers: {
      ...authHeaders,
      ...(body && !formData ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
  };

  if (formData) {
    fetchOptions.body = formData;
  } else if (body) {
    fetchOptions.body = JSON.stringify(body);
  }

  let lastError: Error | null = null;
  let lastStatus: number | null = null;
  // Catalog-driven retry decision. Starts null; gets set after the first
  // classified failure so subsequent attempts can consult it.
  let catalogDecision: { waitMs: number; maxAttempts: number; shouldRetry: boolean } | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, fetchOptions);

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : 60_000;
        console.log(`[${service}] Rate limited, waiting ${Math.round(waitMs / 1000)}s...`);
        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        lastStatus = response.status;
        const errorBody = await response.text();
        const summary = summariseErrorBody(errorBody, response.headers.get('content-type'));
        throw new Error(`${service} ${method} ${path} → ${response.status}: ${summary}`);
      }

      // Defensive: some APIs (notably Blotato under Cloudflare challenges)
      // return 200 OK with an HTML body. response.json() throws SyntaxError
      // and the caller never knows why. Sniff the body and fail fast with a
      // clear message instead of letting the JSON parser garble it.
      const contentType = response.headers.get('content-type');
      const rawText = await response.text();
      if (contentType?.toLowerCase().includes('text/html') || rawText.trimStart().startsWith('<')) {
        const summary = summariseErrorBody(rawText, contentType);
        throw new Error(`${service} ${method} ${path} → ${response.status}: expected JSON but got ${summary}`);
      }
      return JSON.parse(rawText) as T;
    } catch (error) {
      lastError = error as Error;

      // Classify on first failure; plan the rest of the retry loop.
      if (!catalogDecision) {
        try {
          const { classifyError } = await import('./auto_fix/classifier.js');
          const { planRetry } = await import('./auto_fix/retry_planner.js');
          const classified = classifyError(lastError, {
            source: service as any,
            url,
            status: lastStatus ?? undefined,
          });
          const plan = await planRetry(classified, attempt);
          catalogDecision = plan;
          if (plan.maxAttempts === 1 || !plan.shouldRetry) {
            console.log(`[${service}] ${plan.reason} — not retrying`);
            break;
          }
          if (plan.maxAttempts > 0) {
            // Honour catalog cap (clamped to the caller's maxRetries).
            maxRetries = Math.min(maxRetries, plan.maxAttempts);
          }
        } catch {
          // Auto-fix module failure — fall through to default behaviour.
        }
      }

      if (attempt < maxRetries) {
        // Upstream errors (Heroku/nginx 499, 5xx) need longer than the
        // default exponential 1s/2s/4s — a Heroku dyno cold-start or
        // redeploy typically takes 15-30s. Give it real time to recover.
        const isUpstream = lastStatus === 499 || (lastStatus !== null && lastStatus >= 500);
        const defaultBackoff = isUpstream
          ? 15_000 + (attempt - 1) * 5_000           // 15s, 20s, 25s
          : Math.min(1000 * 2 ** (attempt - 1), 30_000); // 1s, 2s, 4s
        const waitMs = catalogDecision?.waitMs ?? defaultBackoff;
        console.log(`[${service}] Attempt ${attempt} failed${lastStatus ? ` (${lastStatus})` : ''}, retrying in ${Math.round(waitMs / 1000)}s...`);
        await sleep(waitMs);
      }
    }
  }

  // Final failure — classify + log + breaker before rethrow. Swallow any
  // auto_fix errors so we never mask the original API failure.
  try {
    const { classifyError } = await import('./auto_fix/classifier.js');
    const { logClassified } = await import('./auto_fix/audit_logger.js');
    const { recordAttempt } = await import('./auto_fix/circuit_breaker.js');
    const classified = classifyError(lastError, {
      source: service as any,
      url,
      status: lastStatus ?? undefined,
    });
    // Record the failed-call attempt so repeated failures eventually trip
    // the breaker. recordAttempt itself returns 'tripped' on threshold,
    // which the planRetry path also detects via isTripped on the next call.
    await recordAttempt(classified.signature);
    await logClassified(classified);
    const { maybeNotify } = await import('./auto_fix/notifier.js');
    await maybeNotify(classified);
    // For errors the catalog says need a code fix, ask Gemini to generate one.
    // Off by default — transient API failures shouldn't trigger paid Gemini
    // calls. Set AUTO_FIX_GEMINI=1 to opt in once the catalog is stable enough
    // that PROPOSE/ASK/UNKNOWN truly means "this needs a human-readable fix".
    if (
      process.env.AUTO_FIX_GEMINI === '1' &&
      ['PROPOSE', 'ASK', 'UNKNOWN'].includes(classified.tier as string)
    ) {
      const { runGeminiFix } = await import('./auto_fix/gemini_fixer.js');
      await runGeminiFix(classified, lastError!).catch(() => {});
    }
  } catch {
    // never let the audit path mask the real error
  }

  throw lastError!;
}

export async function downloadFile(url: string, destPath: string): Promise<void> {
  const fs = await import('fs/promises');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destPath, buffer);
}

export function log(message: string): void {
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`[${timestamp}] ${message}`);
}
