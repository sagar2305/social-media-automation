import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CREDDY_CAMPAIGN_SLUG,
  CREDDY_FILTER_KEYWORDS,
  CREDDY_SOURCES,
  CREDDY_TOPIC_SEARCHES,
  getEnabledCreddySources,
} from './config.js';
import { qualifyCreddyText } from './qualification.js';
import { getCreddyRuntimeConfig } from './runtime.js';
import { validateCreddyConfig } from './validate-config.js';

test('all thirteen boss-approved sources are enabled', () => {
  validateCreddyConfig();
  assert.equal(CREDDY_CAMPAIGN_SLUG, 'credit-card-rewards');
  assert.equal(CREDDY_SOURCES.length, 13);
  assert.equal(getEnabledCreddySources().length, 13);
  assert.equal(
    getEnabledCreddySources().every((source) => source.cadence === 'twice_daily'),
    true,
  );
});

test('topic and keyword configuration matches the approved plan', () => {
  assert.deepEqual(CREDDY_TOPIC_SEARCHES, [
    'airline status',
    'hotel status',
    'points devaluation',
    'points sweet spot',
  ]);
  assert.equal(CREDDY_FILTER_KEYWORDS.length, 8);
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
