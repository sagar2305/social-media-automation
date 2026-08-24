import { CREDDY_DISCOVERY_PROFILE, CREDDY_TRAVEL_REWARDS_CONTEXT } from './config.js';

export type DiscoveryClass = 'core' | 'adjacent' | 'low_relevance';

export interface SelectableDiscoveryCandidate {
  url: string;
  laneId: string;
  discoveredTitle?: string;
  discoveredDescription?: string;
  publishedAt?: string;
  prefetchedMarkdown?: string;
}

export interface ClassifiedDiscoveryCandidate<T> {
  candidate: T;
  discoveryClass: DiscoveryClass;
  reason: string;
}

const CORE_SIGNALS = [
  'transfer bonus', 'transfer partner', 'award chart', 'award space', 'devaluation',
  'redemption', 'sweet spot', 'status match', 'status challenge', 'elite status',
  'points sale', 'miles sale', 'welcome offer', 'card benefit', 'loyalty program',
];

const OBVIOUS_NOISE = [
  /\b(?:netflix|k-?drama|video game|gta\s*6|formula\s*1|f1\s+title|volleyball|football|cricket)\b/i,
  /\b(?:blood sugar|medical|metabolic|hospital|dinosaur park)\b/i,
  /\b(?:flight cancellations?|flight delays?|airport departures?|air traffic controller strike)\b/i,
  /\b(?:hotel bar|hotel earns arboretum status|filming status|migration status)\b/i,
];

function editorialRotationSlot(now: Date): number {
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
  // Numbering those editorial windows directly stays sequential across DST.
  return localDay * 2 + (value('hour') >= 13 ? 1 : 0);
}

function normalized(candidate: SelectableDiscoveryCandidate): string {
  return `${candidate.discoveredTitle ?? ''} ${candidate.discoveredDescription ?? ''}`
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyDiscoveryCandidate(
  candidate: SelectableDiscoveryCandidate,
  now = new Date(),
): Pick<ClassifiedDiscoveryCandidate<SelectableDiscoveryCandidate>, 'discoveryClass' | 'reason'> {
  const text = normalized(candidate);
  const publishedAt = candidate.publishedAt ? Date.parse(candidate.publishedAt) : Number.NaN;
  if (Number.isFinite(publishedAt) && now.getTime() - publishedAt > CREDDY_DISCOVERY_PROFILE.freshnessHours * 60 * 60 * 1000) {
    return { discoveryClass: 'low_relevance', reason: 'outside the 24-hour news window' };
  }
  if (OBVIOUS_NOISE.some((pattern) => pattern.test(text))) {
    return { discoveryClass: 'low_relevance', reason: 'obvious non-points-and-miles topic' };
  }
  const hasRewardsContext = CREDDY_TRAVEL_REWARDS_CONTEXT.some((term) => text.includes(term));
  if (hasRewardsContext && CORE_SIGNALS.some((term) => text.includes(term))) {
    return { discoveryClass: 'core', reason: 'core points-and-miles discovery signal' };
  }
  return {
    discoveryClass: 'adjacent',
    reason: hasRewardsContext
      ? 'adjacent travel-rewards exploration'
      : 'unknown or broad source candidate reserved for exploration',
  };
}

function roundRobin<T extends SelectableDiscoveryCandidate>(
  items: T[],
  limit: number,
  rotationSlot: number,
  oldestFirst = false,
): T[] {
  const lanes = new Map<string, T[]>();
  for (const item of items) {
    const lane = lanes.get(item.laneId) ?? [];
    lane.push(item);
    lanes.set(item.laneId, lane);
  }
  for (const lane of lanes.values()) {
    lane.sort(oldestFirst
      ? (a, b) => String(a.publishedAt ?? '').localeCompare(String(b.publishedAt ?? '')) || a.url.localeCompare(b.url)
      : (a, b) =>
        Number(Boolean(b.prefetchedMarkdown)) - Number(Boolean(a.prefetchedMarkdown)) ||
        String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')) ||
        a.url.localeCompare(b.url));
  }
  const selected: T[] = [];
  const sortedLaneIds = [...lanes.keys()].sort();
  const offset = sortedLaneIds.length === 0 ? 0 : (rotationSlot * limit) % sortedLaneIds.length;
  const laneIds = [...sortedLaneIds.slice(offset), ...sortedLaneIds.slice(0, offset)];
  while (selected.length < limit) {
    let progressed = false;
    for (const laneId of laneIds) {
      const next = lanes.get(laneId)?.shift();
      if (!next) continue;
      selected.push(next);
      progressed = true;
      if (selected.length >= limit) break;
    }
    if (!progressed) break;
  }
  return selected;
}

export function selectDiscoveryCandidates<T extends SelectableDiscoveryCandidate>(
  candidates: T[],
  limit: number,
  now = new Date(),
): {
  selected: T[];
  classified: Map<string, { discoveryClass: DiscoveryClass; reason: string }>;
} {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Discovery scrape limit must be a positive integer');
  const classified = new Map<string, { discoveryClass: DiscoveryClass; reason: string }>();
  const core: T[] = [];
  const adjacent: T[] = [];
  for (const candidate of candidates) {
    const result = classifyDiscoveryCandidate(candidate, now);
    classified.set(candidate.url, result);
    if (result.discoveryClass === 'core') core.push(candidate);
    if (result.discoveryClass === 'adjacent') adjacent.push(candidate);
  }
  const adjacentLimit = Math.floor(limit * CREDDY_DISCOVERY_PROFILE.adjacentShare);
  const coreLimit = limit - adjacentLimit;
  const rotationSlot = editorialRotationSlot(now);
  const expiryCutoff = now.getTime() - (CREDDY_DISCOVERY_PROFILE.freshnessHours - 12) * 60 * 60 * 1000;
  const expiringAdjacent = roundRobin(
    adjacent.filter((candidate) => {
      const publishedAt = candidate.publishedAt ? Date.parse(candidate.publishedAt) : Number.NaN;
      return Number.isFinite(publishedAt) && publishedAt <= expiryCutoff;
    }),
    adjacentLimit,
    rotationSlot,
    true,
  );
  const expiringUrls = new Set(expiringAdjacent.map((candidate) => candidate.url));
  const remainingAdjacent = roundRobin(
    adjacent.filter((candidate) => !expiringUrls.has(candidate.url)),
    adjacentLimit - expiringAdjacent.length,
    rotationSlot,
  );
  return {
    selected: [
      ...roundRobin(core, coreLimit, rotationSlot),
      ...expiringAdjacent,
      ...remainingAdjacent,
    ],
    classified,
  };
}
