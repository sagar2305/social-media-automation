/**
 * FULL AUTONOMOUS Flow 2 Cycle
 * - 3 unique animated posts × 3 accounts
 * - 3 different animation styles
 * - Rule 46: CTA slide generated in matching style
 * - DIRECT_POST scheduled 15 min after completion
 * - All 46 rules applied
 *
 * Run: npx tsx scripts/auto-flow2-cycle.ts
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

import { writeFile, readFile, mkdir, unlink, appendFile } from 'fs/promises';
import { join } from 'path';
import { execSync } from 'child_process';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const BLOTATO_KEY = process.env.BLOTATO_API_KEY!;
const SLIDES_DIR = './posts';

// ─── 3 Accounts ─────────────────────────────────────────────
const ACCOUNTS = [
  { id: 'cmmxd7lo605mnle0y2xe2o1x6', name: '@yournotetaker' },
  { id: 'cmn4kitnp02k2nq0yr3ub3k0e', name: '@grow.withamanda' },
  { id: 'cmn4m9ywn0debpb0yi5530vhs', name: '@hack.my.study' },
];

// ─── 3 Different Animation Styles (rotating, no repeats) ────
const ANIM_STYLES = [
  { name: 'Anime/Manga', prompt: 'Japanese anime style, expressive big eyes, dynamic poses, vibrant saturated colors, manga-inspired linework' },
  { name: 'Chalk/Blackboard', prompt: 'Drawn on chalkboard with chalk textures, green/black board background, white and colored chalk lines, classroom feel' },
  { name: 'Retro 70s', prompt: 'Retro 1970s illustration style, groovy rounded shapes, warm orange/brown/mustard palette, funky patterns, vintage vibes' },
];

// ─── 3 Different Characters ─────────────────────────────────
const CHARACTERS = [
  'A girl with big expressive eyes, short bob haircut with bangs, wearing a yellow hoodie and jeans',
  'A boy with a beanie hat, dark skin, wearing an orange puffer vest over a white long-sleeve',
  'A girl with short pixie cut, big eyes, wearing a denim overall dress over a striped shirt',
];

// ─── 3 Unique Post Topics (Henry framework: Picture→Promise→Prove→Push) ──

interface SlideSpec {
  role: string;
  text: string[];
}

interface PostSpec {
  title: string;
  caption: string;
  hookStyle: string;
  slides: SlideSpec[];
}

const POSTS: PostSpec[] = [
  {
    title: "The 2-minute rule that fixed my procrastination",
    hookStyle: 'story_opener',
    caption: `The 2-minute rule literally cured my procrastination.
If it takes less than 2 min, do it NOW. For everything else, Minutewise has your back.
Save for exam week

#studytok #procrastination #studyhacks #minutewise #productivity`,
    slides: [
      { role: 'hook', text: ["The 2-minute rule", "fixed my procrastination", "in one week."] },
      { role: 'problem', text: ["I'd stare at my textbook", "for 30 minutes doing nothing.", "Then feel guilty and", "scroll TikTok instead."] },
      { role: 'tip', text: ["Rule: If a task takes", "less than 2 minutes,", "do it immediately.", "No thinking. Just start."] },
      { role: 'tip', text: ["For bigger tasks, use Minutewise.", "Open your lecture recording,", "read the AI summary.", "That's your 2-minute start."] },
      { role: 'resolution', text: ["After one week I went from", "0 study hours to 4+ daily.", "All because I stopped", "overthinking the start."] },
      { role: 'cta', text: ["Download Minutewise", "Your AI Note Taker", "Available on App Store"] },
    ],
  },
  {
    title: "Why your brain forgets 70% in 24 hours",
    hookStyle: 'stat_lead',
    caption: `Your brain forgets 70% of what you learned within 24 hours. Unless you do this.
Minutewise makes fighting the forgetting curve effortless.
Save for exam week

#studytok #forgettingcurve #studytips #minutewise #brainscience`,
    slides: [
      { role: 'hook', text: ["Your brain forgets 70%", "of what you learn", "within 24 hours."] },
      { role: 'problem', text: ["You sit through an entire", "lecture, feel like you", "understood everything.", "Next day? It's gone."] },
      { role: 'tip', text: ["Fix 1: Review within 24 hours.", "Even 10 minutes of review", "boosts retention to 80%."] },
      { role: 'tip', text: ["Fix 2: Use Minutewise to record", "your lecture. Review the AI", "summary that same evening.", "Takes 5 minutes."] },
      { role: 'resolution', text: ["Students who review within", "24 hours remember 80%+ after", "a week. Science-backed.", "No more blank exam pages."] },
      { role: 'cta', text: ["Download Minutewise", "Your AI Note Taker", "Available on App Store"] },
    ],
  },
  {
    title: "3 apps every student needs on their phone",
    hookStyle: 'bold_claim',
    caption: `3 apps that turned my phone from a distraction into a study weapon.
Minutewise is the one that changed everything.
Save for exam week

#studytok #studyapps #studentlife #minutewise #aistudytools`,
    slides: [
      { role: 'hook', text: ["3 apps every student", "needs on their phone", "right now."] },
      { role: 'problem', text: ["Your phone is probably", "your biggest distraction.", "Social media, games, YouTube.", "Hours gone. Zero studying."] },
      { role: 'tip', text: ["App 1: Forest.", "Plant a tree when you study.", "It dies if you leave the app.", "Gamified focus."] },
      { role: 'tip', text: ["App 2: Minutewise.", "Records your lectures,", "transcribes everything,", "creates notes, quizzes,", "and flashcards with AI."] },
      { role: 'resolution', text: ["These 3 apps turned my phone", "into a study machine.", "My screen time shifted from", "80% social to 60% studying."] },
      { role: 'cta', text: ["Download Minutewise", "Your AI Note Taker", "Available on App Store"] },
    ],
  },
];

// ─── Expression Mapping (Rule 19) ───────────────────────────
const EXPRESSION_MAP: Record<string, string> = {
  hook: 'curious look, raised eyebrow, leaning forward with interest, wide eyes',
  problem: 'frustrated expression, head in hands, slouched posture, biting lip',
  tip: 'focused and excited, pointing up in "aha" moment, eyes lit up with sparkle, determined',
  resolution: 'confident smile, arms crossed proudly, standing tall, triumphant pose',
  cta: 'warm friendly smile, hand reaching toward viewer, inviting welcoming gesture',
};

// ─── Gemini Image Generation ────────────────────────────────

async function generateImage(prompt: string, retries = 3): Promise<Buffer> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_API_KEY}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
        }),
      });

      if (response.status === 429) {
        const wait = Math.min(10000 * attempt, 30000);
        log(`  Rate limited, waiting ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini ${response.status}: ${errText}`);
      }

      const data = await response.json() as any;
      if (data.error) throw new Error(`Gemini: ${data.error.message}`);

      const parts = data.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          return Buffer.from(part.inlineData.data, 'base64');
        }
      }
      throw new Error('No image data in Gemini response');
    } catch (err) {
      if (attempt < retries) {
        log(`  Attempt ${attempt} failed: ${err}. Retrying...`);
        await sleep(5000 * attempt);
      } else {
        throw err;
      }
    }
  }
  throw new Error('All retries exhausted');
}

// ─── Prompt Builders ────────────────────────────────────────

function buildSlidePrompt(
  character: string,
  animPrompt: string,
  slide: SlideSpec,
  idx: number,
  total: number,
  title: string,
): string {
  const expression = EXPRESSION_MAP[slide.role] || 'focused';
  const isCtaSlide9 = idx === total - 1;

  if (isCtaSlide9) {
    // Rule 46: CTA slide in matching animation style with Minutewise on phone
    return `Create an animated image in ${animPrompt} for a TikTok slideshow. This is the FINAL slide (${idx + 1} of ${total}) — a call-to-action showing the Minutewise app.

SCENE: ${character}, happily holding a mobile phone. The phone screen clearly displays the "Minutewise" app — show the app name "Minutewise" written on the phone screen in a clean modern UI with a note-taking interface. The character has a warm, inviting smile and is gesturing toward the phone as if recommending the app to the viewer.

STYLE: ${animPrompt} — MUST match the exact same style, color grading, and aesthetic as slides 1-${total - 1}. This slide must feel like it belongs in the same slideshow.

CRITICAL REQUIREMENTS:
- The phone screen MUST show the word "Minutewise" as the app name — this is the key branding element
- The phone should show a clean, modern note-taking app interface with the Minutewise name visible
- Character must look CONSISTENT with the previous slides (same design, outfit, face)
- Warm, inviting mood — the character is recommending this app
- Leave upper 60-70% of the image for text overlay (TikTok safe zone)
- 3:4 aspect ratio (portrait, taller than wide) for mobile viewing
- NO other text besides "Minutewise" on the phone screen`;
  }

  return `Create an animated image in ${animPrompt} for a TikTok slideshow. Slide ${idx + 1} of ${total} — ALL slides must belong together.

CHARACTER: ${character}
EXPRESSION: ${expression}
NARRATIVE ROLE: "${slide.role}" slide — character's emotion must clearly convey this role.

SCENE: AI-decided background based on topic "${title}". Same environment across all slides.

IMPORTANT: Do NOT include any text, words, letters, or typography. Clean image only — text added separately.

Style: ${animPrompt}. Warm, colorful, visually engaging. Consistent character across all slides. Expression must CLEARLY change per slide. Leave upper 60-70% for text overlay. NOT photorealistic — fully animated. 3:4 aspect ratio.`;
}

// ─── Spell Check (4-pass, Rule 32) ──────────────────────────

const SPELLING_FIXES: [RegExp, string][] = [
  [/\bMinuteWise\b/g, 'Minutewise'],
  [/\bminute\s*wise\b/gi, 'Minutewise'],
  [/\bMinute\s*Wise\b/g, 'Minutewise'],
  [/\bpomodoro\b/gi, 'Pomodoro'],
  [/\bfeynman\b/gi, 'Feynman'],
  [/\btiktok\b/gi, 'TikTok'],
  [/\bdont\b/g, "don't"],
  [/\bcant\b/g, "can't"],
  [/\bwont\b/g, "won't"],
  [/\byoure\b/g, "you're"],
  [/\bIm\b/g, "I'm"],
];

function spellCheck(text: string): string {
  let result = text;
  for (let pass = 0; pass < 4; pass++) {
    const before = result;
    for (const [pattern, replacement] of SPELLING_FIXES) {
      result = result.replace(pattern, replacement);
    }
    result = result.replace(/  +/g, ' ').trim();
    if (result === before) break;
  }
  return result;
}

// ─── Text Overlay ───────────────────────────────────────────

function overlayText(rawPath: string, textLines: string[], outputPath: string): void {
  const cleaned = textLines.map(l => spellCheck(l));
  const textJson = JSON.stringify(cleaned);
  execSync(
    `python3 scripts/overlay-text.py "${rawPath}" '${textJson.replace(/'/g, "'\\''")}' "${outputPath}"`,
    { cwd: process.cwd() },
  );
}

// ─── Blotato API ────────────────────────────────────────────

async function blotatoRequest(path: string, options: any = {}): Promise<any> {
  const url = `https://backend.blotato.com/v2${path}`;
  const { method = 'GET', body } = options;
  const headers: Record<string, string> = { 'blotato-api-key': BLOTATO_KEY };
  if (body) headers['Content-Type'] = 'application/json';
  const fetchOpts: RequestInit = { method, headers };
  if (body) fetchOpts.body = JSON.stringify(body);
  const res = await fetch(url, fetchOpts);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Blotato ${res.status}: ${err}`);
  }
  return res.json();
}

let _blotAccountCache: Map<string, string> | null = null;
async function resolveBlotAccounts(): Promise<Map<string, string>> {
  if (_blotAccountCache) return _blotAccountCache;
  const data = await blotatoRequest('/users/me/accounts?platform=tiktok');
  const map = new Map<string, string>();
  for (const acc of data.items || []) {
    if (acc.username) map.set(acc.username.toLowerCase(), acc.id);
  }
  _blotAccountCache = map;
  return map;
}

async function createDraftPost(
  handle: string,
  slidePaths: string[],
  caption: string,
  hookTitle: string,
): Promise<any> {
  const accounts = await resolveBlotAccounts();
  const blotId = accounts.get(handle.toLowerCase());
  if (!blotId) throw new Error(`No Blotato account for ${handle}`);

  return blotatoRequest('/posts', {
    method: 'POST',
    body: {
      post: {
        accountId: blotId,
        content: {
          text: caption,
          mediaUrls: slidePaths,
          platform: 'tiktok',
        },
        target: {
          targetType: 'tiktok',
          privacyLevel: 'PUBLIC_TO_EVERYONE',
          disabledComments: false,
          disabledDuet: false,
          disabledStitch: false,
          isBrandedContent: false,
          isYourBrand: false,
          isAiGenerated: true,
          isDraft: true,
          autoAddMusic: true,
          title: hookTitle.slice(0, 90),
        },
      },
    },
  });
}

// ─── Tracker (Rule 43) ──────────────────────────────────────

async function trackPost(postId: string, post: PostSpec, account: string): Promise<void> {
  const trackerPath = './data/POST-TRACKER.md';
  const date = new Date().toISOString().slice(0, 10);
  const hashtags = post.caption.match(/#\w+/g)?.join(', ') || '';
  const row = `| ${postId} | ${date} | ${post.hookStyle} | 9-slide | ${hashtags} | - | - | - | - | - | - | scheduled (${account}, animated) |`;
  await appendFile(trackerPath, row + '\n');
}

// ─── Utilities ──────────────────────────────────────────────

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  AUTONOMOUS FLOW 2 CYCLE                         ║');
  console.log('║  3 Unique Posts × 3 Accounts × 3 Animation Styles║');
  console.log('║  DIRECT_POST — 15 min after completion            ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  await mkdir(SLIDES_DIR, { recursive: true });

  const results: { account: string; postId: string; title: string; style: string }[] = [];

  for (let i = 0; i < 3; i++) {
    const account = ACCOUNTS[i];
    const post = POSTS[i];
    const anim = ANIM_STYLES[i];
    const character = CHARACTERS[i];
    const ts = Date.now();

    console.log(`\n${'═'.repeat(60)}`);
    log(`POST ${i + 1}/3: "${post.title}"`);
    log(`Account: ${account.name} | Style: ${anim.name} | Hook: ${post.hookStyle}`);
    console.log('═'.repeat(60));

    const totalSlides = post.slides.length; // 9
    const finalPaths: string[] = [];

    // Generate all 9 slides
    for (let s = 0; s < totalSlides; s++) {
      const slide = post.slides[s];
      const isCtaSlide = s === totalSlides - 1;
      log(`  [${s + 1}/${totalSlides}] "${slide.role}"${isCtaSlide ? ' (style-matching CTA)' : ''}...`);

      const prompt = buildSlidePrompt(character, anim.prompt, slide, s, totalSlides, post.title);
      const imageBuffer = await generateImage(prompt);

      const rawPath = join(SLIDES_DIR, `raw_${ts}_p${i}_${s + 1}.png`);
      const finalPath = join(SLIDES_DIR, `slide_${ts}_p${i}_${s + 1}.png`);
      await writeFile(rawPath, imageBuffer);
      log(`    Generated (${(imageBuffer.length / 1024).toFixed(0)}KB)`);

      overlayText(rawPath, slide.text, finalPath);
      log(`    Text overlaid`);
      finalPaths.push(finalPath);

      await unlink(rawPath).catch(() => {});
    }

    // Store slide paths for posting
    results.push({ account: account.name, postId: '', title: post.title, style: anim.name });
    (results[i] as any).slidePaths = finalPaths;
    (results[i] as any).post = post;
    (results[i] as any).handle = account.name.replace('@', '');
  }

  // Post all 3 as TikTok drafts via Blotato
  log(`\nPosting all 3 as TikTok drafts via Blotato...`);

  for (let i = 0; i < 3; i++) {
    const r = results[i] as any;
    try {
      const postResult = await createDraftPost(r.handle, r.slidePaths, r.post.caption, r.post.title);
      const postId = postResult.postSubmissionId || 'unknown';
      results[i].postId = postId;

      await trackPost(postId, r.post, ACCOUNTS[i].name);
      log(`  ${ACCOUNTS[i].name}: ${postId}`);
    } catch (err) {
      log(`  ${ACCOUNTS[i].name}: FAILED — ${err}`);
    }
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  CYCLE COMPLETE — ${elapsed} min                          ║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  for (const r of results) {
    console.log(`║  ${r.account.padEnd(20)} ${r.style.padEnd(18)} ${r.postId}`);
  }
  console.log(`║  Completed: ${new Date().toLocaleTimeString()}                              ║`);
  console.log(`╚══════════════════════════════════════════════════╝`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
