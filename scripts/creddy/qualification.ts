import {
  CREDDY_FILTER_KEYWORDS,
  CREDDY_TRAVEL_REWARDS_CONTEXT,
} from './config.js';

export interface CreddyKeywordQualification {
  qualifies: boolean;
  matchedKeywords: string[];
  rejectedBroadMatches: string[];
  hasTravelRewardsContext: boolean;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();
}

function hasRewardsContextNearKeyword(text: string, keyword: string): boolean {
  let offset = text.indexOf(keyword);
  while (offset >= 0) {
    const start = Math.max(0, offset - 220);
    const end = Math.min(text.length, offset + keyword.length + 220);
    const window = text.slice(start, end);
    if (CREDDY_TRAVEL_REWARDS_CONTEXT.some((term) => window.includes(term))) return true;
    offset = text.indexOf(keyword, offset + keyword.length);
  }
  return false;
}

/**
 * Applies OR logic across the configured keywords.
 *
 * Every configured OR keyword is guarded by strong travel/loyalty context.
 * This prevents generic uses of "redemption", "status", "tools", or "sweet
 * spot" from qualifying gas deals, software, sports, and other unrelated news.
 */
export function qualifyCreddyText(value: string): CreddyKeywordQualification {
  const text = normalize(value);
  const hasTravelRewardsContext = CREDDY_TRAVEL_REWARDS_CONTEXT.some((term) =>
    text.includes(term),
  );

  const matchedKeywords: string[] = [];
  const rejectedBroadMatches: string[] = [];

  for (const keyword of CREDDY_FILTER_KEYWORDS) {
    if (!text.includes(keyword)) continue;
    if (!hasTravelRewardsContext || !hasRewardsContextNearKeyword(text, keyword)) {
      rejectedBroadMatches.push(keyword);
      continue;
    }
    matchedKeywords.push(keyword);
  }

  return {
    qualifies: matchedKeywords.length > 0,
    matchedKeywords,
    rejectedBroadMatches,
    hasTravelRewardsContext,
  };
}
