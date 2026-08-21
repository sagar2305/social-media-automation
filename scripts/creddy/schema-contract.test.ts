import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../../dashboard/migrations/add_creddy_ingestion_foundation.sql',
  import.meta.url,
);

test('Creddy ingestion migration contains all foundation tables', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  for (const table of [
    'creddy_sources',
    'creddy_fetch_runs',
    'creddy_raw_articles',
    'creddy_canonical_articles',
    'creddy_article_evidence',
    'creddy_review_cases',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`REVOKE ALL ON public\\.${table} FROM anon`));
  }
});

test('database enforces the rare Slack-review predicate', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /route <> 'slack_review'[\s\S]*material_conflict = true/);
  assert.match(sql, /conflict_changes_message = true/);
  assert.match(sql, /verification_exhausted = true/);
});

test('evidence and review relationships are campaign-scoped', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(
    sql,
    /FOREIGN KEY \(canonical_article_id, campaign_id\)[\s\S]*creddy_canonical_articles\(id, campaign_id\)/,
  );
  assert.match(
    sql,
    /FOREIGN KEY \(raw_article_id, campaign_id\)[\s\S]*creddy_raw_articles\(id, campaign_id\)/,
  );
});
