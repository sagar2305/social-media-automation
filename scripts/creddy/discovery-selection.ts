import { CREDDY_DISCOVERY_PROFILE, CREDDY_TRAVEL_REWARDS_CONTEXT } from './config.js';
import { creddyEditorialRotationSlot } from './discovery-cadence.js';

export type DiscoveryClass = 'core' | 'adjacent' | 'low_relevance';

export interface SelectableDiscoveryCandidate {
  url: string;
  laneId: string;
  discoveredTitle?: string;
  discoveredDescription?: string;
  publishedAt?: string;
  prefetchedMarkdown?: string;
  publisherKey?: string;
}

export interface ClassifiedDiscoveryCandidate<T> {
  candidate: T;
  discoveryClass: DiscoveryClass;
  reason: string;
}

const CORE_SIGNALS = [
  'transfer bonus', 'transfer partner', 'award chart', 'award space', 'devaluation',
  'redemption', 'sweet spot', 'status match', 'status challenge', 'elite status',
  'points sale', 'miles sale', 'welcome offer', 'welcome bonus', 'bonus points',
  'statement credit', 'new benefit', 'benefits are live', 'benefit change',
  'credit card perk', 'card perk', 'promo award', 'shopping portal',
  'points and miles travel deal', 'milestone bonus', 'points transfer',
  'points now transfer', 'miles now transfer',
  'expiration policy', 'price increase', 'card benefit', 'loyalty program',
];

const OBVIOUS_NOISE = [
  /\b(?:netflix|k-?drama|video game|gta\s*6|formula\s*1|f1\s+title|volleyball|football|cricket)\b/i,
  /\b(?:blood sugar|medical|metabolic|hospital|dinosaur park)\b/i,
  /\b(?:flight cancellations?|flight delays?|airport departures?|air traffic controller strike)\b/i,
  /\b(?:hotel bar|hotel earns arboretum status|filming status|migration status)\b/i,
];

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

const EVENT_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'back', 'best', 'for', 'from', 'get', 'how',
  'in', 'is', 'it', 'new', 'now', 'of', 'on', 'or', 'the', 'this', 'to',
  'up', 'with', 'your',
]);

const EVENT_ANCHORS = new Set([
  'aadvantage', 'aeroplan', 'alaska', 'amex', 'american', 'atmos', 'avios',
  'bilt', 'bonvoy', 'capital', 'chase', 'citi', 'delta', 'emirates', 'flying',
  'hilton', 'hyatt', 'ihg', 'jetblue', 'marriott', 'mileageplus', 'qatar',
  'rapid', 'southwest', 'skymiles', 'united', 'virgin',
]);

function eventTokens(candidate: SelectableDiscoveryCandidate): Set<string> {
  const title = (candidate.discoveredTitle ?? '')
    .replace(/\*+/g, '')
    .replace(/\b(\d[\d,]*)\s+percent\b/gi, '$1%')
    .replace(/(?<=\d),(?=\d)/g, '')
    .split(/\s(?:-|\|)\s/)[0]
    .toLocaleLowerCase('en-US');
  return new Set(
    (title.match(/[a-z0-9]+%?/g) ?? [])
      .filter((token) => (token.length > 1 || /\d/.test(token)) && !EVENT_STOPWORDS.has(token)),
  );
}

export function discoveryEventFingerprint(candidate: SelectableDiscoveryCandidate): string {
  return [...eventTokens(candidate)].sort().join(' ');
}

function sameEvent(a: SelectableDiscoveryCandidate, b: SelectableDiscoveryCandidate): boolean {
  const aTokens = eventTokens(a);
  const bTokens = eventTokens(b);
  if (aTokens.size === 0 || bTokens.size === 0) return false;
  const aFingerprint = [...aTokens].sort().join(' ');
  const bFingerprint = [...bTokens].sort().join(' ');
  if (aFingerprint === bFingerprint) return true;
  const aNumbers = [...aTokens].filter((token) => /\d/.test(token)).sort();
  const bNumbers = [...bTokens].filter((token) => /\d/.test(token)).sort();
  if (aNumbers.join('|') !== bNumbers.join('|')) return false;
  const shared = [...aTokens].filter((token) => bTokens.has(token));
  if (!shared.some((token) => EVENT_ANCHORS.has(token))) return false;
  const unionSize = new Set([...aTokens, ...bTokens]).size;
  const jaccard = shared.length / unionSize;
  const containment = shared.length / Math.min(aTokens.size, bTokens.size);
  return jaccard >= 0.72 && containment >= 0.82;
}

function publisherKey(candidate: SelectableDiscoveryCandidate): string {
  if (candidate.publisherKey) return candidate.publisherKey;
  if (candidate.laneId.startsWith('source:')) return candidate.laneId.slice('source:'.length);
  try {
    const parsed = new URL(candidate.url);
    const host = parsed.hostname.replace(/^(?:www|m)\./, '').toLocaleLowerCase('en-US');
    if (host === 'google.com' && parsed.pathname.startsWith('/goto')) return `unknown:${candidate.laneId}`;
    return host;
  } catch {
    return candidate.laneId;
  }
}

function priority(candidate: SelectableDiscoveryCandidate, now: Date): number[] {
  const text = normalized(candidate);
  const publishedAt = candidate.publishedAt ? Date.parse(candidate.publishedAt) : Number.NaN;
  const expiryCutoff = now.getTime() - (CREDDY_DISCOVERY_PROFILE.freshnessHours - 12) * 60 * 60 * 1000;
  const expiring = Number(Number.isFinite(publishedAt) && publishedAt <= expiryCutoff);
  const specificity = CORE_SIGNALS.filter((signal) => text.includes(signal)).length +
    CREDDY_TRAVEL_REWARDS_CONTEXT.filter((term) => text.includes(term)).length;
  const urgency = Number(/\b(?:act fast|deadline|ending soon|ends? (?:today|tomorrow)|expir(?:e|es|ing)|last chance|limited[- ]time)\b/i.test(text));
  const magnitude = Number(/(?:[$€£]\s?\d|\b\d[\d,]*(?:k|%| points?| miles?)\b)/i.test(text));
  return [expiring, specificity, urgency, magnitude, Number(Number.isFinite(publishedAt)), Number(Boolean(candidate.prefetchedMarkdown))];
}

function comparePriority(a: SelectableDiscoveryCandidate, b: SelectableDiscoveryCandidate, now: Date): number {
  const aPriority = priority(a, now);
  const bPriority = priority(b, now);
  for (let index = 0; index < aPriority.length; index += 1) {
    if (aPriority[index] !== bPriority[index]) return bPriority[index] - aPriority[index];
  }
  const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0;
  const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0;
  if (aPriority[0] && bPriority[0] && aTime !== bTime) return aTime - bTime;
  if (aTime !== bTime) return bTime - aTime;
  return a.url.localeCompare(b.url);
}

function publisherRoundRobin<T extends SelectableDiscoveryCandidate>(
  items: T[],
  limit: number,
  rotationSlot: number,
  now: Date,
  alreadySelected: T[],
  publisherCounts: Map<string, number>,
): T[] {
  const lanes = new Map<string, T[]>();
  for (const item of items) {
    const key = publisherKey(item);
    const lane = lanes.get(key) ?? [];
    lane.push(item);
    lanes.set(key, lane);
  }
  for (const lane of lanes.values()) lane.sort((a, b) => comparePriority(a, b, now));
  const selected: T[] = [];
  const sortedLaneIds = [...lanes.keys()].sort();
  const offset = sortedLaneIds.length === 0 ? 0 : (rotationSlot * limit) % sortedLaneIds.length;
  const laneIds = [...sortedLaneIds.slice(offset), ...sortedLaneIds.slice(0, offset)];
  while (selected.length < limit) {
    let consumed = false;
    for (const laneId of laneIds) {
      const next = lanes.get(laneId)?.shift();
      if (!next) continue;
      consumed = true;
      if ((publisherCounts.get(laneId) ?? 0) >= CREDDY_DISCOVERY_PROFILE.maxPerPublisher) continue;
      if ([...alreadySelected, ...selected].filter((item) => sameEvent(item, next)).length >= CREDDY_DISCOVERY_PROFILE.maxPerEvent) continue;
      selected.push(next);
      publisherCounts.set(laneId, (publisherCounts.get(laneId) ?? 0) + 1);
      if (selected.length >= limit) break;
    }
    if (!consumed) break;
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
  const maximumAdjacent = Math.floor(limit * CREDDY_DISCOVERY_PROFILE.adjacentShare);
  const coreLimit = limit - maximumAdjacent;
  const rotationSlot = creddyEditorialRotationSlot(now);
  const publisherCounts = new Map<string, number>();
  const selectedCore = publisherRoundRobin(core, coreLimit, rotationSlot, now, [], publisherCounts);
  // Preserve the editorial mix even when the core pool is undersupplied. An
  // adjacent item can only accompany enough actually selected core items.
  const adjacentLimit = Math.min(
    maximumAdjacent,
    Math.floor(
      selectedCore.length * CREDDY_DISCOVERY_PROFILE.adjacentShare
      / CREDDY_DISCOVERY_PROFILE.coreShare,
    ),
  );
  const expiringAdjacent = adjacent.filter((candidate) => priority(candidate, now)[0] === 1);
  const selectedExpiring = publisherRoundRobin(
    expiringAdjacent,
    adjacentLimit,
    rotationSlot,
    now,
    selectedCore,
    publisherCounts,
  );
  const expiringUrls = new Set(selectedExpiring.map((candidate) => candidate.url));
  const selectedRemaining = publisherRoundRobin(
    adjacent.filter((candidate) => !expiringUrls.has(candidate.url) && priority(candidate, now)[0] !== 1),
    adjacentLimit - selectedExpiring.length,
    rotationSlot,
    now,
    [...selectedCore, ...selectedExpiring],
    publisherCounts,
  );
  const selectedAdjacent = [...selectedExpiring, ...selectedRemaining];
  return {
    selected: [...selectedCore, ...selectedAdjacent],
    classified,
  };
}
