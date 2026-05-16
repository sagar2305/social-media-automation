/**
 * Gemini-powered AI fixer — for PROPOSE/ASK/unknown tier errors where the
 * pipeline can't self-heal with a pre-written fix.
 *
 * Flow:
 *   1. Extract TypeScript file paths from the error stack trace
 *   2. Read those files (truncated to keep the prompt manageable)
 *   3. Call gemini-2.5-flash with error + code context → ask for a fix
 *   4. Parse structured JSON response: { files, description, confidence }
 *   5. If confidence ≥ medium, hand off to propose_executor which handles
 *      snapshot → apply → tsc verify → diff → proposal creation
 *
 * The proposal then appears in data/proposals/ and can be approved/rejected
 * from the dashboard or via `npx tsx scripts/auto_fix_proposals.ts approve <id>`.
 */

import { readFile, writeFile } from 'fs/promises';
import { applyPropose, type ProposeCandidate } from './propose_executor.js';
import type { ClassifiedError } from './classifier.js';

// ─── Config ───────────────────────────────────────────────────

const GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_FILE_LINES = 250;
const MAX_FILES = 4;

// ─── Types ────────────────────────────────────────────────────

interface GeminiFixResponse {
  description: string;
  confidence: 'high' | 'medium' | 'low';
  explanation: string;
  files: Array<{ path: string; newContent: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────

function extractFilePaths(stack: string): string[] {
  const seen = new Set<string>();
  // Match both "(path/to/file.ts:N:N)" and "at path/to/file.ts:N:N"
  const re = /(?:\(|at\s+)((?:[^()\s]+\/)?scripts\/[^():?\s]+\.ts):\d+:\d+/g;
  for (const m of stack.matchAll(re)) {
    const p = m[1];
    if (!p.includes('node_modules') && !seen.has(p)) seen.add(p);
    if (seen.size >= MAX_FILES) break;
  }
  return [...seen];
}

async function readFileSafe(path: string): Promise<string | null> {
  try {
    const content = await readFile(path, 'utf-8');
    const lines = content.split('\n');
    if (lines.length > MAX_FILE_LINES) {
      return (
        lines.slice(0, MAX_FILE_LINES).join('\n') +
        `\n// ... truncated (${lines.length} total lines)`
      );
    }
    return content;
  } catch {
    return null;
  }
}

async function callGemini(
  apiKey: string,
  prompt: string,
): Promise<GeminiFixResponse | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      }),
    });
  } catch (err) {
    console.log(`[gemini_fixer] network error: ${err}`);
    return null;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.log(`[gemini_fixer] Gemini ${res.status}: ${body.slice(0, 200)}`);
    return null;
  }

  const json = (await res.json()) as any;
  const rawText: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    console.log('[gemini_fixer] empty response from Gemini');
    return null;
  }

  try {
    return JSON.parse(rawText) as GeminiFixResponse;
  } catch {
    console.log('[gemini_fixer] could not parse Gemini JSON response');
    return null;
  }
}

// ─── Main entry point ────────────────────────────────────────

/**
 * Attempt to generate and stage an AI fix for a classified error.
 *
 * Call this when tier is PROPOSE, ASK, or UNKNOWN — i.e. the catalog knows
 * something needs to change but hasn't provided a hand-written apply() fn.
 * Silently no-ops if Gemini can't produce a confident fix.
 */
export async function runGeminiFix(
  classified: ClassifiedError,
  originalError: Error,
): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('[gemini_fixer] GEMINI_API_KEY not set — skipping AI fix');
    return;
  }

  const stack = originalError.stack ?? originalError.message;
  const filePaths = extractFilePaths(stack);

  if (filePaths.length === 0) {
    console.log('[gemini_fixer] no project file paths in stack trace — skipping');
    return;
  }

  // Read relevant source files
  const fileContents: Array<{ path: string; content: string }> = [];
  for (const p of filePaths) {
    const content = await readFileSafe(p);
    if (content) fileContents.push({ path: p, content });
  }

  if (fileContents.length === 0) {
    console.log('[gemini_fixer] could not read any source files — skipping');
    return;
  }

  const filesSection = fileContents
    .map((f) => `### ${f.path}\n\`\`\`typescript\n${f.content}\n\`\`\``)
    .join('\n\n');

  const prompt = `You are an expert TypeScript developer fixing a bug in a TikTok social media automation pipeline.

An error occurred at runtime. Your job: identify the root cause in the source files and return a minimal fix.

## Error
\`\`\`
${stack.slice(0, 3000)}
\`\`\`

## Catalog hint (suggested fix direction)
${classified.action}

## Source files
${filesSection}

## Rules
- Change as few lines as possible — surgical fix only
- Only include files that actually need to change
- Do NOT add comments, logging, or extra features
- The output must be valid TypeScript that compiles with strict mode
- If you cannot determine a confident fix, set confidence to "low" and return empty files array

Return JSON matching this schema exactly:
{
  "description": "one-line summary of the fix (under 80 chars)",
  "confidence": "high" | "medium" | "low",
  "explanation": "root cause and why your fix resolves it",
  "files": [
    {
      "path": "relative/path/to/file.ts",
      "newContent": "complete new file content after fix"
    }
  ]
}`;

  console.log(`[gemini_fixer] asking Gemini to fix: ${classified.signature}`);
  const fix = await callGemini(apiKey, prompt);

  if (!fix) return;

  if (fix.confidence === 'low' || !fix.files?.length) {
    console.log(`[gemini_fixer] low confidence — not staging proposal. Explanation: ${fix.explanation?.slice(0, 200)}`);
    return;
  }

  console.log(`[gemini_fixer] confidence=${fix.confidence} — staging proposal: ${fix.description}`);

  // Force tier to PROPOSE so propose_executor accepts it (the caller may have
  // an ASK/UNKNOWN tier, but the AI-generated fix still goes through the same
  // snapshot → verify → diff → human-review pipeline as any PROPOSE fix).
  const proposable: ClassifiedError = { ...classified, tier: 'PROPOSE' };

  const candidate: ProposeCandidate = {
    files: fix.files.map((f) => f.path),
    description: `[AI] ${fix.description}`,
    apply: async () => {
      for (const f of fix.files) {
        await writeFile(f.path, f.newContent, 'utf-8');
      }
    },
  };

  const outcome = await applyPropose(proposable, candidate);
  console.log(`[gemini_fixer] outcome=${outcome.result}`);
  if (outcome.result === 'proposed') {
    console.log(`[gemini_fixer] proposal staged: ${outcome.id}`);
    console.log(`  Approve: npx tsx scripts/auto_fix_proposals.ts approve ${outcome.id}`);
    console.log(`  Reject:  npx tsx scripts/auto_fix_proposals.ts reject ${outcome.id}`);
  } else if (outcome.result === 'rolled-back') {
    console.log(`[gemini_fixer] fix failed tsc verify — rolled back. ${outcome.reason}`);
  }
}
