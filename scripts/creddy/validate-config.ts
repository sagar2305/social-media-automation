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
  if (CREDDY_SOURCES.length !== 14) {
    throw new Error(`Expected 14 registered sources, found ${CREDDY_SOURCES.length}`);
  }

  const enabled = getEnabledCreddySources();
  if (enabled.length !== 14) {
    throw new Error(`Expected all 14 sources to be enabled, found ${enabled.length}`);
  }
  if (enabled.some((source) => source.cadence !== 'twice_daily')) {
    throw new Error('Every boss-approved source must run twice daily');
  }

  unique(CREDDY_SOURCES.map((source) => source.id), 'Source IDs');
  unique(CREDDY_SOURCES.map((source) => new URL(source.url).hostname + new URL(source.url).pathname), 'Source URLs');
  unique(CREDDY_TOPIC_SEARCHES, 'Topic searches');
  unique(CREDDY_FILTER_KEYWORDS, 'Filter keywords');

  if (CREDDY_TOPIC_SEARCHES.length !== 4) {
    throw new Error(`Expected 4 topic searches, found ${CREDDY_TOPIC_SEARCHES.length}`);
  }
  if (CREDDY_FILTER_KEYWORDS.length !== 20) {
    throw new Error(`Expected 20 OR keywords, found ${CREDDY_FILTER_KEYWORDS.length}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  validateCreddyConfig();
  console.log(
    `Creddy config valid: ${CREDDY_SOURCES.length} registered sources, ` +
      `${getEnabledCreddySources().length} enabled sources, ` +
      `${CREDDY_TOPIC_SEARCHES.length} topic searches, ` +
      `${CREDDY_FILTER_KEYWORDS.length} OR keywords.`,
  );
}
