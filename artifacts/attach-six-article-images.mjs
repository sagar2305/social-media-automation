import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const slugs = [
  'marriott-bonvoy-brilliant-elite-benefits',
  'jetblue-trueblue-practical-guide',
  'american-airlines-aadvantage-practical-guide',
  'amex-gold-travel-benefits-value-test',
  'check-hotel-fees-before-amex-transfer',
  'atmos-rewards-2026-practical-guide',
];
const suffixes = ['hero', 'decision', 'tracker'];
for (const slug of slugs) {
  const path = `artifacts/article-batch/${slug}-visual.json`;
  const plan = JSON.parse(await readFile(path, 'utf8'));
  plan.articleVisuals.assets.forEach((asset, index) => {
    asset.assetPath = resolve(`artifacts/article-images/${slug}/${slug}-${suffixes[index]}.png`);
    asset.provenance = 'Generated with the built-in OpenAI image generation tool from the approved Agent 05 prompt on 2026-08-25; visually reviewed and saved in the project.';
  });
  await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`);
}
console.log(JSON.stringify({ updatedPlans: slugs.length, attachedAssets: slugs.length * suffixes.length }));
