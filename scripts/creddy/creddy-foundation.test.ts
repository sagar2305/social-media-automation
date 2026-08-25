import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CREDDY_CAMPAIGN_SLUG,
  CREDDY_DISCOVERY_PROFILE,
  CREDDY_FILTER_KEYWORDS,
  CREDDY_SOURCES,
  CREDDY_TOPIC_SEARCHES,
  getEnabledCreddySources,
} from './config.js';
import { qualifyCreddyText } from './qualification.js';
import { getCreddyRuntimeConfig } from './runtime.js';
import { validateCreddyConfig } from './validate-config.js';

test('all approved sources and creator signals are enabled with conservative trust', () => {
  validateCreddyConfig();
  assert.equal(CREDDY_CAMPAIGN_SLUG, 'credit-card-rewards');
  assert.equal(CREDDY_SOURCES.length, 18);
  assert.equal(getEnabledCreddySources().length, 18);
  assert.equal(
    getEnabledCreddySources().every((source) => source.cadence === 'twice_daily'),
    true,
  );
  for (const id of ['thrifty-traveler', 'loyalty-lobby', 'miles-to-memories']) {
    const source = CREDDY_SOURCES.find((candidate) => candidate.id === id);
    assert.equal(source?.tier, 'C');
    assert.equal(source?.factualUse, 'discovery_only');
  }
  const maxMiles = CREDDY_SOURCES.find((candidate) => candidate.id === 'max-miles-points');
  assert.equal(maxMiles?.sourceClass, 'creator_signal');
  assert.equal(maxMiles?.tier, 'D');
  assert.equal(maxMiles?.factualUse, 'signal_only');
  assert.equal(maxMiles?.url, 'https://www.youtube.com/feeds/videos.xml?channel_id=UCMIftenASZwDCmalbdEwUig');
});

test('topic and keyword configuration matches the approved plan', () => {
  assert.equal(CREDDY_TOPIC_SEARCHES.length, 12);
  assert.deepEqual(new Set(CREDDY_TOPIC_SEARCHES.map((search) => search.pair)), new Set([0, 1, 2, 3, 4, 5]));
  assert.deepEqual(new Set(CREDDY_TOPIC_SEARCHES.map((search) => search.intent)), new Set(['timely', 'evergreen', 'experimental']));
  assert.equal(CREDDY_FILTER_KEYWORDS.length, 23);
  assert.equal(CREDDY_DISCOVERY_PROFILE.maxLinksPerSourceDefault, 20);
  assert.equal(CREDDY_DISCOVERY_PROFILE.calibrationScrapeLimit, 20);
  assert.equal(CREDDY_DISCOVERY_PROFILE.productionScrapeLimit, 40);
  assert.deepEqual(CREDDY_DISCOVERY_PROFILE.editorialTarget, { timely: 0.7, evergreen: 0.2, experimental: 0.1 });
});

test('specific filter keywords use OR logic', () => {
  const result = qualifyCreddyText('A new award chart was published today.');
  assert.equal(result.qualifies, true);
  assert.deepEqual(result.matchedKeywords, ['award chart']);
});

test('multiple filter keywords are retained for scoring evidence', () => {
  const result = qualifyCreddyText(
    'A program change introduces a transfer bonus and a new redemption sweet spot.',
  );
  assert.equal(result.qualifies, true);
  assert.deepEqual(result.matchedKeywords, [
    'transfer bonus',
    'redemption',
    'program change',
    'sweet spot',
  ]);
});

test('broad status keyword requires travel-rewards context', () => {
  assert.equal(qualifyCreddyText('Check your employment status').qualifies, false);
  assert.equal(qualifyCreddyText('Airline elite status match opens today').qualifies, true);
});

test('broad tools keyword requires travel-rewards context', () => {
  assert.equal(qualifyCreddyText('New developer tools released').qualifies, false);
  assert.equal(qualifyCreddyText('Tools for finding airline award space').qualifies, true);
});

test('generic gas redemption and gaming sweet spots do not pass the relevance gate', () => {
  assert.equal(
    qualifyCreddyText('OnePay offers $1 cashback per gallon with two redemptions per day.').qualifies,
    false,
  );
  assert.equal(
    qualifyCreddyText('GTA 6 map sweet spot and racing game status update.').qualifies,
    false,
  );
});

test('expanded editorial scope retains points sales, award space, and meaningful card changes', () => {
  assert.equal(qualifyCreddyText('Airline points sale offers US travelers a 40% discount.').qualifies, true);
  assert.equal(qualifyCreddyText('New airline award space opens for loyalty redemptions.').qualifies, true);
  assert.equal(qualifyCreddyText('Major travel card benefit changes next month.').qualifies, true);
  assert.equal(qualifyCreddyText('Chase adds a new StubHub statement credit for cardholders.').qualifies, true);
  assert.equal(qualifyCreddyText('How to use Emirates points upgrades for an airline ticket.').qualifies, true);
  assert.equal(qualifyCreddyText('American announces a new Admirals Club airport lounge at DFW.').qualifies, true);
  assert.equal(qualifyCreddyText('A US travel credit card adds a milestone bonus after annual spend.').qualifies, true);
});

test('new Creddy pipeline is disabled by default', () => {
  const config = getCreddyRuntimeConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.campaignSlug, 'credit-card-rewards');
  assert.equal(config.aiExecutionMode, 'codex_scheduled');
});

test('enabling Creddy fails closed when required credentials are missing', () => {
  assert.throws(
    () => getCreddyRuntimeConfig({ CREDDY_PIPELINE_ENABLED: 'true' }),
    /FIRECRAWL_API_KEY/,
  );
});

test('optional read-only Creddy credentials do not block the ingestion worker', () => {
  const config = getCreddyRuntimeConfig({
    CREDDY_PIPELINE_ENABLED: 'true',
    FIRECRAWL_API_KEY: 'firecrawl-test',
  });
  assert.equal(config.enabled, true);
  assert.equal(config.aiExecutionMode, 'codex_scheduled');
  assert.equal(config.creddySupabaseUrl, '');
  assert.equal(config.creddySupabaseAnonKey, '');
});

test('OpenAI API mode alone requires OPENAI_API_KEY', () => {
  assert.throws(
    () =>
      getCreddyRuntimeConfig({
        CREDDY_PIPELINE_ENABLED: 'true',
        CREDDY_AI_EXECUTION_MODE: 'openai_api',
        FIRECRAWL_API_KEY: 'firecrawl-test',
      }),
    /OPENAI_API_KEY/,
  );
});

test('invalid AI execution mode is rejected', () => {
  assert.throws(
    () => getCreddyRuntimeConfig({ CREDDY_AI_EXECUTION_MODE: 'unlimited_free' }),
    /must be codex_scheduled or openai_api/,
  );
});
