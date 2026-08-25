// Reuse the existing Social Automation campaign row. Do not create a second
// `creddy` campaign: its live slug is already `credit-card-rewards`.
export const CREDDY_CAMPAIGN_SLUG = 'credit-card-rewards' as const;
export const CREDDY_MARKET = 'US' as const;
export const CREDDY_LANGUAGE = 'en-US' as const;

export type CreddySourceClass =
  | 'specialist_publication'
  | 'community'
  | 'product_reference'
  | 'creator_signal';

export type CreddySourceTier = 'B' | 'C' | 'D';
export type CreddyCrawlCadence = 'twice_daily' | 'daily' | 'disabled';

export interface CreddySourceConfig {
  id: string;
  name: string;
  url: string;
  sourceClass: CreddySourceClass;
  tier: CreddySourceTier;
  cadence: CreddyCrawlCadence;
  enabledByDefault: boolean;
  factualUse: 'discovery_and_confirmation' | 'discovery_only' | 'signal_only';
}

export type CreddyQueryIntent = 'timely' | 'evergreen' | 'experimental';

export interface CreddyTopicSearch {
  id: string;
  query: string;
  intent: CreddyQueryIntent;
  pair: number;
}

/**
 * The original boss-approved sources plus the explicitly approved discovery
 * candidates and creator signals participate in shadow ingestion. Source
 * tier and factualUse still control how evidence is trusted: community sources
 * are signals only and can never serve as sole factual confirmation.
 */
export const CREDDY_SOURCES: readonly CreddySourceConfig[] = [
  {
    id: 'awardwallet',
    name: 'AwardWallet Blog',
    url: 'https://awardwallet.com/blog/',
    sourceClass: 'specialist_publication',
    tier: 'B',
    cadence: 'twice_daily',
    enabledByDefault: true,
    factualUse: 'discovery_and_confirmation',
  },
  {
    id: 'doctor-of-credit',
    name: 'Doctor of Credit',
    url: 'https://www.doctorofcredit.com/',
    sourceClass: 'specialist_publication',
    tier: 'B',
    cadence: 'twice_daily',
    enabledByDefault: true,
    factualUse: 'discovery_and_confirmation',
  },
  {
    id: 'frequent-miler',
    name: 'Frequent Miler',
    url: 'https://frequentmiler.com/',
    sourceClass: 'specialist_publication',
    tier: 'B',
    cadence: 'twice_daily',
    enabledByDefault: true,
    factualUse: 'discovery_and_confirmation',
  },
  {
    id: 'one-mile-at-a-time',
    name: 'One Mile at a Time',
    url: 'https://onemileatatime.com/',
    sourceClass: 'specialist_publication',
    tier: 'B',
    cadence: 'twice_daily',
    enabledByDefault: true,
    factualUse: 'discovery_and_confirmation',
  },
  {
    id: 'the-points-guy',
    name: 'The Points Guy',
    url: 'https://thepointsguy.com/',
    sourceClass: 'specialist_publication',
    tier: 'B',
    cadence: 'twice_daily',
    enabledByDefault: true,
    factualUse: 'discovery_and_confirmation',
  },
  {
    id: '10x-travel',
    name: '10xTravel',
    url: 'https://10xtravel.com/',
    sourceClass: 'specialist_publication',
    tier: 'C',
    cadence: 'twice_daily',
    enabledByDefault: true,
    factualUse: 'discovery_only',
  },
  {
    id: 'miles-talk',
    name: 'MilesTalk',
    url: 'https://milestalk.com/',
    sourceClass: 'specialist_publication',
    tier: 'C',
    cadence: 'twice_daily',
    enabledByDefault: true,
    factualUse: 'discovery_only',
  },
  {
    id: 'upgraded-points',
    name: 'Upgraded Points',
    url: 'https://upgradedpoints.com/',
    sourceClass: 'specialist_publication',
    tier: 'C',
    cadence: 'twice_daily',
    enabledByDefault: true,
    factualUse: 'discovery_only',
  },
  {
    id: 'view-from-the-wing',
    name: 'View from the Wing',
    url: 'https://viewfromthewing.com/',
    sourceClass: 'specialist_publication',
    tier: 'C',
    cadence: 'twice_daily',
    enabledByDefault: true,
    factualUse: 'discovery_only',
  },
  {
    id: 'rove-miles',
    name: 'Rove Miles',
    url: 'https://www.rovemiles.com/',
    sourceClass: 'product_reference',
    tier: 'C',
    cadence: 'twice_daily',
    enabledByDefault: true,
    factualUse: 'discovery_only',
  },
  {
    id: 'flyertalk',
    name: 'FlyerTalk',
    url: 'https://www.flyertalk.com/forum/',
    sourceClass: 'community',
    tier: 'D',
    cadence: 'twice_daily',
    enabledByDefault: true,
    factualUse: 'signal_only',
  },
  {
    id: 'reddit-awardtravel',
    name: 'Reddit r/awardtravel',
    url: 'https://www.reddit.com/r/awardtravel/',
    sourceClass: 'community',
    tier: 'D',
    cadence: 'twice_daily',
    enabledByDefault: true,
    factualUse: 'signal_only',
  },
  {
    id: 'reddit-churning',
    name: 'Reddit r/churning',
    url: 'https://www.reddit.com/r/churning/',
    sourceClass: 'community',
    tier: 'D',
    cadence: 'twice_daily',
    enabledByDefault: true,
    factualUse: 'signal_only',
  },
  {
    id: 'geobreeze-travel',
    name: 'Geobreeze Travel',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCBjIhqPw-K4yeZU8YfO_gbA',
    sourceClass: 'creator_signal',
    tier: 'D',
    cadence: 'twice_daily',
    enabledByDefault: true,
    factualUse: 'signal_only',
  },
  {
    id: 'thrifty-traveler',
    name: 'Thrifty Traveler',
    url: 'https://thriftytraveler.com/news/',
    sourceClass: 'specialist_publication',
    tier: 'C',
    cadence: 'twice_daily',
    enabledByDefault: true,
    factualUse: 'discovery_only',
  },
  {
    id: 'loyalty-lobby',
    name: 'LoyaltyLobby',
    url: 'https://loyaltylobby.com/',
    sourceClass: 'specialist_publication',
    tier: 'C',
    cadence: 'twice_daily',
    enabledByDefault: true,
    factualUse: 'discovery_only',
  },
  {
    id: 'miles-to-memories',
    name: 'Miles to Memories',
    url: 'https://milestomemories.com/',
    sourceClass: 'specialist_publication',
    tier: 'C',
    cadence: 'twice_daily',
    enabledByDefault: true,
    factualUse: 'discovery_only',
  },
  {
    id: 'max-miles-points',
    name: 'Max Miles Points',
    url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCMIftenASZwDCmalbdEwUig',
    sourceClass: 'creator_signal',
    tier: 'D',
    cadence: 'twice_daily',
    enabledByDefault: true,
    factualUse: 'signal_only',
  },
] as const;

export const CREDDY_TOPIC_SEARCHES: readonly CreddyTopicSearch[] = [
  { id: 'transfer-bonus', pair: 0, intent: 'timely', query: '"transfer bonus" points miles airline hotel loyalty' },
  { id: 'transfer-partner-change', pair: 0, intent: 'timely', query: '("new transfer partner" OR "transfer partner removed") credit card points miles' },
  { id: 'program-change', pair: 1, intent: 'timely', query: '("award chart" OR devaluation OR "program change") points miles airline hotel' },
  { id: 'award-availability', pair: 1, intent: 'timely', query: '("award availability" OR "promo awards" OR "award sale") points miles' },
  { id: 'status', pair: 2, intent: 'timely', query: '("status match" OR "status challenge" OR "elite status") airline hotel loyalty' },
  { id: 'hotel-promotion', pair: 2, intent: 'timely', query: '("hotel promotion" OR "bonus points promotion" OR "free night") loyalty program' },
  { id: 'redemption', pair: 3, intent: 'evergreen', query: '("sweet spot" OR redemption) points miles airline hotel' },
  { id: 'points-sale', pair: 3, intent: 'timely', query: '("buy points" OR "points sale" OR "buy miles") airline hotel bonus' },
  { id: 'card-offer', pair: 4, intent: 'timely', query: '("welcome bonus" OR "card benefit" OR "annual fee increase") travel credit card' },
  { id: 'expiring-benefit', pair: 4, intent: 'timely', query: '("ending soon" OR expiring OR deadline) credit card points miles benefit' },
  { id: 'shopping-portal', pair: 5, intent: 'experimental', query: '("shopping portal" OR "card-linked offer") points miles bonus' },
  { id: 'award-tools', pair: 5, intent: 'evergreen', query: '("award search tool" OR "points booking tool") airline hotel rewards' },
] as const;

export const CREDDY_DISCOVERY_PROFILE = {
  freshnessHours: 24,
  maxLinksPerSourceDefault: 20,
  calibrationScrapeLimit: 20,
  productionScrapeLimit: 40,
  coreShare: 0.8,
  adjacentShare: 0.2,
  maxPerPublisher: 3,
  maxPerEvent: 2,
  targetPublishers: 8,
  editorialTarget: { timely: 0.7, evergreen: 0.2, experimental: 0.1 },
  promisingSourceMinimumRetained: 3,
  promisingSourceMinimumRuns: 2,
} as const;

/** Any one keyword may pass the keyword gate. */
export const CREDDY_FILTER_KEYWORDS = [
  'transfer bonus',
  'transfer partner',
  'award chart',
  'award space',
  'devaluation',
  'redemption',
  'program change',
  'sweet spot',
  'status match',
  'status challenge',
  'points sale',
  'miles sale',
  'welcome offer',
  'card benefit',
  'credit card perk',
  'statement credit',
  'lounge access',
  'admirals club',
  'cardholder benefit',
  'points upgrade',
  'milestone bonus',
  'status',
  'tools',
] as const;

export const CREDDY_BROAD_CONTEXT_KEYWORDS = new Set(['status', 'tools']);

export const CREDDY_TRAVEL_REWARDS_CONTEXT = [
  'airline',
  'airport',
  'aadvantage',
  'aeroplan',
  'award',
  'amex',
  'american express',
  'atmos rewards',
  'avios',
  'bonvoy',
  'cardholder',
  'cardmember',
  'chase',
  'citi',
  'credit card',
  'elite',
  'flight',
  'flying blue',
  'hotel',
  'hilton honors',
  'ihg',
  'loyalty',
  'mileageplus',
  'miles',
  'points',
  'program',
  'rapid rewards',
  'skymiles',
  'transfer',
  'travel',
  'world of hyatt',
] as const;

export const CREDDY_OFFICIAL_VERIFICATION_REQUIRED_FIELDS = [
  'bonus_amount',
  'transfer_ratio',
  'expiry',
  'fee',
  'eligibility',
  'affected_card_or_program',
  'country',
  'targeted_or_public',
] as const;

export function getEnabledCreddySources(): CreddySourceConfig[] {
  return CREDDY_SOURCES.filter((source) => source.enabledByDefault);
}
