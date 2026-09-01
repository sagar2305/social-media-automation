import {
  CREDDY_FILTER_KEYWORDS,
  CREDDY_SOURCES,
  CREDDY_TOPIC_SEARCHES,
  getEnabledCreddySources,
} from './config.js';

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} contains duplicate values`);
  }
}

export function validateCreddyConfig(): void {
  const enabled = getEnabledCreddySources();
  const approvedSourceIds = [
    'awardwallet', 'doctor-of-credit', 'frequent-miler', 'one-mile-at-a-time',
    'the-points-guy', '10x-travel', 'miles-talk', 'upgraded-points',
    'view-from-the-wing', 'rove-miles', 'flyertalk', 'reddit-awardtravel',
    'reddit-churning', 'geobreeze-travel', 'thrifty-traveler', 'loyalty-lobby',
    'miles-to-memories', 'max-miles-points',
  ];
  const sourceIds = CREDDY_SOURCES.map((source) => source.id);
  if (sourceIds.length !== approvedSourceIds.length || approvedSourceIds.some((id) => !sourceIds.includes(id))) {
    throw new Error('Registered Creddy sources do not match the approved source IDs');
  }
  if (enabled.length !== approvedSourceIds.length) throw new Error('Every approved Creddy source must be enabled');
  if (enabled.some((source) => source.cadence !== 'hourly')) {
    throw new Error('Every approved source must participate in hourly discovery');
  }

  unique(CREDDY_SOURCES.map((source) => source.id), 'Source IDs');
  unique(CREDDY_SOURCES.map((source) => new URL(source.url).toString()), 'Source URLs');
  unique(CREDDY_TOPIC_SEARCHES.map((search) => search.id), 'Topic search IDs');
  unique(CREDDY_TOPIC_SEARCHES.map((search) => search.query), 'Topic searches');
  unique(CREDDY_FILTER_KEYWORDS, 'Filter keywords');

  if (CREDDY_TOPIC_SEARCHES.length !== 12) throw new Error(`Expected 12 topic searches, found ${CREDDY_TOPIC_SEARCHES.length}`);
  for (let pair = 0; pair < 6; pair += 1) {
    if (CREDDY_TOPIC_SEARCHES.filter((search) => search.pair === pair).length !== 2) {
      throw new Error(`Topic search pair ${pair} must contain exactly two searches`);
    }
  }
  if (CREDDY_FILTER_KEYWORDS.length !== 23) {
    throw new Error(`Expected 23 OR keywords, found ${CREDDY_FILTER_KEYWORDS.length}`);
  }
}

export function validateUrgentDeliveryConfig(env: NodeJS.ProcessEnv = process.env): void {
  const enabled = (name: string): boolean => env[name]?.trim().toLowerCase() === 'true';
  if (enabled('CREDDY_URGENT_BLOG_AUTOPUBLISH_ENABLED') &&
      !enabled('CREDDY_WEBSITE_CMS_PUBLISH_ENABLED')) {
    throw new Error('Urgent blog publishing requires CREDDY_WEBSITE_CMS_PUBLISH_ENABLED=true');
  }
  if (enabled('CREDDY_URGENT_SOCIAL_AUTOPUBLISH_ENABLED')) {
    for (const name of ['BLOTATO_API_KEY', 'CREDDY_URGENT_INSTAGRAM_ACCOUNT', 'CREDDY_URGENT_TIKTOK_ACCOUNT']) {
      if (!env[name]?.trim()) throw new Error(`Urgent social publishing requires ${name}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  validateCreddyConfig();
  validateUrgentDeliveryConfig();
  console.log(
    `Creddy config valid: ${CREDDY_SOURCES.length} registered sources, ` +
      `${getEnabledCreddySources().length} enabled sources, ` +
      `${CREDDY_TOPIC_SEARCHES.length} rotating topic searches, ` +
      `${CREDDY_FILTER_KEYWORDS.length} OR keywords.`,
  );
}
