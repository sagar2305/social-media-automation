/**
 * Generate 2 posts (Flow 2 + Flow 3) and save as TikTok drafts via Blotato.
 * Run: npx tsx scripts/generate-two-posts.ts
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { execSync } from 'child_process';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const BLOTATO_KEY = process.env.BLOTATO_API_KEY!;
const SLIDES_DIR = './posts';
const CTA_IMAGES = ['config/cta/cta_classroom.png', 'config/cta/cta_bedroom.png'];

// ─── Account Config ─────────────────────────────────────────
const ACCOUNTS = {
  yournotetaker: 'cmmxd7lo605mnle0y2xe2o1x6',
  grow_withamanda: 'cmn4kitnp02k2nq0yr3ub3k0e',
  hack_my_study: 'cmn4m9ywn0debpb0yi5530vhs',
};

// ─── Post Definitions ───────────────────────────────────────

interface SlideSpec {
  role: string;
  text: string[];
  emoji?: string;
}

interface PostSpec {
  flow: 'animated' | 'emoji_overlay';
  account: string;
  integrationId: string;
  title: string;
  caption: string;
  animStyle: string;
  animPrompt: string;
  character: string;
  scene: string;
  slides: SlideSpec[];
  ctaImage: string;
}

const POST_1_FLOW2: PostSpec = {
  flow: 'animated',
  account: '@yournotetaker',
  integrationId: ACCOUNTS.yournotetaker,
  title: 'Your professor talks at 2x speed?',
  caption: `Your professor talks at 2x speed? Stop scribbling and start studying smarter
Let Minutewise handle the notes so you can focus on learning.
Save for exam week

#studytok #studyhacks #aistudytools #minutewise #collegetips`,
  animStyle: 'Pixar 3D',
  animPrompt: 'Computer animation in Pixar/DreamWorks 3D style, soft lighting, rounded characters, rich textures',
  character: 'A girl with big expressive eyes, brown messy bun hairstyle, wearing an oversized grey hoodie and round glasses, college student',
  scene: 'university lecture hall with warm ambient lighting',
  slides: [
    { role: 'hook', text: ["Your professor talks at", "2x speed and expects you", "to keep up?"] },
    { role: 'problem', text: ["You're scribbling notes so fast", "your hand cramps... and you", "still miss half the lecture."] },
    { role: 'problem', text: ["Then you open your notes", "later and they look like", "ancient hieroglyphics."] },
    { role: 'tip', text: ["Tip 1: Stop writing everything.", "Focus on listening and", "understanding the concept first."] },
    { role: 'tip', text: ["Tip 2: Use Minutewise to record", "your lectures. It transcribes", "everything and creates", "perfect notes for you."] },
    { role: 'tip', text: ["Tip 3: After class, review", "Minutewise summaries + quiz", "yourself with the", "auto-generated flashcards."] },
    { role: 'resolution', text: ["Now you actually understand", "the lecture AND have notes", "better than the class topper."] },
    { role: 'cta', text: ["Follow for more study hacks", "that actually work.", "Save this for your next lecture."] },
  ],
  ctaImage: CTA_IMAGES[0],
};

const POST_2_FLOW3: PostSpec = {
  flow: 'emoji_overlay',
  account: '@grow.withamanda',
  integrationId: ACCOUNTS.grow_withamanda,
  title: '5 AM study routine that got me straight As',
  caption: `5 AM changed everything. Stop cramming at 3 AM — your brain literally can't retain anything sleep-deprived
Minutewise records, transcribes, and makes your notes so you study smarter.
Save for exam week

#5amclub #studyroutine #studytok #minutewise #grindseason`,
  animStyle: 'Watercolor',
  animPrompt: 'Watercolor animation style, soft flowing paint textures, pastel and muted colors, dreamy painterly atmosphere',
  character: 'A boy with messy curly black hair, warm brown skin, wearing a blue crew neck sweater, expressive anime-style face',
  scene: 'cozy bedroom at dawn with soft watercolor sunrise through window',
  slides: [
    { role: 'hook', text: ["I switched to a 5 AM study", "routine and my grades went", "from C's to straight A's."], emoji: '🤔' },
    { role: 'problem', text: ["I used to stay up until 3 AM", "cramming and still forget", "everything by exam day."], emoji: '😰' },
    { role: 'problem', text: ["Caffeine kept me awake but", "my brain was running on empty.", "Zero retention."], emoji: '😰' },
    { role: 'tip', text: ["Step 1: Sleep by 10 PM,", "wake at 5 AM. Your brain", "consolidates memory", "during deep sleep."], emoji: '💡' },
    { role: 'tip', text: ["Step 2: First 30 min — review", "yesterday's notes on Minutewise.", "The AI summaries make", "it effortless."], emoji: '💡' },
    { role: 'tip', text: ["Step 3: Next 90 min — deep study", "using Pomodoro (25 min work,", "5 min break). Use Minutewise", "flashcards to test yourself."], emoji: '💡' },
    { role: 'resolution', text: ["3 weeks in: I understood", "lectures before they even", "happened. My GPA jumped", "from 2.1 to 3.8."], emoji: '🔥' },
    { role: 'cta', text: ["Follow for more routines that", "actually change your grades.", "Save this and try it", "tomorrow morning."], emoji: '👉' },
  ],
  ctaImage: CTA_IMAGES[1],
};

// ─── Gemini Image Generation ────────────────────────────────

async function generateImage(prompt: string): Promise<Buffer> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }),
  });

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
}

function buildPrompt(post: PostSpec, slide: SlideSpec, idx: number, total: number): string {
  const expressionMap: Record<string, string> = {
    hook: 'curious look, raised eyebrow, leaning forward with interest',
    problem: 'frustrated expression, head in hands, slouched, anime-style sweat drops',
    tip: 'focused and excited, pointing up in "aha" moment, eyes lit up with sparkle',
    resolution: 'confident smile, arms crossed proudly, standing tall, triumphant',
    cta: 'warm friendly smile, hand reaching toward viewer, inviting gesture',
  };
  const expression = expressionMap[slide.role] || 'focused';

  if (post.flow === 'emoji_overlay') {
    return `Create an illustrated/animated image in ${post.animPrompt} for a TikTok slideshow. Slide ${idx + 1} of ${total} — ALL slides must belong to the same story.

CHARACTER: ${post.character}
EXPRESSION: ${expression}
NARRATIVE ROLE: "${slide.role}" slide — character emotion must clearly convey this.

SCENE: AI-decided background based on topic "${post.title}". Same environment across all slides with subtle progression.

IMPORTANT: Do NOT include any text, words, letters, emojis, or typography. Clean image only — text and emoji overlays added separately.

Style: ${post.animPrompt}. Expressive anime-style character with exaggerated emotions (sweat drops, sparkle eyes, clenched fist). Expression must CLEARLY change per slide. Consistent character design. Leave upper 60-70% for text. Top-right corner slightly clear for emoji overlay. 3:4 aspect ratio.`;
  }

  // Flow 2: Animated
  return `Create an animated image in ${post.animPrompt} for a TikTok slideshow. Slide ${idx + 1} of ${total} — ALL slides must belong together.

CHARACTER: ${post.character}
EXPRESSION: ${expression}
SCENE: ${post.character}, ${expression}, ${post.scene}.
ANIMATION STYLE: ${post.animPrompt}

IMPORTANT: Do NOT include any text, words, letters, or typography. Clean background image — text added separately.

Style: ${post.animPrompt}. Warm, colorful, visually engaging. Consistent character across all slides. Leave upper 60-70% for text overlay. NOT photorealistic. 3:4 aspect ratio.`;
}

// ─── Text Overlay ───────────────────────────────────────────

function overlayText(rawPath: string, textLines: string[], outputPath: string, emoji?: string): void {
  const textJson = JSON.stringify(textLines);
  const emojiArg = emoji ? ` "${emoji}"` : '';
  execSync(
    `python3 scripts/overlay-text.py "${rawPath}" '${textJson.replace(/'/g, "'\\''")}' "${outputPath}"${emojiArg}`,
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

let _blotCache: Map<string, string> | null = null;
async function resolveBlotAccounts(): Promise<Map<string, string>> {
  if (_blotCache) return _blotCache;
  const data = await blotatoRequest('/users/me/accounts?platform=tiktok');
  const map = new Map<string, string>();
  for (const acc of data.items || []) {
    if (acc.username) map.set(acc.username.toLowerCase(), acc.id);
  }
  _blotCache = map;
  return map;
}

async function createDraft(
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

// ─── Main ───────────────────────────────────────────────────

async function processPost(post: PostSpec, postLabel: string): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${postLabel}: ${post.title}`);
  console.log(`Flow: ${post.flow} | Style: ${post.animStyle} | Account: ${post.account}`);
  console.log('='.repeat(60));

  await mkdir(SLIDES_DIR, { recursive: true });
  const ts = Date.now();
  const totalSlides = post.slides.length;
  const finalPaths: string[] = [];

  // Generate images + overlay text
  for (let i = 0; i < totalSlides; i++) {
    const slide = post.slides[i];
    console.log(`  [${i + 1}/${totalSlides}] Generating "${slide.role}" slide...`);

    const prompt = buildPrompt(post, slide, i, totalSlides);
    const imageBuffer = await generateImage(prompt);

    const rawPath = join(SLIDES_DIR, `raw_${ts}_${postLabel}_${i + 1}.png`);
    const finalPath = join(SLIDES_DIR, `slide_${ts}_${postLabel}_${i + 1}.png`);
    await writeFile(rawPath, imageBuffer);
    console.log(`    Image generated (${(imageBuffer.length / 1024).toFixed(0)}KB)`);

    overlayText(rawPath, slide.text, finalPath, slide.emoji);
    console.log(`    Text overlaid${slide.emoji ? ` + emoji ${slide.emoji}` : ''}`);
    finalPaths.push(finalPath);

    // Clean up raw
    const { unlink } = await import('fs/promises');
    await unlink(rawPath).catch(() => {});
  }

  // Add CTA slide
  finalPaths.push(post.ctaImage);
  console.log(`  [CTA] Using ${post.ctaImage}`);

  // Post as TikTok draft via Blotato
  const handle = post.account.replace('@', '');
  console.log(`\n  Posting ${finalPaths.length} slides as TikTok draft via Blotato...`);
  const result = await createDraft(handle, finalPaths, post.caption, post.title);
  const postId = result.postSubmissionId || 'unknown';
  console.log(`  DRAFT CREATED: ${postId}`);
  console.log(`  Account: ${post.account}`);
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  Generating 2 Posts → Blotato Drafts      ║');
  console.log('║  Post 1: Flow 2 (Animated/Pixar 3D)      ║');
  console.log('║  Post 2: Flow 3 (Emoji Overlay/Watercolor)║');
  console.log('╚══════════════════════════════════════════╝');

  await processPost(POST_1_FLOW2, 'flow2');
  await processPost(POST_2_FLOW3, 'flow3');

  console.log('\n✅ Both drafts saved to TikTok via Blotato. Review and add trending sounds before publishing.');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
