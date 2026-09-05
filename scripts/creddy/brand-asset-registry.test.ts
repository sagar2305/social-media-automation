import assert from 'node:assert/strict';
import test from 'node:test';
import { editorialBrandRegistry, matchEditorialBrands, resolveEditorialBrands } from './brand-asset-registry.js';

test('every curated brand has matching integrity and truthful source provenance', async () => {
  const registry = await editorialBrandRegistry();
  assert.ok(registry.length > 0);
  assert.equal(new Set(registry.map(brand => brand.id)).size, registry.length);
  for (const brand of registry) {
    const resolved = await resolveEditorialBrands([brand.id]);
    assert.equal(resolved[0]!.sourceUrl, brand.sourceUrl);
    assert.match(brand.provenance, /editorial identification/);
  }
});

test('matching uses whole explicit names, not inferred card or airline relationships', async () => {
  const registry = await editorialBrandRegistry();
  assert.equal(matchEditorialBrands('American home prices', registry).some(brand => brand.id === 'amex'), false);
  assert.equal(matchEditorialBrands('Chase Ink Business offer', registry).some(brand => brand.id === 'chase-sapphire-preferred'), false);
  assert.equal(matchEditorialBrands('Flights from Delhi', registry).some(brand => brand.id === 'delta'), false);
  assert.equal(matchEditorialBrands('Bilt Rewards', registry).some(brand => brand.id === 'bilt'), true);
  await assert.rejects(resolveEditorialBrands(['not-approved']), /Unknown/);
  await assert.rejects(resolveEditorialBrands(['bilt', 'bilt']), /distinct/);
});
