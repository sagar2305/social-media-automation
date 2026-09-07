import type { CreddyArticleVisualPlan } from './pipeline-types.js';

/** The empty brand compositor produces a generic globe/building, not a story cover.
 * Keep this policy at new blog planning/production boundaries, not in shared
 * historical validators or the News renderer.
 */
export function hasGenericBlogCover(plan: CreddyArticleVisualPlan | undefined): boolean {
  return Boolean(plan?.assets.some(asset => asset.usage === 'hero'
    && asset.generationMode === 'compose' && !asset.photoAssetId
    && (!asset.brandAssetIds || asset.brandAssetIds.length === 0)));
}

export function assertStorySpecificBlogCover(plan: CreddyArticleVisualPlan | undefined): void {
  if (hasGenericBlogCover(plan)) {
    throw new Error('Generic brandless blog hero is not a finished cover; select a reviewed relevant photo or story-specific artwork. Visual task remains pending.');
  }
}

/** Legacy archive plans may predate the policy. Check before any upload. */
export function hasGenericArchiveBlogCover(item: {
  kind: string; brands: string[]; images: { photoAssetId?: string; provenance: string; usage?: string }[];
}): boolean {
  if (item.kind !== 'blog') return false;
  if (item.images.length === 1 && item.images[0]?.photoAssetId) return false;
  // Legacy plans have no usage field, but their renderer used the same `brands`
  // list for all assets. New plans identify the hero explicitly; inline art must
  // never veto an otherwise legitimate cover.
  return !item.brands.length || item.images.some(image => image.usage === 'hero'
    && image.provenance === 'Original Creddy flat editorial illustration; no third-party brand imagery.');
}
