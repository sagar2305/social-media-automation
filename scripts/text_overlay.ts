import { readFile } from 'fs/promises';
import { config, FlowType } from '../config/config.js';
import { log } from './api-client.js';
import { dataPath, getCampaignSlug } from './lib/campaign-paths.js';
import { getCampaign } from './lib/campaigns.js';

type HookStyle = 'question' | 'bold_claim' | 'story_opener' | 'stat_lead' | 'contrast';

interface SlideContent {
  role: 'hook' | 'knowledge_gap' | 'value' | 'minutewise' | 'emotional' | 'cta' | 'problem' | 'tip' | 'resolution';
  top: string;
  center: string;
  bottom: string;
  emoji?: string;
}

export interface GeneratedContent {
  title: string;
  slides: SlideContent[];
  caption: string;
  hashtags: string[];
  hookStyle: HookStyle;
  experiment: ExperimentVariant | null;
  metadata: PostMetadata;
  useCta: boolean;
  flow: FlowType;
  accountIndex: number;
}

export interface PostMetadata {
  hookStyle: HookStyle;
  format: string;
  hashtags: string[];
  experimentId: string | null;
  variant: 'A' | 'B' | null;
  createdAt: string;
  flow: FlowType;
  account: string;
}

interface ExperimentVariant {
  experimentId: string;
  variant: 'A' | 'B';
  hookStyle: HookStyle;
}

interface CsvTemplate {
  name: string;
  category: string;
  slides: { top: string; center: string; bottom: string }[];
  referenceUrl: string;
  isActive: boolean;
}

// ─── CSV Parsing ───────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCsvTemplates(csv: string): CsvTemplate[] {
  const lines = csv.split('\n');
  if (lines.length < 2) return [];
  const templates: CsvTemplate[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    if (fields.length < 16) continue;
    const name = fields[1] || '';
    const category = fields[3] || '';
    const isActive = fields[9] === 'true';
    const referenceUrl = fields[11] || '';
    const slides: { top: string; center: string; bottom: string }[] = [];
    for (let s = 0; s < 10; s++) {
      const baseIdx = 15 + s * 3;
      if (baseIdx + 2 >= fields.length) break;
      const top = fields[baseIdx] || '';
      const center = fields[baseIdx + 1] || '';
      const bottom = fields[baseIdx + 2] || '';
      if (!top && !center && !bottom) continue;
      slides.push({ top, center, bottom });
    }
    if (slides.length > 0) templates.push({ name, category, slides, referenceUrl, isActive });
  }
  return templates;
}

// ─── Helpers ───────────────────────────────────────────────────

async function readMemoryFile(filename: string): Promise<string> {
  try { return await readFile(dataPath(filename), 'utf-8'); }
  catch { return ''; }
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function classifyHookStyle(title: string): HookStyle {
  const lower = title.toLowerCase();
  if (lower.includes('?')) return 'question';
  if (lower.includes('wish i knew') || lower.includes('changed my') || lower.includes('secret') || lower.includes('tried')) return 'story_opener';
  if (lower.includes('stop') || lower.includes('not') || lower.includes('don\'t') || lower.includes('vs') || lower.includes('forget')) return 'contrast';
  if (/\d+%|\d+\.\d|\btop \d|4\.0|gpa/i.test(lower)) return 'stat_lead';
  return 'bold_claim';
}

// ─── Slide Role Assignment ─────────────────────────────────────
// Enforces EXACTLY 8 slides per post.
//
// Two filler banks live below. Both are intentionally GENERIC (no brand
// mention) because filler is per-post-type, not per-campaign — when a
// CSV/Gemini template returns < TARGET_SLIDE_COUNT slides we want to top
// up without painting another campaign's posts with MinuteWise copy. The
// per-campaign brand mention is owned by the CTA slide (last slide), which
// uses campaign.name dynamically (see resolveCtaText below).
//
// Historical note: this used to be MINUTEWISE_FILLER_SLIDES with copy like
// "Minutewise AI / Records and transcribes lectures…" — that bled
// MinuteWise brand text into RoastAI posts when Gemini returned a short
// response. Multi-campaign Phase 17.

const GENERIC_FILLER_SLIDES: { top: string; center: string; bottom: string }[] = [
  {
    top: 'Most people skip this',
    center: 'It takes 30 seconds and changes the next hour completely.',
    bottom: 'Try it once.',
  },
  {
    top: 'Here is the trick',
    center: 'Stop trying to remember everything. Build a system that does it for you.',
    bottom: 'Future-you will thank you.',
  },
  {
    top: 'Why this works',
    center: 'Your brain is great at thinking, terrible at storing.',
    bottom: 'Outsource the storage.',
  },
  {
    top: 'The pattern',
    center: 'Capture once. Review on a schedule. Watch it stick.',
    bottom: 'That is it.',
  },
  {
    top: 'One small habit',
    center: 'Two minutes at the end of every session, written down.',
    bottom: 'Compounds fast.',
  },
  {
    top: 'Forget perfect',
    center: 'Done and reviewed beats polished and forgotten.',
    bottom: 'Every time.',
  },
  {
    top: 'Trust the process',
    center: 'You will not see the gains for two weeks. Then it clicks.',
    bottom: 'Stay with it.',
  },
  {
    top: 'You already know',
    center: 'The hard part is not learning the trick. It is doing the trick.',
    bottom: 'Start now.',
  },
];

const TARGET_SLIDE_COUNT = 6;

/**
 * Build the CTA slide text for the given campaign.
 * - top:    "Download <campaign.name>" so the brand name appears verbatim.
 * - center: short tagline; first sentence of campaign.description, capped.
 * - bottom: "Available on App Store" by default (most campaigns are apps).
 *
 * Falls back to MinuteWise wording only when no campaign was loaded
 * (Supabase down at cycle start). Without this every campaign's CTA
 * slide said "Download Minutewise" verbatim — that's the bug we're
 * fixing.
 */
function resolveCtaText(campaignName: string | null, campaignDescription: string | null): {
  top: string; center: string; bottom: string;
} {
  if (!campaignName) {
    return {
      top: 'Download Minutewise',
      center: 'Your AI Note Taker',
      bottom: 'Available on App Store',
    };
  }
  // Take the first sentence of description as a tagline, cap at ~40 chars
  // so it fits on a TikTok slide. Strips trailing punctuation.
  let tagline = '';
  if (campaignDescription) {
    const firstSentence = campaignDescription.split(/[.!?]/)[0]?.trim() ?? '';
    tagline = firstSentence.length > 40 ? firstSentence.slice(0, 40).trim() + '…' : firstSentence;
  }
  return {
    top: `Download ${campaignName}`,
    center: tagline || `Try ${campaignName} now`,
    bottom: 'Available on App Store',
  };
}

function assignSlideRoles(
  slides: { top: string; center: string; bottom: string }[],
  campaignName: string | null,
  campaignDescription: string | null,
): SlideContent[] {
  const result: SlideContent[] = [];

  // Use template slides first (5 content slides). The "is this a brand
  // mention slide?" detection now compares against the active campaign's
  // name (or 'minutewise' as the legacy default) instead of being
  // hardcoded — keeps the role labelling honest across campaigns.
  const brandTokens: string[] = [];
  if (campaignName) brandTokens.push(campaignName.toLowerCase());
  brandTokens.push('minutewise', 'minute wise'); // legacy back-compat

  for (let i = 0; i < slides.length && result.length < TARGET_SLIDE_COUNT - 1; i++) {
    const s = slides[i];
    const text = [s.top, s.center, s.bottom].join(' ').toLowerCase();
    const isBrandMention = brandTokens.some(t => text.includes(t));

    let role: SlideContent['role'];
    if (result.length === 0) {
      role = 'hook';
    } else if (result.length === 1) {
      role = 'knowledge_gap';
    } else if (isBrandMention) {
      role = 'minutewise'; // role enum kept as 'minutewise' for back-compat with downstream classifiers
    } else {
      role = 'value';
    }

    result.push({ role, top: s.top, center: s.center, bottom: s.bottom });
  }

  // Pad with GENERIC (non-branded) filler if Gemini/CSV returned too few
  // slides. We deliberately don't promote any product here — the CTA slide
  // is the one and only place the brand appears.
  let fillerIdx = 0;
  while (result.length < TARGET_SLIDE_COUNT - 1) {
    const filler = GENERIC_FILLER_SLIDES[fillerIdx % GENERIC_FILLER_SLIDES.length];
    fillerIdx++;
    result.push({ role: 'value', top: filler.top, center: filler.center, bottom: filler.bottom });
  }

  // Final slide: CTA — uses campaign.name. The actual image is rendered
  // by generate_images.ts which substitutes campaign.cta_image_url
  // verbatim when the campaign uploaded one.
  result.push({ role: 'cta', ...resolveCtaText(campaignName, campaignDescription) });

  return result;
}

// ─── Flow 3: Emoji Overlay — Narrative Arc + Emoji Reactions ──
// Slide 1: Hook, Slides 2-3: Problem, Slides 4-6: Tips, Slide 7: Resolution, Slide 8: CTA

const EMOJI_MAP: Record<string, string> = {
  hook: '🤔',
  problem: '😰',
  tip: '💡',
  resolution: '🔥',
  cta: '👉',
};

// Generic, NON-DOMAIN-SPECIFIC fallback fillers. Used only when Gemini
// returned fewer slides than the narrative arc needs. Earlier these were
// study-themed ("3 hours on notes / can't remember for the exam") which
// leaked into every campaign that hit the fallback. Now they read as
// universal struggles + universal advice so they fit roast brands,
// finance brands, study brands, etc. equally well — the campaign-specific
// content always comes from Gemini using `campaign.description`; this
// only steps in when Gemini under-delivered.

const PROBLEM_FILLER_SLIDES: { top: string; center: string; bottom: string }[] = [
  {
    top: 'Sound familiar?',
    center: 'You keep doing the same thing and getting the same result.',
    bottom: 'There has to be a better way.',
  },
  {
    top: 'The struggle is real',
    center: 'Putting in hours and feeling like nothing sticks.',
    bottom: 'You\'re not alone.',
  },
];

const TIP_FILLER_SLIDES: { top: string; center: string; bottom: string }[] = [
  {
    top: 'Start ridiculously small',
    center: 'Two minutes a day beats two hours once a month. Pick the version you can\'t fail at.',
    bottom: 'Then stack from there.',
  },
  {
    top: 'Make it a system',
    center: 'A repeatable trigger + a clear next step. Decisions are expensive; routines are free.',
    bottom: 'Stop relying on motivation.',
  },
  {
    top: 'Two-minute summary',
    center: 'At the end of each session, write three bullets in your own words.',
    bottom: 'Cheap, fast, sticky.',
  },
];

function assignEmojiFlowRoles(
  slides: { top: string; center: string; bottom: string }[],
  campaignName: string | null,
  campaignDescription: string | null,
): SlideContent[] {
  const result: SlideContent[] = [];
  const available = [...slides];

  // Slide 1: Hook
  if (available.length > 0) {
    const s = available.shift()!;
    result.push({ role: 'hook', top: s.top, center: s.center, bottom: s.bottom, emoji: EMOJI_MAP.hook });
  }

  // Slide 2: Problem
  if (available.length > 0) {
    const s = available.shift()!;
    result.push({ role: 'problem', top: s.top, center: s.center, bottom: s.bottom, emoji: EMOJI_MAP.problem });
  } else {
    const filler = PROBLEM_FILLER_SLIDES[0];
    result.push({ role: 'problem', top: filler.top, center: filler.center, bottom: filler.bottom, emoji: EMOJI_MAP.problem });
  }

  // Slides 3-4: Tips
  for (let i = 0; i < 2; i++) {
    if (available.length > 0) {
      const s = available.shift()!;
      result.push({ role: 'tip', top: s.top, center: s.center, bottom: s.bottom, emoji: EMOJI_MAP.tip });
    } else {
      const filler = TIP_FILLER_SLIDES[i % TIP_FILLER_SLIDES.length];
      result.push({ role: 'tip', top: filler.top, center: filler.center, bottom: filler.bottom, emoji: EMOJI_MAP.tip });
    }
  }

  // Slide 5: Resolution — generic + campaign-aware nudge.
  if (available.length > 0) {
    const s = available.shift()!;
    result.push({ role: 'resolution', top: s.top, center: s.center, bottom: s.bottom, emoji: EMOJI_MAP.resolution });
  } else {
    const nudge = campaignName ? `Try ${campaignName} — it helps.` : 'Start with the smallest version today.';
    result.push({
      role: 'resolution',
      top: 'You\'ve got this',
      center: 'With the right system, the work shrinks and the results compound.',
      bottom: nudge,
      emoji: EMOJI_MAP.resolution,
    });
  }

  // Slide 6: CTA — uses campaign.name. The actual image is rendered by
  // generate_images.ts which substitutes campaign.cta_image_url verbatim
  // when the campaign uploaded one.
  result.push({
    role: 'cta',
    ...resolveCtaText(campaignName, campaignDescription),
    emoji: EMOJI_MAP.cta,
  });

  return result;
}

// ─── Hashtag Strategy ──────────────────────────────────────────
// SOUL.md: 1 trending/broad + 2 niche-specific + 1-2 ultra-niche/topic
// Never repeat same set two posts in a row.
//
// MinuteWise-era ULTRA_NICHE_HASHTAGS used to live here as a hardcoded
// list ("#Minutewise", "#FeynmanTechnique", etc.) — that meant RoastAI
// posts shipped with study-niche hashtags. The pickers below now prefer
// the active campaign's branded_hashtags + tracked_hashtags first,
// falling back to the generic STUDY pools only when the campaign hasn't
// been configured.

const STUDY_NICHE_HASHTAGS = [
  '#StudyTips', '#StudyHacks', '#StudyTok', '#StudentLife',
  '#StudyWithMe', '#AcademicTikTok', '#CollegeLife', '#ExamPrep',
];

const STUDY_ULTRA_NICHE_HASHTAGS = [
  '#Minutewise', '#AINoteTaker', '#PomodoroTechnique', '#FeynmanTechnique',
  '#ActiveRecall', '#SpacedRepetition', '#StudyMotivation', '#BlurtingMethod',
  '#StudyMethod', '#NotesTaking',
];

const TRENDING_BROAD = [
  '#FYP', '#ForYou', '#Viral', '#LearnOnTikTok', '#LifeHack', '#AI',
];

let lastHashtagSet: string[] = [];

/**
 * Normalise a list of campaign hashtags. The dashboard form sometimes
 * stores user-typed hashtags without leading "#" or with junk like
 * "#Roast#Funny#Comedy" mashed into one tag (the RoastAI test case had
 * exactly that). We split on '#', re-prefix, and drop empties so the
 * downstream caption gets a sensible list either way.
 */
function normaliseCampaignHashtags(tags: string[] | null | undefined): string[] {
  if (!tags || tags.length === 0) return [];
  const out: string[] = [];
  for (const raw of tags) {
    if (!raw) continue;
    // Split on '#' to recover from jammed-together input.
    const parts = String(raw).split('#').map(s => s.trim()).filter(Boolean);
    for (const p of parts) {
      if (!/^[A-Za-z0-9_]+$/.test(p)) continue; // skip if it has spaces / odd chars
      out.push(`#${p}`);
    }
  }
  return Array.from(new Set(out));
}

/**
 * Build the hashtag set for a post. Universal across campaigns:
 *
 *   - 1 trending/broad tag (#FYP / #LearnOnTikTok etc.)        — always
 *   - up to 2 niche tags from `campaign.tracked_hashtags`      — only if set
 *   - up to 2 branded tags from `campaign.branded_hashtags`    — only if set
 *
 * If the campaign hasn't filled in tracked/branded yet (a freshly created
 * Campaign 3, say), we DO NOT splice in study-niche placeholders — that
 * was the original cross-campaign leakage. The post simply gets fewer
 * tags. The dashboard's edit page surfaces both fields so the operator
 * can fill them in once and own their niche.
 *
 * The legacy STUDY_* pools are now only consulted when there is also
 * NO active campaign loaded at all (Supabase down + no campaign_id), so
 * a back-compat MinuteWise install still works.
 */
function pickHashtags(
  _hashtagBank: string,
  campaignBranded: string[] | null,
  campaignTracked: string[] | null,
): string[] {
  const branded = normaliseCampaignHashtags(campaignBranded);
  const tracked = normaliseCampaignHashtags(campaignTracked);
  const campaignConfigured = branded.length > 0 || tracked.length > 0;

  const trending = [pickRandom(TRENDING_BROAD)];

  // Niche / branded slots — campaign-driven when configured, legacy
  // study pool ONLY when the campaign is unconfigured (no branded AND
  // no tracked). This is the universal-leakage fix: a campaign without
  // its niche set should not inherit MinuteWise's niche.
  const nicheSource = tracked.length >= 1
    ? tracked
    : (campaignConfigured ? [] : STUDY_NICHE_HASHTAGS);
  const niche = [...nicheSource].sort(() => Math.random() - 0.5).slice(0, 2);

  const ultraSource = branded.length >= 1
    ? branded
    : (campaignConfigured ? [] : STUDY_ULTRA_NICHE_HASHTAGS);
  const ultra = [...ultraSource].sort(() => Math.random() - 0.5).slice(0, 1 + Math.round(Math.random()));

  const set = [...trending, ...niche, ...ultra];

  // Don't repeat the same set two posts in a row. Swap the last tag
  // with one from the same campaign-driven pool so the rotation stays
  // in scope; if the campaign has only a single branded tag we just
  // accept the repeat rather than reaching for an off-niche pool.
  if (JSON.stringify([...set].sort()) === JSON.stringify([...lastHashtagSet].sort())) {
    const swapPool = ultraSource.filter(h => !set.includes(h));
    if (swapPool.length > 0) {
      set.pop();
      set.push(pickRandom(swapPool));
    }
  }

  lastHashtagSet = [...set];
  return set;
}

// ─── Caption Builder ───────────────────────────────────────────
// Caption shape:
//   <title from Gemini/CSV — already campaign-on-topic>
//   <hashtags>
//
// We used to splice in a hardcoded "Save this for exam week 📌 / Send to
// your study group 📚" closer plus a study-themed hook from
// CAPTION_HOOKS. That worked for MinuteWise but stamped study-niche copy
// on every other campaign's posts. The Gemini prompt now generates a
// campaign-appropriate title (it's the slide-1 hook) so the caption can
// just relay that.

function buildCaption(title: string, hashtags: string[]): string {
  // Title doubles as the caption hook (Gemini emits it that way; CSV
  // templates store it in template.name). Trailing punctuation removed
  // so we can safely add the emoji.
  const hookLine = title.replace(/[.!?]\s*$/, '');
  return `${hookLine} 💡\n\n${hashtags.join(' ')}`;
}

// ─── Experiment Logic ──────────────────────────────────────────

async function determineHookStyle(
  accountIndex: number = 0,
): Promise<{ style: HookStyle; experiment: ExperimentVariant | null }> {
  const experimentLog = await readMemoryFile('EXPERIMENT-LOG.md');
  const formatWinners = await readMemoryFile('FORMAT-WINNERS.md');

  const activeMatch = experimentLog.match(/## Active Experiment\n([\s\S]*?)(?=\n## |$)/);
  if (activeMatch && !activeMatch[1].includes('None')) {
    const content = activeMatch[1];
    const styleAMatch = content.match(/Variant A:\s*(\w+)/);
    const styleBMatch = content.match(/Variant B:\s*(\w+)/);
    const idMatch = content.match(/Experiment #?(\w+)/);
    if (styleAMatch && styleBMatch && idMatch) {
      // Variant assignment by account-index parity. Previously this read
      // POST-TRACKER.md for "${experimentId}|A" but that marker is never
      // written there, so the toggle always returned 'A' and the second
      // variant never got tested. Parity gives us a deterministic 50/50
      // split across the cycle (4 accounts → 2A, 2B) and is stable on
      // retry without state lookups.
      const assignedVariant: 'A' | 'B' = accountIndex % 2 === 0 ? 'A' : 'B';
      const style = (assignedVariant === 'A' ? styleAMatch[1] : styleBMatch[1]) as HookStyle;
      return { style, experiment: { experimentId: idMatch[1], variant: assignedVariant, hookStyle: style } };
    }
  }

  const allStyles: HookStyle[] = ['question', 'bold_claim', 'story_opener', 'stat_lead', 'contrast'];
  if (formatWinners.includes('## Format Rankings') && !formatWinners.includes('_Will be populated')) {
    if (Math.random() > 0.3) {
      const winnerMatch = formatWinners.match(/\| 1\s*\|[^|]*\|\s*(\w+)/);
      if (winnerMatch) return { style: winnerMatch[1] as HookStyle, experiment: null };
    }
  }

  const shuffled = allStyles.sort(() => Math.random() - 0.5);
  const experimentId = String(Date.now()).slice(-6);
  return { style: shuffled[0], experiment: { experimentId, variant: 'A', hookStyle: shuffled[0] } };
}

// ─── AI Content Generation (Gemini) ────────────────────────────

async function generateAIContent(
  flow: FlowType,
  hookStyle: HookStyle,
  accountIndex: number,
): Promise<{ name: string; slides: { top: string; center: string; bottom: string }[] } | null> {
  if (!config.gemini.apiKey) {
    log('Gemini API key not set — skipping AI content generation');
    return null;
  }

  // Read context for smart generation
  const formatWinners = await readMemoryFile('FORMAT-WINNERS.md');
  const trendingNow = await readMemoryFile('TRENDING-NOW.md');
  const account = config.tiktokAccounts[accountIndex];

  // Resolve the active campaign so the prompt is grounded in THIS campaign's
  // brand, tone, and branded hashtags rather than hardcoded MinuteWise text.
  //
  // Brand-string resolution order — once a campaign object is loaded, we
  // never fall back to "MinuteWise" wording, even if individual fields
  // (description, hashtags) are missing. The MinuteWise default is ONLY
  // for the no-campaign-loaded case (Supabase down at cycle start).
  const campaign = await getCampaign(getCampaignSlug());
  const brandLine = campaign
    ? `BRAND: ${campaign.name}${campaign.description ? ' — ' + campaign.description : ''}`
    : 'BRAND: MinuteWise — AI note-taker app for students. Records lectures, transcribes, creates notes/quizzes/flashcards.';
  const styleLine = campaign?.visual_style_prompt
    ? `VISUAL STYLE: ${campaign.visual_style_prompt}`
    : '';
  // Distilled-from-training-images style guidance (Phase 17c). When the
  // operator has uploaded reference images and clicked "Train style",
  // Gemini Vision wrote a detailed paragraph into campaigns.style_distillation.
  // We inject it here as STYLE GUIDE so the slide-copy generation also
  // reflects the trained look (e.g. moodier copy for a moody-styled
  // brand). At image-generation time the same paragraph is used by
  // generate_images.ts for the visual prompts.
  const styleGuideLine = campaign?.style_distillation
    ? `STYLE GUIDE (from trained reference images): ${campaign.style_distillation}`
    : '';
  const toneLine = campaign?.tone_of_voice
    ? `TONE OF VOICE: ${campaign.tone_of_voice}`
    : '';
  const brandedTagsHint = campaign?.branded_hashtags?.length
    ? `Always include the branded hashtags: ${campaign.branded_hashtags.join(', ')}`
    : '';
  const brandMentionHint = campaign
    ? `At least one slide must naturally mention ${campaign.name} as a solution`
    : 'At least one slide must naturally mention MinuteWise as a solution';

  // Extract top trends (first 500 chars to keep prompt concise)
  const trendSnippet = trendingNow.slice(0, 500);
  const winnerSnippet = formatWinners.slice(0, 400);

  const hookInstructions: Record<HookStyle, string> = {
    question: 'Start slide 1 with a compelling question that makes viewers curious.',
    bold_claim: 'Start slide 1 with a provocative, bold statement that challenges beliefs.',
    story_opener: 'Start slide 1 with a personal narrative like "I wish I knew..." or "The day I discovered..."',
    stat_lead: 'Start slide 1 with a surprising statistic or data point.',
    contrast: 'Start slide 1 with a "Stop doing X, do Y instead" contrast.',
  };

  const prompt = `You are a TikTok content creator generating a slideshow post for the ${campaign?.name ?? 'MinuteWise'} campaign.

${brandLine}
${styleLine}
${styleGuideLine}
${toneLine}

ACCOUNT: ${account.name} (${account.handle})

HOOK STYLE: ${hookStyle}
${hookInstructions[hookStyle]}

TRENDING TOPICS (pick one or blend):
${trendSnippet}

WINNING FORMATS:
${winnerSnippet}

SLIDE STRUCTURE RULES:
- Generate exactly 8 slides
- Slide 1 = Hook (pattern interrupt, grab attention)
- Slides 2-3 = Problem (relatable struggle the audience faces)
- Slides 4-6 = Tips/Solution (one actionable gold nugget per slide)
- Slide 7 = Resolution (transformation, proof it works)
- ${brandMentionHint}
- ${brandedTagsHint}
- Keep text concise — designed for TikTok slideshow (viewers swipe quickly)
- Each line should be punchy, 5-15 words max
- Stay strictly within this campaign's topic and audience
- Do NOT repeat content from previous posts

OUTPUT FORMAT (strict JSON, no markdown):
{
  "title": "The hook title for this post (this becomes the caption hook)",
  "slides": [
    { "top": "short header", "center": "main point 1-2 sentences", "bottom": "supporting line" },
    { "top": "...", "center": "...", "bottom": "..." }
  ]
}

Generate a unique, engaging post now.`;

  try {
    const response = await fetch(
      `${config.gemini.baseUrl}/models/gemini-2.5-flash:generateContent?key=${config.gemini.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
          },
        }),
      },
    );

    if (!response.ok) {
      log(`Gemini text API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      log('Gemini returned empty text response');
      return null;
    }

    const parsed = JSON.parse(text);
    if (!parsed.title || !parsed.slides || !Array.isArray(parsed.slides) || parsed.slides.length < 3) {
      log(`Gemini returned invalid structure: ${parsed.slides?.length || 0} slides`);
      return null;
    }

    log(`AI generated: "${parsed.title}" (${parsed.slides.length} slides)`);
    return { name: parsed.title, slides: parsed.slides };
  } catch (err) {
    log(`AI content generation failed: ${err}`);
    return null;
  }
}

// ─── Main Generator ────────────────────────────────────────────

// Track used templates per cycle to avoid duplicates across accounts
let usedTemplatesThisCycle = new Set<string>();

export function resetUsedTemplates(): void {
  usedTemplatesThisCycle.clear();
}

export async function generateContent(
  flow: FlowType,
  accountIndex: number,
): Promise<GeneratedContent> {
  const account = config.tiktokAccounts[accountIndex];
  log(`=== CONTENT GENERATION (${flow}, ${account.name}) ===`);

  // Resolve the active campaign FIRST. Every downstream helper that used
  // to hardcode MinuteWise (CTA text, hashtag picker, brand-mention
  // detection) now branches on this object. If Supabase is unreachable
  // we get null and the helpers fall back to the legacy MinuteWise copy,
  // which is the right behavior for the back-compat case.
  const campaignSlug = getCampaignSlug();
  const campaign = await getCampaign(campaignSlug);
  if (!campaign) {
    log(`[campaign] WARNING: campaign "${campaignSlug}" not loaded from Supabase — content helpers will use legacy back-compat defaults. This is fine for the original MinuteWise install but means a fresh campaign would generate generic content. Check Supabase connectivity if this is unexpected.`);
  }
  // The CSV-template fallback is MinuteWise-specific (every row hardcodes
  // study/MinuteWise copy), so it is ONLY safe for the legacy MinuteWise
  // campaign. Every other campaign — including a brand-new one — must
  // generate via Gemini using its own description; the CSV path is hard-
  // gated off for them.
  const isMinutewiseCampaign = !campaign || campaign.slug === 'minutewise';

  const hashtagBank = await readMemoryFile('HASHTAG-BANK.md');

  // Load CSV templates. We only consult them on a campaign whose topic
  // matches the templates' study domain — otherwise the CSV is a strict
  // foot-gun: every row hardcodes MinuteWise copy, so applying it to
  // RoastAI (or any future campaign) ships wrong-brand content.
  let templates: CsvTemplate[] = [];
  if (isMinutewiseCampaign) {
    try {
      const csvContent = await readFile(config.paths.templates, 'utf-8');
      templates = parseCsvTemplates(csvContent);
      log(`Loaded ${templates.length} templates from CSV`);
    } catch {
      log('No CSV templates found');
    }

    // Filter: ONLY education/study/Minutewise related templates
    const STUDY_KEYWORDS = [
      'study', 'studi', 'exam', 'grade', 'gpa', 'note', 'learn',
      'college', 'school', 'university', 'lecture', 'class', 'homework',
      'minutewise', 'minute wise', 'pomodoro', 'feynman', 'flashcard',
      'recall', 'memoriz', 'revision', 'tutor', 'academic', 'freshman',
      'semester', 'student', 'education', 'productivity', 'focus',
      'brain', 'reading', 'smart', 'tip', 'hack', 'method', 'technique',
    ];

    templates = templates.filter((t) => {
      const text = [t.name, t.category, ...t.slides.map(s => `${s.top} ${s.center} ${s.bottom}`)].join(' ').toLowerCase();
      return STUDY_KEYWORDS.some((kw) => text.includes(kw));
    });
    log(`Filtered to ${templates.length} study/Minutewise templates`);
  } else {
    log(`[campaign] non-MinuteWise campaign "${campaign!.slug}" — skipping MinuteWise CSV fallback (would produce wrong-brand content)`);
  }

  // Determine hook style — passes accountIndex so the variant toggle
  // (when an Active Experiment exists) alternates A/B across the cycle.
  const { style, experiment } = await determineHookStyle(accountIndex);
  log(`Hook style target: ${style}${experiment ? ` (experiment ${experiment.experimentId} variant ${experiment.variant})` : ''}`);

  // Try AI-generated content first, fall back to CSV
  let template: CsvTemplate | null = null;

  try {
    const aiContent = await generateAIContent(flow, style, accountIndex);
    if (aiContent && aiContent.slides.length >= 3) {
      template = {
        name: aiContent.name,
        category: 'ai-generated',
        slides: aiContent.slides,
        referenceUrl: '',
        isActive: true,
      };
      usedTemplatesThisCycle.add(template.name);
      log(`Using AI-generated template: "${template.name}" (${template.slides.length} slides)`);
    }
  } catch (err) {
    log(`AI content generation failed, falling back to CSV: ${err}`);
  }

  // Fallback: pick from CSV templates. Templates are MinuteWise-only —
  // we already skipped loading them for non-MinuteWise campaigns above,
  // so this branch is empty for RoastAI etc. Refuse to fabricate a post
  // for a non-MinuteWise campaign without Gemini rather than ship
  // study-themed copy.
  if (!template) {
    if (templates.length === 0) {
      throw new Error(
        `Gemini content generation failed and no CSV fallback is available for campaign "${campaign?.slug ?? campaignSlug}". ` +
        `Either Gemini is misconfigured (check GEMINI_API_KEY) or the campaign has no description for the prompt to work with. ` +
        `Refusing to fabricate a post — would produce wrong-campaign content.`,
      );
    }
    log('Using CSV template fallback');
    const available = templates.filter((t) => !usedTemplatesThisCycle.has(t.name));
    if (available.length > 0) {
      const matching = available.filter((t) => classifyHookStyle(t.name) === style);
      template = matching.length > 0 ? pickRandom(matching) : pickRandom(available);
    } else {
      template = pickRandom(templates);
    }
    usedTemplatesThisCycle.add(template.name);
  }

  const title = template.name;
  const slides = flow === 'emoji_overlay'
    ? assignEmojiFlowRoles(template.slides, campaign?.name ?? null, campaign?.description ?? null)
    : assignSlideRoles(template.slides, campaign?.name ?? null, campaign?.description ?? null);
  const hashtags = pickHashtags(hashtagBank, campaign?.branded_hashtags ?? null, campaign?.tracked_hashtags ?? null);
  const caption = buildCaption(title, hashtags);
  const actualHookStyle = classifyHookStyle(title);

  const metadata: PostMetadata = {
    hookStyle: actualHookStyle,
    format: `${slides.length}-slide`,
    hashtags,
    experimentId: experiment?.experimentId || null,
    variant: experiment?.variant || null,
    createdAt: new Date().toISOString(),
    flow,
    account: account.name,
  };

  log(`Template: "${title}" (${slides.length} slides, ${actualHookStyle})`);
  log(`Flow: ${flow}`);
  log('=== CONTENT GENERATION COMPLETE ===');

  return {
    title,
    slides,
    caption,
    hashtags,
    hookStyle: actualHookStyle,
    experiment,
    metadata,
    useCta: true,
    flow,
    accountIndex,
  };
}

// Allow running standalone
if (process.argv[1]?.endsWith('text_overlay.ts')) {
  generateContent('animated', 0).then((c) => {
    console.log(`\nTitle: ${c.title}`);
    console.log(`Flow: ${c.flow} | Hook: ${c.hookStyle}`);
    for (const [i, s] of c.slides.entries()) {
      console.log(`  Slide ${i + 1} [${s.role}]: ${[s.top, s.center, s.bottom].filter(Boolean).join(' | ')}`);
    }
    console.log(`\nCaption:\n${c.caption}`);
  }).catch(console.error);
}
