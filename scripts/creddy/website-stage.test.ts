import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CREDDY_WEBSITE_EXPORT_VERSION,
  creddyWebsiteArticleRoute,
  creddyWebsiteAssetPath,
} from './website-stage.js';

describe('Creddy website export v2 paths', () => {
  it('routes approved articles to the native blogs surface', () => {
    assert.equal(CREDDY_WEBSITE_EXPORT_VERSION, 'creddy-website-export-v2');
    assert.equal(creddyWebsiteArticleRoute('card-benefit-update'), '/blog/card-benefit-update');
  });

  it('maps local source assets to a deployable blog path', () => {
    assert.equal(
      creddyWebsiteAssetPath('card-benefit-update', 'hero:1', '/private/data/hero image.png'),
      '/blogs/card-benefit-update/hero-1-hero%20image.png',
    );
  });
});
