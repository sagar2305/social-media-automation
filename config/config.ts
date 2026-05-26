import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local', override: true });

export type FlowType = 'photorealistic' | 'animated' | 'emoji_overlay';
export type PostingPath = 'direct' | 'draft';  // Path 1: DIRECT_POST | Path 2: UPLOAD (TikTok drafts)

export interface TikTokAccount {
  id: string;     // Blotato account ID
  name: string;   // Display name (e.g., '@yournotetaker')
  handle: string; // TikTok handle without @
}

// Mutable so scripts/account_loader.ts can replace contents at runtime with the
// dashboard-managed list from Supabase.
const tiktokAccounts: TikTokAccount[] = [
  { id: 'cmmxd7lo605mnle0y2xe2o1x6', name: '@yournotetaker',     handle: 'yournotetaker' },
  { id: '37045',                    name: '@grow.withamanda',    handle: 'grow.withamanda' },
  { id: '37043',                    name: '@miniutewise_thomas', handle: 'miniutewise_thomas' },
  { id: '37047',                    name: '@grow.with.claudia',  handle: 'grow.with.claudia' },
];

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`FATAL: Missing required environment variable ${name}. Check .env.local`);
    process.exit(1);
  }
  return val;
}

export const config = {
  // API Keys — all required. Cycle fails fast at startup if any are missing.
  virlo: {
    apiKey: requireEnv('VIRLO_API_KEY'),
    baseUrl: 'https://api.virlo.ai/v1',
  },
  gemini: {
    apiKey: requireEnv('GEMINI_API_KEY'),
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  blotato: {
    apiKey: requireEnv('BLOTATO_API_KEY'),
    baseUrl: 'https://backend.blotato.com/v2',
  },
  scrapeCreators: {
    apiKey: requireEnv('SCRAPECREATORS_API_KEY'),
    baseUrl: 'https://api.scrapecreators.com',
  },

  // TikTok accounts (connected to Blotato). Source of truth at runtime is the
  // Supabase `accounts` table, loaded by scripts/account_loader.ts at the start
  // of each cycle. The list above is a hard-coded fallback when the DB is
  // unreachable so the cycle keeps running.
  tiktokAccounts,

  // Niche configuration
  niche: {
    name: 'Study tips & AI tools for students',
    keywords: ['study tips', 'study hacks', 'student life', 'AI tools for students', 'AI note taker', 'productivity apps for students'],
    minViews: 10_000,
  },

  // Brand
  brand: {
    app: 'MinuteWise',
    tiktokHandle: '@yournotetaker',
    tagline: 'AI note-taker for students',
    appStoreNote: 'Available on iOS App Store',
  },

  // Posting
  posting: {
    mode: 'draft' as const,
    service: 'blotato' as const,
    maxPostsPerDay: 2,
    defaultPrivacy: 'PUBLIC_TO_EVERYONE',
  },

  // Paths
  paths: {
    memory: './data',
    slides: './posts',
    cta: './config/cta',
    templates: './config/caption_templates.csv',
  },
} as const;
