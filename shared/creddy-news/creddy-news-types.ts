export const NEWS_CATEGORIES = ['Credit cards', 'Banking', 'Points & miles', 'Loyalty', 'Travel rewards'] as const;
export type NewsCategory = typeof NEWS_CATEGORIES[number];
export type NewsContent = {
  headline: string; summary: string; category: NewsCategory; publisher: string;
  source_url: string; image_url: string | null; published_at: number;
};
export type NewsItem = {
  id: string; source_key: string; content: NewsContent;
  provenance: Record<string, unknown>;
  status: 'published' | 'not_published' | 'deleted';
  validation_error: string | null; revision: number; manually_edited: boolean;
  created_at: string; updated_at: string;
  slack_channel: string | null; slack_ts: string | null; slack_revision: number; slack_error: string | null;
};
export type NewsPatch = Pick<NewsContent, 'headline' | 'summary' | 'category'>;

export function publicHttps(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port
      && u.hostname.includes('.') && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)
      && !u.hostname.endsWith('.local') && !u.hostname.includes(':');
  } catch { return false; }
}

export function validateNewsPatch(patch: NewsPatch): void {
  for (const [key, min, max] of [['headline', 10, 160], ['summary', 80, 480]] as const) {
    const value = patch[key];
    if (typeof value !== 'string' || value.trim().length < min || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
      throw new Error(`${key} must contain ${min}-${max} characters.`);
    }
  }
  if (!NEWS_CATEGORIES.includes(patch.category)) throw new Error('Choose a supported news category.');
}

export function validateNewsContent(content: NewsContent, now = Date.now()): void {
  validateNewsPatch(content);
  if (!publicHttps(content.source_url)) throw new Error('A public HTTPS source URL is required.');
  if (!content.publisher?.trim() || content.publisher.length > 100) throw new Error('Publisher is required.');
  if (!Number.isSafeInteger(content.published_at) || content.published_at < 1_000_000_000_000 || content.published_at > now + 300_000) {
    throw new Error('A valid source publication date is required.');
  }
  if (content.image_url !== null && !publicHttps(content.image_url)) throw new Error('Invalid permitted image URL.');
}
