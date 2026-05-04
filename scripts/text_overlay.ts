import { readFile } from 'fs/promises';
import { join } from 'path';
import { config, FlowType } from '../config/config.js';
import { log } from './api-client.js';

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
  try { return await readFile(join(config.paths.memory, filename), 'utf-8'); }
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
// Enforces EXACTLY 8 slides per post
// If CSV template has fewer, pad with Minutewise promotional slides

const MINUTEWISE_FILLER_SLIDES: { top: string; center: string; bottom: string }[] = [
  {
    top: 'Minutewise AI',
    center: 'Records and transcribes your lectures into perfect notes automatically.',
    bottom: 'So you can focus on learning, not writing.',
  },
  {
    top: 'Why Minutewise?',
    center: 'AI-powered notes, quizzes, flashcards, and summaries — all from one recording.',
    bottom: 'Available on iOS App Store.',
  },
  {
    top: '100+ Languages Supported',
    center: 'Minutewise transcribes lectures in over 100 languages.',
    bottom: 'Perfect for international students.',
  },
  {
    top: 'Stop Wasting Time on Notes',
    center: 'Let Minutewise handle your notes while you actually pay attention in class.',
    bottom: 'Your grades will thank you.',
  },
  {
    top: 'Smart Study Tools',
    center: 'Minutewise generates quizzes and flashcards from your lecture notes.',
    bottom: 'Study smarter, not harder.',
  },
  {
    top: 'Never Miss a Detail',
    center: 'Minutewise captures every word from lectures and Zoom meetings.',
    bottom: 'Get organized summaries instantly.',
  },
  {
    top: 'Save Hours Every Week',
    center: 'Students using Minutewise save 5+ hours on note-taking every week.',
    bottom: 'That is time you can spend actually studying.',
  },
  {
    top: 'Your AI Study Companion',
    center: 'From recording to revision — Minutewise handles it all.',
    bottom: 'Download free on the App Store.',
  },
];

const TARGET_SLIDE_COUNT = 6;

function assignSlideRoles(slides: { top: string; center: string; bottom: string }[]): SlideContent[] {
  const result: SlideContent[] = [];

  // Use template slides first (5 content slides)
  for (let i = 0; i < slides.length && result.length < TARGET_SLIDE_COUNT - 1; i++) {
    const s = slides[i];
    const text = [s.top, s.center, s.bottom].join(' ').toLowerCase();
    const isMinutewise = text.includes('minutewise') || text.includes('minute wise');

    let role: SlideContent['role'];
    if (result.length === 0) {
      role = 'hook';
    } else if (result.length === 1) {
      role = 'knowledge_gap';
    } else if (isMinutewise) {
      role = 'minutewise';
    } else {
      role = 'value';
    }

    result.push({ role, top: s.top, center: s.center, bottom: s.bottom });
  }

  // Pad with Minutewise content if not enough template slides
  let fillerIdx = 0;
  while (result.length < TARGET_SLIDE_COUNT - 1) {
    const filler = MINUTEWISE_FILLER_SLIDES[fillerIdx % MINUTEWISE_FILLER_SLIDES.length];
    fillerIdx++;
    result.push({ role: 'minutewise', top: filler.top, center: filler.center, bottom: filler.bottom });
  }

  // Slide 6: CTA (generated in matching style by generate_images.ts)
  result.push({
    role: 'cta',
    top: 'Download Minutewise',
    center: 'Your AI Note Taker',
    bottom: 'Available on App Store',
  });

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

const PROBLEM_FILLER_SLIDES: { top: string; center: string; bottom: string }[] = [
  {
    top: 'Sound familiar?',
    center: 'You spend 3 hours on notes and still can\'t remember anything for the exam.',
    bottom: 'There has to be a better way.',
  },
  {
    top: 'The struggle is real',
    center: 'Re-reading your notes 10 times and retaining nothing.',
    bottom: 'You\'re not alone.',
  },
];

const TIP_FILLER_SLIDES: { top: string; center: string; bottom: string }[] = [
  {
    top: 'Try active recall',
    center: 'Close your notes and write down everything you remember. Then check what you missed.',
    bottom: 'This alone can boost retention by 50%.',
  },
  {
    top: 'Use spaced repetition',
    center: 'Review material at increasing intervals — 1 day, 3 days, 7 days, 14 days.',
    bottom: 'Your brain locks it in permanently.',
  },
  {
    top: 'Let Minutewise handle notes',
    center: 'Record your lectures. Minutewise transcribes and creates notes, quizzes, and flashcards automatically.',
    bottom: 'Focus on understanding, not writing.',
  },
];

function assignEmojiFlowRoles(slides: { top: string; center: string; bottom: string }[]): SlideContent[] {
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

  // Slide 5: Resolution
  if (available.length > 0) {
    const s = available.shift()!;
    result.push({ role: 'resolution', top: s.top, center: s.center, bottom: s.bottom, emoji: EMOJI_MAP.resolution });
  } else {
    result.push({
      role: 'resolution',
      top: 'You\'ve got this',
      center: 'With the right tools and methods, you can study less and remember more.',
      bottom: 'Start with Minutewise — it\'s free.',
      emoji: EMOJI_MAP.resolution,
    });
  }

  // Slide 6: CTA (generated in matching style by generate_images.ts)
  result.push({
    role: 'cta',
    top: 'Download Minutewise',
    center: 'Your AI Note Taker',
    bottom: 'Available on App Store',
    emoji: EMOJI_MAP.cta,
  });

  return result;
}

// ─── Hashtag Strategy ──────────────────────────────────────────
// SOUL.md: 1 trending/broad + 2 niche-specific + 1-2 ultra-niche/topic
// Never repeat same set two posts in a row

const NICHE_HASHTAGS = [
  '#StudyTips', '#StudyHacks', '#StudyTok', '#StudentLife',
  '#StudyWithMe', '#AcademicTikTok', '#CollegeLife', '#ExamPrep',
];

const ULTRA_NICHE_HASHTAGS = [
  '#Minutewise', '#AINoteTaker', '#PomodoroTechnique', '#FeynmanTechnique',
  '#ActiveRecall', '#SpacedRepetition', '#StudyMotivation', '#BlurtingMethod',
  '#StudyMethod', '#NotesTaking',
];

const TRENDING_BROAD = [
  '#FYP', '#ForYou', '#Viral', '#LearnOnTikTok', '#LifeHack', '#AI',
];

let lastHashtagSet: string[] = [];

function pickHashtags(hashtagBank: string): string[] {
  // 1 trending/broad
  const trending = [pickRandom(TRENDING_BROAD)];

  // 2 niche-specific
  const niche = NICHE_HASHTAGS.sort(() => Math.random() - 0.5).slice(0, 2);

  // 1-2 ultra-niche
  const ultra = ULTRA_NICHE_HASHTAGS.sort(() => Math.random() - 0.5).slice(0, 1 + Math.round(Math.random()));

  const set = [...trending, ...niche, ...ultra];

  // Don't repeat same set
  if (JSON.stringify(set.sort()) === JSON.stringify(lastHashtagSet.sort())) {
    set.pop();
    set.push(pickRandom(ULTRA_NICHE_HASHTAGS.filter((h) => !set.includes(h))));
  }

  lastHashtagSet = [...set];
  return set;
}

// ─── Caption Builder ───────────────────────────────────────────
// SOUL.md template:
// [Bold hook] + [emoji]
// [1-2 lines of value creating curiosity]
// Save this for exam week 📌
// Send to your study group 📚
// #hashtags

const CAPTION_HOOKS = [
  'Your professor won\'t tell you this',
  'I wish someone told me this sooner',
  'Save this before exams hit',
  'This changed my entire study game',
  'Stop studying wrong — do this instead',
  'Your GPA will thank you later',
  'Every student needs to see this',
  'The study hack that actually works',
];

const CAPTION_VALUE_LINES = [
  'Most students waste hours on notes — there\'s a smarter way.',
  'These methods took me from cramming to actually understanding.',
  'If you\'re still re-reading, you\'re doing it wrong.',
  'The difference between a 3.0 and a 4.0 is HOW you study.',
  'Your brain remembers 90% more when you study like this.',
  'I tested every study method so you don\'t have to.',
];

function buildCaption(title: string, hashtags: string[]): string {
  const hook = pickRandom(CAPTION_HOOKS);
  const valueLine = pickRandom(CAPTION_VALUE_LINES);

  return `${hook} 💡\n\n${valueLine}\n\nSave this for exam week 📌\nSend to your study group 📚\n\n${hashtags.join(' ')}`;
}

// ─── Experiment Logic ──────────────────────────────────────────

async function determineHookStyle(): Promise<{ style: HookStyle; experiment: ExperimentVariant | null }> {
  const experimentLog = await readMemoryFile('EXPERIMENT-LOG.md');
  const formatWinners = await readMemoryFile('FORMAT-WINNERS.md');

  const activeMatch = experimentLog.match(/## Active Experiment\n([\s\S]*?)(?=\n## |$)/);
  if (activeMatch && !activeMatch[1].includes('None')) {
    const content = activeMatch[1];
    const styleAMatch = content.match(/Variant A:\s*(\w+)/);
    const styleBMatch = content.match(/Variant B:\s*(\w+)/);
    const idMatch = content.match(/Experiment #?(\w+)/);
    if (styleAMatch && styleBMatch && idMatch) {
      const tracker = await readMemoryFile('POST-TRACKER.md');
      const lastVariant = tracker.includes(`${idMatch[1]}|A`) ? 'B' : 'A';
      const style = (lastVariant === 'A' ? styleAMatch[1] : styleBMatch[1]) as HookStyle;
      return { style, experiment: { experimentId: idMatch[1], variant: lastVariant, hookStyle: style } };
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

  const prompt = `You are a TikTok content creator specializing in study tips for students.
Generate a TikTok slideshow post about a study/education topic.

BRAND: MinuteWise — AI note-taker app for students. Records lectures, transcribes, creates notes/quizzes/flashcards. 100+ languages. Available on iOS App Store.

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
- Slides 2-3 = Problem (relatable struggle students face)
- Slides 4-6 = Tips/Solution (one actionable gold nugget per slide)
- Slide 7 = Resolution (transformation, proof it works)
- At least one slide must naturally mention MinuteWise as a solution
- Keep text concise — designed for TikTok slideshow (viewers swipe quickly)
- Each line should be punchy, 5-15 words max
- Study/education niche ONLY
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

  const hashtagBank = await readMemoryFile('HASHTAG-BANK.md');

  // Load CSV templates
  let templates: CsvTemplate[] = [];
  try {
    const csvContent = await readFile(config.paths.templates, 'utf-8');
    templates = parseCsvTemplates(csvContent);
    log(`Loaded ${templates.length} templates from CSV`);
  } catch {
    log('No CSV templates found');
  }

  // Filter: ONLY education/study/Minutewise related templates
  // Every post must promote Minutewise — reject off-topic templates
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

  // Determine hook style
  const { style, experiment } = await determineHookStyle();
  log(`Hook style target: ${style}`);

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

  // Fallback: pick from CSV templates
  if (!template) {
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
    ? assignEmojiFlowRoles(template.slides)
    : assignSlideRoles(template.slides);
  const hashtags = pickHashtags(hashtagBank);
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
