import { mkdir, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { config, FlowType } from '../config/config.js';
import { log } from './api-client.js';
import type { GeneratedContent } from './text_overlay.js';

interface GeminiImageResponse {
  predictions?: { bytesBase64Encoded: string; mimeType: string }[];
  generatedImages?: { image: { imageBytes: string } }[];
}

// ─── Font Styles (one picked per post, consistent across all slides) ──

const FONT_STYLES = [
  'elegant serif italic font like Playfair Display Italic, with subtle white glow behind text',
  'clean rounded sans-serif font like Nunito Bold, with soft drop shadow',
  'modern geometric sans-serif font like Poppins SemiBold, with thin white outline',
  'handwritten cursive script font like Dancing Script, with gentle shadow',
  'bold condensed sans-serif font like Bebas Neue, with dark shadow for contrast',
];

// ─── Spell Check & Text Cleanup (4-pass system) ───────────────

const BRAND_NAME = 'Minutewise';

// Each entry: [pattern, replacement]
const SPELLING_FIXES: [RegExp, string][] = [
  // Brand name — catch ALL variants
  [/\bMinuteWise\b/g, 'Minutewise'],
  [/\bminute\s*wise\b/gi, 'Minutewise'],
  [/\bMinute\s*Wise\b/g, 'Minutewise'],
  [/\bMINUTEWISE\b/g, 'Minutewise'],
  [/\bminuewise\b/gi, 'Minutewise'],
  [/\bminutwise\b/gi, 'Minutewise'],
  [/\bmnute\s*wise\b/gi, 'Minutewise'],
  [/\bminutewse\b/gi, 'Minutewise'],
  [/\bminutewis\b/gi, 'Minutewise'],

  // Proper nouns
  [/\bpomodoro\b/gi, 'Pomodoro'],
  [/\bfeynman\b/gi, 'Feynman'],
  [/\bleitner\b/gi, 'Leitner'],
  [/\btiktok\b/gi, 'TikTok'],

  // Contractions
  [/\bdont\b/g, "don't"],
  [/\bdoesnt\b/g, "doesn't"],
  [/\bcant\b/g, "can't"],
  [/\bwont\b/g, "won't"],
  [/\bisnt\b/g, "isn't"],
  [/\bthats\b/g, "that's"],
  [/\byoure\b/g, "you're"],
  [/\btheyre\b/g, "they're"],
  [/\bwouldnt\b/g, "wouldn't"],
  [/\bcouldnt\b/g, "couldn't"],
  [/\bshouldnt\b/g, "shouldn't"],
  [/\bwasnt\b/g, "wasn't"],
  [/\bwerent\b/g, "weren't"],
  [/\bhavent\b/g, "haven't"],
  [/\bhasnt\b/g, "hasn't"],
  [/\bIm\b/g, "I'm"],
  [/\bIve\b/g, "I've"],
  [/\bIll\b/g, "I'll"],

  // Common misspellings
  [/\brecieved?\b/gi, 'received'],
  [/\bacheive\b/gi, 'achieve'],
  [/\bseperately?\b/gi, 'separately'],
  [/\boccured\b/gi, 'occurred'],
  [/\bdefinately\b/gi, 'definitely'],
  [/\bdefin[ai]tly\b/gi, 'definitely'],
  [/\bwierd\b/gi, 'weird'],
  [/\buntill?\b/gi, 'until'],
  [/\baccomodate\b/gi, 'accommodate'],
  [/\boccassion\b/gi, 'occasion'],
  [/\bneccessary\b/gi, 'necessary'],
  [/\bneccesary\b/gi, 'necessary'],
  [/\bgrammer\b/gi, 'grammar'],
  [/\bwritting\b/gi, 'writing'],
  [/\bstuding\b/gi, 'studying'],
  [/\bbecuase\b/gi, 'because'],
  [/\bbecasue\b/gi, 'because'],
  [/\bwich\b/gi, 'which'],
  [/\bwether\b/gi, 'whether'],
  [/\blenght\b/gi, 'length'],
  [/\bstregnth\b/gi, 'strength'],
  [/\bbeggining\b/gi, 'beginning'],
  [/\bremeber\b/gi, 'remember'],
  [/\bexercize\b/gi, 'exercise'],
  [/\bproffessor\b/gi, 'professor'],
  [/\bproffesor\b/gi, 'professor'],
  [/\bschedual\b/gi, 'schedule'],
  [/\bscheldule\b/gi, 'schedule'],
  [/\benviroment\b/gi, 'environment'],
  [/\bknowlege\b/gi, 'knowledge'],
  [/\befficeint\b/gi, 'efficient'],
  [/\beffecient\b/gi, 'efficient'],
  [/\bproductivty\b/gi, 'productivity'],
  [/\bautomaticly\b/gi, 'automatically'],
  [/\bflashcrad\b/gi, 'flashcard'],
  [/\blecure\b/gi, 'lecture'],
  [/\blecutre\b/gi, 'lecture'],
  [/\bsumarry\b/gi, 'summary'],
  [/\bsumary\b/gi, 'summary'],
  [/\bteh\s/g, 'the '],
  [/\bhte\s/g, 'the '],

  // Standalone "i" → "I"
  [/\bi\b(?=[^a-zA-Z'])/g, 'I'],
];

function singlePassSpellCheck(text: string): string {
  let cleaned = text;
  for (const [pattern, replacement] of SPELLING_FIXES) {
    cleaned = cleaned.replace(pattern, replacement);
  }
  cleaned = cleaned.replace(/  +/g, ' ').trim();
  cleaned = cleaned.replace(/\s+([.,!?])/g, '$1');
  cleaned = cleaned.replace(/([.,!?])(?=[A-Za-z])/g, '$1 ');
  return cleaned;
}

function spellCheck(text: string): string {
  // Run 4 passes to catch cascading fixes
  let result = text;
  for (let pass = 0; pass < 4; pass++) {
    const before = result;
    result = singlePassSpellCheck(result);
    if (result === before) break;
  }
  // Final brand name safety net
  result = result.replace(/minute\s*wise/gi, BRAND_NAME);
  return result;
}

function prepareSlideText(top: string, center: string, bottom: string): string {
  const parts = [top, center, bottom].filter(Boolean).map(spellCheck);
  return parts.join('\n');
}

function validateAllTexts(texts: string[]): string[] {
  // Final validation across all slides — one last check
  return texts.map((text) => {
    let validated = spellCheck(text);
    validated = validated.replace(/minute\s*wise/gi, BRAND_NAME);
    return validated;
  });
}

// ─── Flow 2: Animation Styles (18 styles, rotated per post) ──

export const ANIMATION_STYLES = [
  { name: 'Pixar 3D', prompt: 'Computer animation in Pixar/DreamWorks 3D style, soft lighting, rounded characters, rich textures' },
  { name: 'Stop Motion', prompt: 'Stop motion claymation style like Wallace & Gromit, puppet-like characters, tactile clay textures, handcrafted sets' },
  { name: 'Kurzgesagt Flat', prompt: 'Modern flat animation in Kurzgesagt style, motion graphics, clean geometric shapes, bold flat colors, minimal shadows' },
  { name: '90s Cartoon', prompt: '90s cartoon style like Dexter\'s Lab or Powerpuff Girls, bold black outlines, flat bright colors, exaggerated expressions' },
  { name: 'Watercolor', prompt: 'Watercolor animation style, soft flowing paint textures, pastel and muted colors, dreamy painterly atmosphere' },
  { name: 'Paper Cutout', prompt: 'Paper cutout animation style like South Park, layered paper textures, flat construction paper characters, simple shapes' },
  { name: 'Retro Pixel Art', prompt: '8-bit/16-bit retro pixel art style, game aesthetic, pixelated characters, limited color palette, nostalgic' },
  { name: 'Anime/Manga', prompt: 'Japanese anime style, expressive big eyes, dynamic poses, vibrant saturated colors, manga-inspired linework' },
  { name: 'Chalk/Blackboard', prompt: 'Drawn on chalkboard with chalk textures, green/black board background, white and colored chalk lines, classroom feel' },
  { name: 'Storybook', prompt: 'Children\'s storybook illustration style, warm hand-drawn feel, soft rounded characters, cozy whimsical atmosphere' },
  { name: 'Pop Art', prompt: 'Andy Warhol pop art style, bold colors, halftone dots, comic book aesthetic, high contrast, Ben-Day dots' },
  { name: 'Minimalist Line Art', prompt: 'Clean single-line drawing style, elegant minimal lines, white background, sparse color accents, sophisticated' },
  { name: 'Neon/Cyberpunk', prompt: 'Neon cyberpunk style, glowing neon outlines on dark backgrounds, electric blue and pink colors, futuristic' },
  { name: 'Sketch/Pencil', prompt: 'Hand-drawn pencil sketch style, graphite textures, cross-hatching, notebook paper feel, raw and authentic' },
  { name: 'Isometric', prompt: 'Isometric illustration style, 3/4 top-down view, clean geometry, bright colors, infographic-like precision' },
  { name: 'Collage Art', prompt: 'Mixed media collage art style, torn paper textures, magazine cutouts, layered compositions, eclectic and trendy' },
  { name: 'Gouache Paint', prompt: 'Gouache painting style, opaque matte colors, visible brush strokes, muted warm palette, artisanal craft feel' },
  { name: 'Retro 70s', prompt: 'Retro 1970s illustration style, groovy rounded fonts, warm orange/brown/mustard palette, funky patterns, vintage vibes' },
];

let animationStyleIndex = Math.floor(Math.random() * ANIMATION_STYLES.length);

function getNextAnimationStyle(): typeof ANIMATION_STYLES[number] {
  const style = ANIMATION_STYLES[animationStyleIndex % ANIMATION_STYLES.length];
  animationStyleIndex++;
  return style;
}

// ─── Characters ────────────────────────────────────────────────

const PHOTO_CHARACTERS = [
  { gender: 'female', description: 'A young woman with curly brown hair, warm brown skin, wearing a cozy cream knit sweater and gold hoop earrings' },
  { gender: 'male', description: 'A young man with short fade haircut, dark skin, wearing a navy blue hoodie and wireless earbuds' },
  { gender: 'female', description: 'A young Asian woman with straight black hair in a ponytail, wearing an oversized sage green cardigan and round glasses' },
  { gender: 'male', description: 'A young man with wavy auburn hair and freckles, wearing a vintage denim jacket over a white t-shirt' },
  { gender: 'female', description: 'A young woman with long braids, deep brown skin, wearing a burgundy turtleneck and silver necklace' },
  { gender: 'male', description: 'A young Latino man with short dark hair, wearing a gray crewneck sweatshirt and a simple watch' },
];

const ANIMATED_CHARACTERS = [
  { gender: 'female', description: 'A girl with big expressive eyes, short bob haircut with bangs, wearing a yellow hoodie and jeans' },
  { gender: 'male', description: 'A boy with messy curly hair, big round glasses, wearing a green jacket and sneakers' },
  { gender: 'female', description: 'A girl with long wavy hair in two braids, wearing a pink sweater and plaid skirt' },
  { gender: 'male', description: 'A boy with a beanie hat, dark skin, wearing an orange puffer vest over a white long-sleeve' },
  { gender: 'female', description: 'A girl with short pixie cut, big eyes, wearing a denim overall dress over a striped shirt' },
  { gender: 'male', description: 'A boy with spiky hair, wearing a red varsity jacket with white sleeves' },
];

const STUDY_SCENES = [
  'studying at a wooden desk in a cozy library with warm lamp light',
  'sitting in a modern dorm room with fairy lights and books',
  'working at a coffee shop table with a latte and laptop',
  'studying in a bright classroom at a desk with notebooks',
  'sitting on a bed with textbooks spread around, focused',
  'at a study desk with headphones on, surrounded by sticky notes',
];

// ─── Prompt Builders (with consistent font enforcement) ────────

// Prompts generate CLEAN images without any text — text is overlaid separately

function buildPhotorealisticPrompt(
  character: string,
  scene: string,
  slideRole: string,
  slideNumber: number,
  totalSlides: number,
): string {
  let expression = 'focused and determined';
  if (slideRole === 'hook') expression = 'looking directly at camera with a confident smirk';
  if (slideRole === 'knowledge_gap') expression = 'surprised, eyebrows raised, mouth slightly open';
  if (slideRole === 'minutewise') expression = 'smiling while looking at phone screen';
  if (slideRole === 'emotional') expression = 'genuinely happy, slight smile, relaxed';
  if (slideRole === 'cta') expression = 'warm friendly smile, holding up a phone showing the MinuteWise app on screen, inviting gesture toward viewer';

  return `Create a photorealistic, cinematic image for a TikTok slideshow background. This is slide ${slideNumber} of ${totalSlides} — ALL slides must look like they belong together.

SCENE: ${character}, ${expression}, ${scene}.

CHARACTER (must be IDENTICAL in every slide): ${character}
— Same face, same hair, same skin tone, same outfit, same accessories in EVERY slide. No variation allowed.

IMPORTANT: Do NOT include any text, words, letters, or typography on the image. This is a clean background — text will be added separately.

Style rules:
- Photorealistic, cinematic quality — shot on Arri Alexa or Sony A7
- Character must be the SAME PERSON in every slide — same face, same features, same clothing
- Same location, same lighting setup, same color grading across all slides
- Cinematic color grading — warm golden or cool moody tones (consistent throughout)
- Modern, aesthetic, Instagram-worthy composition
- Shallow depth of field for professional look
- Leave upper 60-70% of image for text overlay (TikTok safe zone)
- NO text, NO words, NO letters, NO typography anywhere
- NO cartoon, NO illustration, NO 3D render — pure photorealistic
- 3:4 aspect ratio (portrait, taller than wide) for mobile viewing`;
}

function buildAnimatedPrompt(
  character: string,
  scene: string,
  slideRole: string,
  animStyle: string,
  slideNumber: number,
  totalSlides: number,
): string {
  let expression = 'focused and studying';
  if (slideRole === 'hook') expression = 'looking excited and energetic, pointing at viewer';
  if (slideRole === 'knowledge_gap') expression = 'curious, head tilted, thinking pose';
  if (slideRole === 'minutewise') expression = 'happily holding up a phone showing an app';
  if (slideRole === 'emotional') expression = 'proud, confident pose, thumbs up';
  if (slideRole === 'cta') expression = 'warm friendly smile, holding up a phone showing the MinuteWise app on screen, inviting gesture toward viewer';

  return `Create an animated image in ${animStyle} for a TikTok slideshow background. This is slide ${slideNumber} of ${totalSlides} — ALL slides must look like they belong together.

SCENE: ${character}, ${expression}, ${scene}.

CHARACTER (must be IDENTICAL in every slide): ${character}
— Same face shape, same eye color, same hairstyle, same outfit, same accessories in EVERY slide.

ANIMATION STYLE (must be IDENTICAL in every slide): ${animStyle}
— Same rendering technique, same line weight, same color treatment, same lighting style in EVERY slide.

IMPORTANT: Do NOT include any text, words, letters, or typography on the image. This is a clean background — text will be added separately.

Style rules:
- ${animStyle} — fully commit to this EXACT animation style, no variation
- Character must be PIXEL-PERFECT CONSISTENT across all slides — same design, same proportions, same outfit, same face
- Same background environment and color temperature across all slides
- Warm, colorful, visually engaging
- Leave upper 60-70% of image for text overlay (TikTok safe zone)
- NO text, NO words, NO letters, NO typography anywhere
- NOT photorealistic — fully animated/illustrated
- 3:4 aspect ratio (portrait, taller than wide) for mobile viewing`;
}

// ─── Flow 3: Emoji Overlay Prompts ───────────────────────────
// Illustrated characters with expressive emotions matching the narrative arc
// Background decided by AI based on topic — no fixed scene list

const EMOJI_FLOW_EXPRESSIONS: Record<string, string> = {
  hook: 'curious look, raised eyebrow, leaning forward with interest, wide eyes',
  problem: 'frustrated expression, head in hands, slouched posture, biting lip, anime-style sweat drops for stress',
  tip: 'focused and excited, pointing up in an "aha" moment, eyes lit up with sparkle, determined expression',
  resolution: 'confident smile, arms crossed proudly, standing tall, triumphant pose, anime-style sparkle eyes',
  cta: 'warm friendly smile, holding up a phone showing the MinuteWise app on screen, inviting welcoming gesture toward the viewer',
  // Fallbacks for legacy roles
  knowledge_gap: 'surprised expression, eyebrows raised, mouth slightly open',
  value: 'focused and attentive, taking notes, nodding',
  minutewise: 'happily holding up a phone showing an app, excited',
  emotional: 'genuinely happy, slight smile, relaxed and satisfied',
};

function buildEmojiOverlayPrompt(
  character: string,
  slideRole: string,
  slideNumber: number,
  totalSlides: number,
  topic: string,
  animStyle: string,
): string {
  const expression = EMOJI_FLOW_EXPRESSIONS[slideRole] || 'focused and attentive';

  return `Create an illustrated/animated image in ${animStyle} for a TikTok slideshow. This is slide ${slideNumber} of ${totalSlides} — ALL slides must look like they belong to the same story.

CHARACTER (must be IDENTICAL in every slide): ${character}
— Same face shape, same eye color, same hairstyle, same outfit, same accessories in EVERY slide. No variation allowed.

EXPRESSION: ${expression}
NARRATIVE ROLE: This is a "${slideRole}" slide — the character's emotion and body language must clearly convey this.

ANIMATION STYLE (must be IDENTICAL in every slide): ${animStyle}
— Same rendering technique, same line weight, same color treatment, same lighting style in EVERY slide.

SCENE: The AI should decide the background environment based on the topic "${topic}". Choose a setting that naturally fits (e.g., cozy library for study tips, modern dorm for student life, bright classroom for learning hacks). Keep the SAME environment, same room, same color temperature across all slides. Only subtle progression allowed.

IMPORTANT: Do NOT include any text, words, letters, emojis, or typography on the image. Clean image only — text and emoji overlays added separately.

Style rules:
- ${animStyle} — fully commit to this EXACT animation style, no variation
- Character must be PIXEL-PERFECT CONSISTENT — same design, same proportions, same outfit, same face in every slide
- Expressive emotions encouraged (sweat drops, sparkle eyes, clenched fist) but character design stays fixed
- Expression CLEARLY changes slide to slide — emotional arc visible without text
- Same background environment and lighting across all slides
- Warm, colorful, visually engaging
- Leave upper 60-70% for text overlay (TikTok safe zone)
- Leave top-right corner slightly clear for emoji overlay
- NO text, NO words, NO letters, NO emojis baked into the image
- NOT photorealistic — fully illustrated/animated
- 3:4 aspect ratio (portrait, taller than wide) for mobile viewing`;
}

// ─── CTA Slide 9 Prompt (Rule 46: generated in matching style) ──

function buildCtaSlidePrompt(
  character: string,
  flow: string,
  animStyle: string | null,
  scene: string,
  totalSlides: number,
): string {
  const styleDesc = flow === 'photorealistic'
    ? 'Photorealistic, cinematic quality — shot on Arri Alexa or Sony A7. Cinematic color grading, shallow depth of field.'
    : `${animStyle} — fully commit to this animation style. Warm, colorful, visually engaging.`;

  return `Create an image for a TikTok slideshow. This is the FINAL slide (${totalSlides} of ${totalSlides}) — a call-to-action showing the Minutewise app.

SCENE: ${character}, happily holding a mobile phone. The phone screen clearly displays the "Minutewise" app — show the app name "Minutewise" written on the phone screen in a clean modern UI with a note-taking interface. The character has a warm, inviting smile and is gesturing toward the phone as if recommending the app to the viewer.

STYLE: ${styleDesc} — MUST match the exact same style, color grading, and aesthetic as slides 1-${totalSlides - 1}. This slide must feel like it belongs in the same slideshow.

CRITICAL REQUIREMENTS:
- The phone screen MUST show the word "Minutewise" as the app name — this is the key branding element
- The phone should show a clean, modern note-taking app interface with the Minutewise name visible
- Character must look CONSISTENT with the previous slides (same design, outfit, face)
- Warm, inviting mood — the character is recommending this app
- Leave upper 60-70% of the image for text overlay (TikTok safe zone)
- 3:4 aspect ratio (portrait, taller than wide) for mobile viewing
- NO other text besides "Minutewise" on the phone screen`;
}

// ─── Image Generation (gemini-2.5-flash-image) ────────────────

interface GeminiGenerateResponse {
  candidates?: {
    content: {
      parts: ({ inlineData: { data: string; mimeType: string } } | { text: string })[];
    };
  }[];
  error?: { code: number; message: string };
}

async function generateImage(prompt: string, maxRetries = 3): Promise<Buffer> {
  const url = `${config.gemini.baseUrl}/models/gemini-2.5-flash-image:generateContent?key=${config.gemini.apiKey}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      if (response.status >= 500 && attempt < maxRetries) {
        log(`  Gemini API ${response.status} — retrying (${attempt}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw new Error(`Gemini API ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as GeminiGenerateResponse;

    if (data.error) {
      if (data.error.code >= 500 && attempt < maxRetries) {
        log(`  Gemini API ${data.error.code} — retrying (${attempt}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw new Error(`Gemini API ${data.error.code}: ${data.error.message}`);
    }

    // Find the image part in the response
    const parts = data.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if ('inlineData' in part && part.inlineData?.data) {
        return Buffer.from(part.inlineData.data, 'base64');
      }
    }

    throw new Error('No image data in response');
  }

  throw new Error('All retries exhausted');
}

// ─── Main Export ───────────────────────────────────────────────

export async function generateSlidesForPost(content: GeneratedContent): Promise<string[]> {
  const { flow, accountIndex } = content;
  const slidesDir = config.paths.slides;
  await mkdir(slidesDir, { recursive: true });

  // ── Step 1: Prepare and spell-check ALL text first (4 passes) ──
  log('=== PREPARING SLIDE TEXT (4-pass spell check) ===');
  let preparedTexts: string[] = [];
  for (let i = 0; i < content.slides.length; i++) {
    const slide = content.slides[i];
    const cleaned = prepareSlideText(slide.top, slide.center, slide.bottom);
    preparedTexts.push(cleaned);
  }

  // Final validation pass across all texts
  preparedTexts = validateAllTexts(preparedTexts);

  // Log all cleaned texts
  for (let i = 0; i < preparedTexts.length; i++) {
    log(`  Slide ${i + 1} text: "${preparedTexts[i].replace(/\n/g, ' | ')}"`);
  }

  // ── Step 2: Pick consistent character + scene ──
  const characters = flow === 'photorealistic' ? PHOTO_CHARACTERS : ANIMATED_CHARACTERS;
  const character = characters[(accountIndex + Date.now()) % characters.length];
  const scene = STUDY_SCENES[(accountIndex + Math.floor(Date.now() / 1000)) % STUDY_SCENES.length];

  let animStyle: typeof ANIMATION_STYLES[number] | null = null;
  if (flow === 'animated' || flow === 'emoji_overlay') {
    animStyle = getNextAnimationStyle();
  }

  log('=== IMAGE GENERATION (clean images, no text) ===');
  log(`Flow: ${flow}`);
  log(`Character: ${character.description.slice(0, 60)}...`);
  if (animStyle) log(`Animation style: ${animStyle.name}`);

  // ── Step 3: Generate CLEAN images (no text) ──
  const timestamp = Date.now();
  const rawPaths: string[] = [];
  const finalPaths: string[] = [];
  const totalSlides = content.slides.length;

  for (let i = 0; i < totalSlides; i++) {
    const slide = content.slides[i];
    const isCtaSlide9 = i === totalSlides - 1 && slide.role === 'cta';

    let prompt: string;
    if (isCtaSlide9) {
      // Rule 46: CTA slide generated in matching style with Minutewise on phone
      prompt = buildCtaSlidePrompt(
        character.description,
        flow,
        animStyle?.prompt || null,
        scene,
        totalSlides,
      );
    } else if (flow === 'photorealistic') {
      prompt = buildPhotorealisticPrompt(character.description, scene, slide.role, i + 1, totalSlides);
    } else if (flow === 'emoji_overlay') {
      prompt = buildEmojiOverlayPrompt(character.description, slide.role, i + 1, totalSlides, content.title, animStyle!.prompt);
    } else {
      prompt = buildAnimatedPrompt(character.description, scene, slide.role, animStyle!.prompt, i + 1, totalSlides);
    }

    log(`Generating slide ${i + 1}/${totalSlides} [${slide.role}]${isCtaSlide9 ? ' (style-matching CTA)' : ''} (clean image)...`);

    try {
      const imageBuffer = await generateImage(prompt);
      const rawPath = join(slidesDir, `raw_${timestamp}_a${accountIndex}_${i + 1}.png`);
      await writeFile(rawPath, imageBuffer);
      rawPaths.push(rawPath);
      log(`  Raw image saved (${(imageBuffer.length / 1024).toFixed(0)}KB)`);
    } catch (err) {
      log(`  ERROR: ${err}`);
      throw err;
    }
  }

  // ── Step 4: Overlay text using Python script (TikTok-style) ──
  log('=== TEXT OVERLAY (TikTok style) ===');
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  for (let i = 0; i < totalSlides; i++) {
    const rawPath = rawPaths[i];
    const finalPath = join(slidesDir, `slide_${timestamp}_a${accountIndex}_${i + 1}.png`);
    const textLines = preparedTexts[i].split('\n');
    const textJson = JSON.stringify(textLines);

    // For emoji_overlay flow, pass the emoji as a 4th argument
    const emoji = flow === 'emoji_overlay' ? (content.slides[i]?.emoji || '') : '';
    const emojiArg = emoji ? ` "${emoji}"` : '';

    try {
      await execAsync(
        `python3 scripts/overlay-text.py "${rawPath}" '${textJson.replace(/'/g, "'\\''")}' "${finalPath}"${emojiArg}`,
        { cwd: process.cwd() },
      );
      finalPaths.push(finalPath);
      log(`  Slide ${i + 1}: text overlaid${emoji ? ` + emoji ${emoji}` : ''}`);
    } catch (err) {
      log(`  ERROR overlaying text on slide ${i + 1}: ${err}`);
      throw err;
    }

    // Remove raw image
    await unlink(rawPath).catch(() => {});
  }

  log(`=== COMPLETE (${finalPaths.length} slides with text) ===`);
  return finalPaths;
}

// Backwards compat
export async function generateSlides(content: GeneratedContent): Promise<string[]> {
  return generateSlidesForPost(content);
}
