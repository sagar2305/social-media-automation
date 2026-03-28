import 'dotenv/config';

export const config = {
  // API Keys
  virlo: {
    apiKey: process.env.VIRLO_API_KEY!,
    baseUrl: 'https://api.virlo.ai/v1',
  },
  postiz: {
    apiKey: process.env.POSTIZ_API_KEY!,
    baseUrl: 'https://api.postiz.com/public/v1',
  },
  nanoBanana: {
    apiKey: process.env.NANO_BANANA_API_KEY!,
    baseUrl: 'https://api.nanobananaapi.ai',
  },

  // TikTok
  tiktokIntegrationId: process.env.TIKTOK_INTEGRATION_ID!,

  // Niche configuration
  niche: {
    name: 'AI tools & tech',
    keywords: ['AI tools', 'productivity apps', 'tech tips', 'AI automation', 'best AI apps'],
    minViews: 10_000,
  },

  // Posting
  posting: {
    mode: 'draft' as const, // 'draft' | 'direct'
    maxPostsPerDay: 2,
    defaultPrivacy: 'PUBLIC_TO_EVERYONE',
  },

  // Paths
  paths: {
    memory: './memory',
    slides: './assets/slides',
  },
} as const;
