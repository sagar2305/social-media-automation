import { CREDDY_TOPIC_SEARCHES, type CreddyTopicSearch } from './config.js';

export function creddyEditorialRotationSlot(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  const localDay = Math.floor(Date.UTC(value('year'), value('month') - 1, value('day')) / 86_400_000);
  // The reviewed discovery cadence is 08:00 and 18:00 America/New_York.
  return localDay * 2 + (value('hour') >= 13 ? 1 : 0);
}

export function activeCreddyTopicSearches(now = new Date()): CreddyTopicSearch[] {
  const parity = creddyEditorialRotationSlot(now) % 2;
  const byPair = new Map<number, CreddyTopicSearch[]>();
  for (const search of CREDDY_TOPIC_SEARCHES) {
    const pair = byPair.get(search.pair) ?? [];
    pair.push(search);
    byPair.set(search.pair, pair);
  }
  return [...byPair.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, pair]) => pair.sort((a, b) => a.id.localeCompare(b.id))[parity])
    .filter((search): search is CreddyTopicSearch => Boolean(search));
}

