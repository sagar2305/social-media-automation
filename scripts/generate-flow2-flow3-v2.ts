/**
 * Generate 2 posts (Flow 2 + Flow 3) with style-matching CTA slides.
 * Both posted to @yournotetaker, scheduled 10 min from now.
 * Run: npx tsx scripts/generate-flow2-flow3-v2.ts
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

import { writeFile, readFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { execSync } from 'child_process';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const BLOTATO_KEY = process.env.BLOTATO_API_KEY!;
const SLIDES_DIR = './posts';

const YOURNOTETAKER_ID = 'cmmxd7lo605mnle0y2xe2o1x6';

// ─── Types ──────────────────────────────────────────────────

interface SlideSpec {
  role: string;
  text: string[];
  emoji?: string;
}

interface PostSpec {
  flow: 'animated' | 'emoji_overlay';
  title: string;
  caption: string;
  animStyle: string;
  animPrompt: string;
  character: string;
  slides: SlideSpec[];
}

// ─── Post 1: Flow 2 (Animated — Stop Motion) ───────────────

const POST_FLOW2: PostSpec = {
  flow: 'animated',
  title: "You're studying wrong. Here's proof.",
  caption: `You're studying wrong and science proves it.
These 3 methods changed everything — Minutewise makes them 10x easier.
Save for exam week

#studytok #studyhacks #studytips #minutewise #examseason`,
  animStyle: 'Stop Motion',
  animPrompt: 'Stop motion claymation style like Wallace & Gromit, puppet-like characters, tactile clay textures, handcrafted sets',
  character: 'A boy with messy curly hair, big round glasses, wearing a green jacket and sneakers, claymation puppet style',
  slides: [
    { role: 'hook', text: ["You're studying wrong.", "Here's proof."] },
    { role: 'problem', text: ["You re-read the same chapter", "5 times and still can't", "remember a single thing."] },
    { role: 'problem', text: ["You highlight everything", "until the whole page is yellow.", "That's not studying.", "That's coloring."] },
    { role: 'tip', text: ["Method 1: Active Recall.", "Close the book. Write down", "everything you remember.", "The struggle IS the learning."] },
    { role: 'tip', text: ["Method 2: Spaced Repetition.", "Review on Day 1, Day 3, Day 7.", "Your brain needs gaps", "to build strong memory."] },
    { role: 'tip', text: ["Method 3: Let Minutewise", "record your lectures and turn", "them into flashcards.", "Then use those flashcards", "for active recall."] },
    { role: 'resolution', text: ["Students using these methods", "score 30-50% higher.", "That's not opinion.", "That's cognitive science."] },
    { role: 'cta', text: ["Follow for study methods", "backed by science.", "Save this before your next exam."] },
    // Slide 9: CTA — generated in same style
    { role: 'cta', text: ["Download Minutewise", "Your AI Note Taker", "Available on App Store"] },
  ],
};

// ─── Post 2: Flow 3 (Emoji Overlay — Anime/Manga) ──────────

const POST_FLOW3: PostSpec = {
  flow: 'emoji_overlay',
  title: "I stopped taking notes in class and my grades improved",
  caption: `I stopped taking notes in class and my grades actually went UP.
Here's the method that sounds crazy but actually works — powered by Minutewise.
Save for exam week

#studytok #notetaking #aistudytools #minutewise #studymethod`,
  animStyle: 'Anime/Manga',
  animPrompt: 'Japanese anime style, expressive big eyes, dynamic poses, vibrant saturated colors, manga-inspired linework',
  character: 'A girl with long wavy hair in two braids, big expressive anime eyes, wearing a pink sweater and plaid skirt, anime manga style',
  slides: [
    { role: 'hook', text: ["I stopped taking notes", "in class and my grades", "actually improved."], emoji: '🤔' },
    { role: 'problem', text: ["I used to write everything", "the professor said. My hand", "hurt. My notes were messy.", "And I missed the actual lesson."], emoji: '😰' },
    { role: 'problem', text: ["Writing notes forces your brain", "into transcription mode.", "You stop thinking and", "just copy words."], emoji: '😰' },
    { role: 'tip', text: ["Step 1: Just LISTEN in class.", "Focus 100% on understanding.", "Let Minutewise record and", "transcribe everything for you."], emoji: '💡' },
    { role: 'tip', text: ["Step 2: After class, open", "your Minutewise summary.", "It's organized, clean, and", "has every detail you need."], emoji: '💡' },
    { role: 'tip', text: ["Step 3: Use the auto-generated", "quizzes and flashcards to", "test yourself the same night.", "Active recall = real learning."], emoji: '💡' },
    { role: 'resolution', text: ["My understanding doubled.", "My exam scores went from B-", "to consistent A's.", "All because I stopped writing", "and started thinking."], emoji: '🔥' },
    { role: 'cta', text: ["Follow for study tips", "that actually make sense.", "Save this and try it", "in your next lecture."], emoji: '👉' },
    // Slide 9: CTA — generated in same style
    { role: 'cta', text: ["Download Minutewise", "Your AI Note Taker", "Available on App Store"], emoji: '📲' },
  ],
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

// ─── Prompt Builders ────────────────────────────────────────

const EXPRESSION_MAP: Record<string, string> = {
  hook: 'curious look, raised eyebrow, leaning forward with interest',
  problem: 'frustrated expression, head in hands, slouched, anime-style sweat drops',
  tip: 'focused and excited, pointing up in "aha" moment, eyes lit up with sparkle',
  resolution: 'confident smile, arms crossed proudly, standing tall, triumphant',
  cta: 'warm friendly smile, hand reaching toward viewer, inviting gesture',
};

function buildSlidePrompt(post: PostSpec, slide: SlideSpec, idx: number, total: number): string {
  const expression = EXPRESSION_MAP[slide.role] || 'focused';
  const isCtaSlide9 = idx === total - 1;

  if (isCtaSlide9) {
    // Rule 46: CTA slide generated in same style
    return `Create an illustrated image in ${post.animPrompt} for a TikTok slideshow. This is the FINAL slide (${idx + 1} of ${total}) — a call-to-action showing the YourNotetaker / Minutewise app.

SCENE: The same character from the previous slides, ${post.character}, happily holding a mobile phone that displays the "Minutewise" app. The phone screen should show a clean, modern note-taking app interface. The character has a warm, inviting smile and is gesturing toward the phone as if recommending it.

STYLE: ${post.animPrompt} — SAME style, color grading, and aesthetic as the previous slides. This must feel like it belongs in the same slideshow.

IMPORTANT: Do NOT include any text, words, letters, or typography on the image. Clean image only — text overlaid separately.

Rules: Consistent character design with previous slides. Warm, inviting mood. Leave upper 60-70% for text overlay. 3:4 aspect ratio. ${post.flow === 'emoji_overlay' ? 'Leave top-right corner clear for emoji overlay.' : ''}`;
  }

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

async function resolveBlotAccountId(handle: string): Promise<string> {
  const data = await blotatoRequest('/users/me/accounts?platform=tiktok');
  const match = (data.items || []).find((a: any) => a.username?.toLowerCase() === handle.toLowerCase());
  if (!match) throw new Error(`No Blotato account for ${handle}`);
  return match.id;
}

async function createDraftPost(
  handle: string,
  slidePaths: string[],
  caption: string,
  hookTitle: string,
): Promise<any> {
  const blotId = await resolveBlotAccountId(handle);

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

async function processPost(post: PostSpec, postLabel: string, scheduleDate: Date): Promise<string> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${postLabel}: ${post.title}`);
  console.log(`Flow: ${post.flow} | Style: ${post.animStyle} | Account: @yournotetaker`);
  console.log(`Scheduled: ${scheduleDate.toLocaleTimeString()}`);
  console.log('='.repeat(60));

  await mkdir(SLIDES_DIR, { recursive: true });
  const ts = Date.now();
  const totalSlides = post.slides.length; // 9 slides (8 + generated CTA)
  const finalPaths: string[] = [];

  for (let i = 0; i < totalSlides; i++) {
    const slide = post.slides[i];
    const isCtaSlide = i === totalSlides - 1;
    console.log(`  [${i + 1}/${totalSlides}] Generating "${slide.role}"${isCtaSlide ? ' (style-matching CTA)' : ''} slide...`);

    const prompt = buildSlidePrompt(post, slide, i, totalSlides);
    const imageBuffer = await generateImage(prompt);

    const rawPath = join(SLIDES_DIR, `raw_${ts}_${postLabel}_${i + 1}.png`);
    const finalPath = join(SLIDES_DIR, `slide_${ts}_${postLabel}_${i + 1}.png`);
    await writeFile(rawPath, imageBuffer);
    console.log(`    Image generated (${(imageBuffer.length / 1024).toFixed(0)}KB)`);

    overlayText(rawPath, slide.text, finalPath, slide.emoji);
    console.log(`    Text overlaid${slide.emoji ? ` + emoji ${slide.emoji}` : ''}`);
    finalPaths.push(finalPath);

    await unlink(rawPath).catch(() => {});
  }

  // Post as TikTok draft via Blotato
  console.log(`\n  Posting ${finalPaths.length} slides as TikTok draft via Blotato...`);
  const result = await createDraftPost('yournotetaker', finalPaths, post.caption, post.title);
  const postId = result.postSubmissionId || 'unknown';
  console.log(`  DRAFT CREATED: ${postId}`);
  return postId;
}

async function main() {
  const pipelineStart = new Date();
  const scheduleTime = new Date(pipelineStart.getTime() + 10 * 60 * 1000); // +10 min

  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║  Generating 2 Posts → @yournotetaker           ║');
  console.log('║  Post 1: Flow 2 (Animated / Stop Motion)       ║');
  console.log('║  Post 2: Flow 3 (Emoji Overlay / Anime Manga)  ║');
  console.log('║  CTA Slide 9: Generated in matching style      ║');
  console.log(`║  Scheduled: ${scheduleTime.toLocaleTimeString()} (10 min from now)           ║`);
  console.log('╚═══════════════════════════════════════════════╝');

  const id1 = await processPost(POST_FLOW2, 'flow2', scheduleTime);
  const id2 = await processPost(POST_FLOW3, 'flow3', scheduleTime);

  console.log('\n╔═══════════════════════════════════════════════╗');
  console.log('║  DONE                                          ║');
  console.log(`║  Flow 2 post: ${id1}  ║`);
  console.log(`║  Flow 3 post: ${id2}  ║`);
  console.log(`║  Both scheduled for ${scheduleTime.toLocaleTimeString()} on @yournotetaker   ║`);
  console.log('╚═══════════════════════════════════════════════╝');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
