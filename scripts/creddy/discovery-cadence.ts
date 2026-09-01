import { CREDDY_TOPIC_SEARCHES, type CreddyTopicSearch } from './config.js';

export function creddyEditorialRotationSlot(now: Date): number {
  // Rotation follows elapsed UTC hours so DST transitions cannot repeat or
  // skip a search half. New York time remains authoritative for daily slates.
  return Math.floor(now.getTime() / 3_600_000);
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
