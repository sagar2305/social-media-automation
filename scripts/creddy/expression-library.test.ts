import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  CREDDY_APPROVED_EXPRESSIONS,
  CREDDY_LEGACY_EXPRESSION_ALIASES,
  CREDDY_V4_EXPRESSION_NAMES,
  creddyExpressionFile,
} from './expression-library.js';

test('the approved Creddy v4 template library contains 100 unique real assets', async () => {
  assert.equal(CREDDY_V4_EXPRESSION_NAMES.length, 100);
  assert.equal(new Set(CREDDY_V4_EXPRESSION_NAMES).size, 100);
  for (const expression of CREDDY_V4_EXPRESSION_NAMES) {
    const file = creddyExpressionFile(expression);
    assert.equal(file, `${expression}.png`);
    await access(resolve('assets/creddy/slideshow-emotion-gestures-v4-1080x1440', file));
    assert.equal(CREDDY_APPROVED_EXPRESSIONS.has(expression), true);
  }
});

test('legacy expression IDs resolve to a compatible v4 template', () => {
  for (const [legacy, canonical] of Object.entries(CREDDY_LEGACY_EXPRESSION_ALIASES)) {
    assert.equal(creddyExpressionFile(legacy), `${canonical}.png`);
    assert.equal(CREDDY_APPROVED_EXPRESSIONS.has(legacy), true);
  }
  assert.equal(creddyExpressionFile('999-invented'), undefined);
});
