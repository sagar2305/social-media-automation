/**
 * Re-upload existing slides and create posts via Blotato.
 * Run: npx tsx scripts/repost-direct.ts
 */
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

const BLOTATO_KEY = process.env.BLOTATO_API_KEY!;
const BLOTATO_BASE = 'https://backend.blotato.com/v2';

async function blotatoRequest(path: string, options: any = {}): Promise<any> {
  const url = `${BLOTATO_BASE}${path}`;
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

async function resolveBlotAccountId(): Promise<string> {
  const data = await blotatoRequest('/users/me/accounts?platform=tiktok');
  const match = data.items?.find((a: any) => a.username?.toLowerCase() === 'yournotetaker');
  if (!match) throw new Error('No Blotato TikTok account found for yournotetaker');
  return match.id;
}

const POSTS = [
  {
    label: 'Flow 2 (Stop Motion)',
    title: "You're studying wrong. Here's proof.",
    caption: `You're studying wrong and science proves it.\nThese 3 methods changed everything — Minutewise makes them 10x easier.\nSave for exam week\n\n#studytok #studyhacks #studytips #minutewise #examseason`,
    slides: Array.from({ length: 9 }, (_, i) => `posts/slide_1775059329303_flow2_${i + 1}.png`),
  },
  {
    label: 'Flow 3 (Anime/Manga)',
    title: "I stopped taking notes in class and my grades improved",
    caption: `I stopped taking notes in class and my grades actually went UP.\nHere's the method that sounds crazy but actually works — powered by Minutewise.\nSave for exam week\n\n#studytok #notetaking #aistudytools #minutewise #studymethod`,
    slides: Array.from({ length: 9 }, (_, i) => `posts/slide_1775059439723_flow3_${i + 1}.png`),
  },
];

async function main() {
  const blotId = await resolveBlotAccountId();
  console.log(`Blotato account ID: ${blotId}\n`);

  for (const post of POSTS) {
    console.log(`=== ${post.label}: "${post.title}" ===`);

    console.log(`  Posting ${post.slides.length} slides as TikTok draft via Blotato...`);
    const result = await blotatoRequest('/posts', {
      method: 'POST',
      body: {
        post: {
          accountId: blotId,
          content: {
            text: post.caption,
            mediaUrls: post.slides,
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
            title: post.title.slice(0, 90),
          },
        },
      },
    });

    console.log(`  SUBMITTED: ${result.postSubmissionId}\n`);
  }

  console.log('Done. Both posts submitted as TikTok drafts via Blotato.');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
