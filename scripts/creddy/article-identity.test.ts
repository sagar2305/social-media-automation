import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildArticleIdentity,
  classifyArticleChange,
  fingerprintArticleTitle,
  hashArticleContent,
  normalizeArticleUrl,
} from './article-identity.js';

test('normalizes scheme, host, slash, fragment, and tracking parameters', () => {
  assert.equal(
    normalizeArticleUrl(
      'http://WWW.Example.com:80/news//bonus/?utm_source=x&fbclid=abc#terms',
    ),
    'https://example.com/news/bonus',
  );
});

test('retains meaningful parameters in deterministic order', () => {
  assert.equal(
    normalizeArticleUrl('https://example.com/search?program=hilton&page=2&utm_medium=email'),
    'https://example.com/search?page=2&program=hilton',
  );
});

test('does not collapse different content-selection query values', () => {
  assert.notEqual(
    normalizeArticleUrl('https://example.com/article?edition=us'),
    normalizeArticleUrl('https://example.com/article?edition=uk'),
  );
});

test('rejects unsafe protocols and embedded credentials', () => {
  assert.throws(() => normalizeArticleUrl('file:///tmp/news'), /Unsupported article protocol/);
  assert.throws(
    () => normalizeArticleUrl('https://user:secret@example.com/news'),
    /must not contain credentials/,
  );
});

test('content hashes ignore line-ending and horizontal-spacing noise', () => {
  assert.equal(hashArticleContent('One  two\r\nthree'), hashArticleContent('One two\nthree'));
  assert.notEqual(hashArticleContent('Bonus: 20%'), hashArticleContent('Bonus: 25%'));
});

test('title fingerprints normalize punctuation and case', () => {
  assert.equal(
    fingerprintArticleTitle('Hilton—Transfer BONUS!'),
    fingerprintArticleTitle('hilton transfer bonus'),
  );
});

test('classifies new, unchanged, and changed article identities', () => {
  const incoming = buildArticleIdentity({
    url: 'https://example.com/news?utm_source=email',
    content: 'Transfer bonus is 20%.',
    title: 'New Transfer Bonus',
  });

  assert.equal(classifyArticleChange(incoming, undefined), 'new_url');
  assert.equal(
    classifyArticleChange(incoming, {
      canonicalUrl: 'https://example.com/news',
      contentHash: incoming.contentHash,
    }),
    'unchanged',
  );
  assert.equal(
    classifyArticleChange(incoming, {
      canonicalUrl: 'https://example.com/news',
      contentHash: hashArticleContent('Transfer bonus is 15%.'),
    }),
    'content_changed',
  );
});
