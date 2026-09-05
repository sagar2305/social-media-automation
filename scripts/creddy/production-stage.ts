import { validateContentPackage, writeContentAndJobs } from './content-stage.js';
import { articlePreviewImageFilename, renderCreddyArticlePreview, validateCreddyArticle, validateCreddyArticleVisuals } from './article-content.js';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  listJsonFiles,
  pathExists,
  readJson,
  safeDataPath,
  writeJsonAtomic,
} from './pipeline-store.js';
import {
  CREDDY_PIPELINE_VERSION,
  type AnalysisDecisionRecord,
  type CanonicalNewsRecord,
  type ContentDraftRecord,
  type ContentPackageRecord,
  type VideoJobRecord,
  type VisualPlanRecord,
} from './pipeline-types.js';
import { listPublicationDecisions, publicationModeForOpportunity } from './publication-policy.js';
import { composeEditorialImage } from './brand-asset-registry.js';
import { composeEditorialPhoto } from './editorial-photos.js';

export interface ProductionTaskRecord {
  draft: ContentDraftRecord;
  visualPlan: VisualPlanRecord;
}

export interface ProductionPreparationResult {
  inputCount: number;
  createdPackages: number;
  updatedArticlePackages: number;
  createdVideoJobs: number;
  skippedCount: number;
  packageIds: string[];
  assetFailures?: Array<{ visualPlanId: string; reason: string }>;
  revisionRequired?: Array<{ packageId: string; changedFields: string[]; reason: string }>;
}

export function productionBoundaryChanges(existing: ContentPackageRecord, draft: ContentDraftRecord): string[] {
  return (['distributionMode', 'analysisBatchId', 'productionAuthorization', 'verificationGate', 'factualClaims'] as const)
    .filter(key => JSON.stringify(existing[key]) !== JSON.stringify(draft[key]));
}

export interface ArticlePreviewRefreshResult {
  refreshedCount: number;
  previewPaths: string[];
}

function topLevelJson(paths: string[], nested: RegExp): string[] {
  return paths.filter((path) => !nested.test(path));
}

export async function listProductionTasks(root: string): Promise<ProductionTaskRecord[]> {
  const canonical = await Promise.all(
    (await listJsonFiles(safeDataPath(root, '03-canonical-news', 'approved')))
      .map((path) => readJson<CanonicalNewsRecord>(path)),
  );
  const articleById = new Map(canonical.map((article) => [article.canonicalId, article]));
  const decisions = await listPublicationDecisions(root);
  const modesByAnalysisId = new Map(decisions.flatMap((decision) => {
    const article = articleById.get(decision.canonicalId);
    const mode = article && publicationModeForOpportunity(decision, article);
    return mode ? [[decision.id, mode] as const] : [];
  }));
  const draftPaths = topLevelJson(
    await listJsonFiles(safeDataPath(root, '06-content-drafts')),
    /\/(scripts|captions|briefs|articles|legacy|revisions)\//,
  );
  const drafts = await Promise.all(draftPaths.map((path) => readJson<ContentDraftRecord>(path)));
  const draftById = new Map(drafts
    .filter((draft) =>
      draft.copyVersion === 'creddy-copy-v3' &&
      Boolean(draft.article) &&
      draft.distributionMode === modesByAnalysisId.get(draft.analysisId))
    .map((draft) => [draft.id, draft]));
  const tasks: ProductionTaskRecord[] = [];
  for (const path of await listJsonFiles(safeDataPath(root, '06-visual-plans'))) {
    const visualPlan = await readJson<VisualPlanRecord>(path);
    const draft = draftById.get(visualPlan.contentDraftId);
    if (draft && visualPlan.articleVisuals && visualPlan.distributionMode === draft.distributionMode) tasks.push({ draft, visualPlan });
  }
  return tasks;
}

export async function listPendingProductionTasks(root: string): Promise<ProductionTaskRecord[]> {
  const pending: ProductionTaskRecord[] = [];
  for (const task of await listProductionTasks(root)) {
    const id = `production-${task.draft.analysisId}`;
    const destination = safeDataPath(root, '06-content-packages', `${id}.json`);
    const existing = await pathExists(destination) ? await readJson<ContentPackageRecord>(destination) : undefined;
    if (!existing || productionBoundaryChanges(existing, task.draft).length) pending.push(task);
  }
  return pending;
}

function partitionNarration(narration: string, count: number): string[] {
  const words = narration.trim().split(/\s+/).filter(Boolean);
  if (words.length < count) throw new Error('Narration has fewer words than visual scenes');
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor(index * words.length / count);
    const end = Math.floor((index + 1) * words.length / count);
    return words.slice(start, end).join(' ');
  });
}

async function writeArticlePreview(root: string, content: ContentPackageRecord): Promise<string> {
  if (!content.article) throw new Error('Article preview requires article content');
  const previewPath = safeDataPath(root, '06-content-packages', 'articles', content.id, 'index.html');
  const visualAssets: Record<string, import('./article-content.js').CreddyArticlePreviewVisual> = {};
  for (const asset of content.articleVisuals?.assets ?? []) {
    if (!asset.assetPath || !(await pathExists(asset.assetPath))) continue;
    const filename = articlePreviewImageFilename({ id: asset.id, assetPath: asset.assetPath });
    const destination = safeDataPath(root, '06-content-packages', 'articles', content.id, 'assets', filename);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(asset.assetPath, destination);
    visualAssets[asset.id] = { src: `assets/${filename}`, altText: asset.altText, ...(asset.photoCredit ? { photoCredit: asset.photoCredit } : {}) };
  }
  await mkdir(dirname(previewPath), { recursive: true });
  await writeFile(previewPath, renderCreddyArticlePreview(content.article, visualAssets));
  return previewPath;
}

/** Re-render existing article packages after a shared website-template update. */
export async function refreshArticlePreviews(root: string): Promise<ArticlePreviewRefreshResult> {
  const packagePaths = topLevelJson(
    await listJsonFiles(safeDataPath(root, '06-content-packages')),
    /\/(articles|legacy)\//,
  );
  const result: ArticlePreviewRefreshResult = { refreshedCount: 0, previewPaths: [] };
  for (const packagePath of packagePaths) {
    const content = await readJson<ContentPackageRecord>(packagePath);
    if (!content.article) continue;
    const previewPath = await writeArticlePreview(root, content);
    await writeJsonAtomic(packagePath, { ...content, articlePreviewPath: previewPath });
    const sidecarPath = safeDataPath(root, '06-content-packages', 'articles', `${content.id}.json`);
    if (await pathExists(sidecarPath)) {
      const sidecar = await readJson<Record<string, unknown>>(sidecarPath);
      await writeJsonAtomic(sidecarPath, { ...sidecar, previewPath });
    }
    result.refreshedCount += 1;
    result.previewPaths.push(previewPath);
  }
  return result;
}

export function buildProductionPackage(task: ProductionTaskRecord, now = new Date()): ContentPackageRecord {
  const { draft, visualPlan } = task;
  const articleOnly = draft.distributionMode === 'article_only';
  if (visualPlan.contentDraftId !== draft.id) throw new Error('Visual plan and content draft do not match');
  if (visualPlan.scenes.some((scene, index) => scene.text !== draft.textScenes[index])) {
    throw new Error('Visual plan changed Agent 4 copy');
  }
  if (JSON.stringify(visualPlan.sourceUrls) !== JSON.stringify(draft.sourceUrls)
    || JSON.stringify(visualPlan.factualClaims) !== JSON.stringify(draft.factualClaims)) {
    throw new Error('Visual plan changed accepted evidence');
  }
  if (JSON.stringify(visualPlan.verificationGate) !== JSON.stringify(draft.verificationGate)) {
    throw new Error('Visual plan changed the official-verification gate');
  }
  if (visualPlan.analysisBatchId !== draft.analysisBatchId) {
    throw new Error('Visual plan changed the Agent 03 batch identity');
  }
  if (JSON.stringify(visualPlan.productionAuthorization) !== JSON.stringify(draft.productionAuthorization)) {
    throw new Error('Visual plan changed the production authorization');
  }
  const content: ContentPackageRecord = {
    version: CREDDY_PIPELINE_VERSION,
    analysisBatchId: draft.analysisBatchId,
    distributionMode: draft.distributionMode,
    productionAuthorization: draft.productionAuthorization,
    contentDraftId: draft.id,
    id: `production-${draft.analysisId}`,
    analysisId: draft.analysisId,
    canonicalId: draft.canonicalId,
    createdAt: now.toISOString(),
    audience: draft.audience,
    slot: draft.slot,
    hook: draft.hook,
    scriptLines: articleOnly ? [] : visualPlan.scenes.map((scene) => scene.text),
    narrationLines: articleOnly ? [] : partitionNarration(draft.narrationScript, visualPlan.scenes.length),
    caption: articleOnly ? '' : draft.instagramCaption,
    platformCaptions: articleOnly ? undefined : { instagram: draft.instagramCaption, tiktok: draft.tiktokCaption },
    hashtags: articleOnly ? [] : draft.hashtags,
    cta: draft.cta,
    imagePrompts: visualPlan.scenes
      .filter((scene) => scene.background.mode === 'generated_illustration')
      .map((scene) => scene.background.prompt!),
    characterExpressions: articleOnly ? [] : visualPlan.scenes.map((scene) => scene.expression),
    visualPlanId: visualPlan.id,
    visualTheme: visualPlan.theme,
    brief: `${draft.brief}\n\nVisual direction: ${visualPlan.visualBrief}\nSafety overlays: ${visualPlan.safetyOverlays.join('; ')}`,
    sourceUrls: draft.sourceUrls,
    factualClaims: draft.factualClaims,
    verificationGate: draft.verificationGate,
    article: draft.article && { ...draft.article, blocks: draft.article.blocks.map(block => {
      if (block.type !== 'visual') return block;
      const asset = visualPlan.articleVisuals?.assets.find(asset => asset.id === block.visualId && asset.generationMode === 'compose' && (asset.brandAssetIds || asset.photoAssetId));
      return asset ? { ...block, caption: asset.caption } : block;
    }) },
    articleVisuals: visualPlan.articleVisuals,
    articleReadiness: draft.article && visualPlan.articleVisuals?.assets.every((asset) => Boolean(asset.assetPath))
      ? 'ready_for_review'
      : draft.article
        ? 'needs_assets'
        : undefined,
  };
  if (!articleOnly && content.narrationLines!.join(' ') !== draft.narrationScript.trim().replace(/\s+/g, ' ')) {
    throw new Error('Production package did not preserve Agent 4 narration');
  }
  if (content.article) {
    validateCreddyArticle(content.article, content.factualClaims, content.sourceUrls);
    if (!content.articleVisuals) throw new Error('Production package is missing Agent 05 article visuals');
    validateCreddyArticleVisuals(content.articleVisuals, content.article, content.factualClaims);
  }
  return validateContentPackage(content);
}

export async function prepareProductionPackages(root: string, now = new Date()): Promise<ProductionPreparationResult> {
  const tasks = await listProductionTasks(root);
  const result: ProductionPreparationResult = {
    inputCount: tasks.length,
    createdPackages: 0,
    updatedArticlePackages: 0,
    createdVideoJobs: 0,
    skippedCount: 0,
    packageIds: [],
  };
  for (const task of tasks) {
    try {
    // Do not transplant new evidence onto the previously reviewed package, even
    // when its article bytes also changed. Keep this item pending for revision.
    const priorPath = safeDataPath(root, '06-content-packages', `production-${task.draft.analysisId}.json`);
    if (await pathExists(priorPath)) {
      const prior = await readJson<ContentPackageRecord>(priorPath);
      const changedFields = productionBoundaryChanges(prior, task.draft);
      if (changedFields.length) {
        (result.revisionRequired ??= []).push({ packageId: prior.id, changedFields,
          reason: 'Current evidence or authorization changed; a fresh reviewed revision is required. Historical package and approvals retained.' });
        continue;
      }
    }
    // Existing supplied/generated assets remain immutable. Only explicit new
    // brand composition plans are rendered; social scenes are untouched.
    let composed = false;
    try {
    for (const asset of task.visualPlan.articleVisuals?.assets ?? []) {
      if (asset.generationMode !== 'compose' || (!asset.brandAssetIds && !asset.photoAssetId)) continue;
      // A supplied path must never bypass registry resolution or trusted photo credits.
      if (asset.assetPath && !asset.photoAssetId) continue;
      if (asset.photoAssetId && (asset.brandAssetIds !== undefined || asset.assetType !== 'licensed_photo'
          || asset.usage !== 'hero' || asset.id !== task.draft.article!.heroVisualId)) {
        throw new Error('Photo composition requires one explicitly selected licensed hero');
      }
      const section = task.draft.article!.blocks.find(block => block.id === asset.articleBlockId);
      const context = section && ('text' in section ? section.text : 'caption' in section ? section.caption : 'title' in section ? section.title : '');
      const image = asset.photoAssetId
        ? await composeEditorialPhoto({ root, photoId: asset.photoAssetId, usage: asset.usage })
        : await composeEditorialImage({ root, title: `${task.draft.article!.title} ${context || ''}`,
          usage: asset.usage, brandIds: asset.brandAssetIds! });
      asset.assetPath = image.assetPath;
      asset.altText = image.altText;
      asset.caption = image.caption;
      asset.provenance = image.provenanceText;
      if ('photoCredit' in image) asset.photoCredit = image.photoCredit;
      composed = true;
    }
    if (composed) await writeJsonAtomic(safeDataPath(root, '06-visual-plans', `${task.visualPlan.id}.json`), task.visualPlan);
    } catch {
      const failure = { visualPlanId: task.visualPlan.id, reason: 'Brand image composition failed; source plan retained for retry.' };
      (result.assetFailures ??= []).push(failure);
      result.skippedCount++;
      await writeJsonAtomic(safeDataPath(root, 'reports', 'brand-image-failures', `${task.visualPlan.id}.json`), failure);
      continue;
    }
    const content = buildProductionPackage(task, now);
    const destination = safeDataPath(root, '06-content-packages', `${content.id}.json`);
    if (await pathExists(destination)) {
      const existing = await readJson<ContentPackageRecord>(destination);
      if (existing.distributionMode !== content.distributionMode) {
        await writeJsonAtomic(
          safeDataPath(root, '06-content-packages', 'legacy', `${existing.id}-${existing.createdAt.replace(/[^0-9A-Za-z]+/g, '').slice(0, 24)}.json`),
          existing,
        );
      } else {
      const articleChanged = Boolean(content.article) &&
        (JSON.stringify(existing.article) !== JSON.stringify(content.article) ||
         JSON.stringify(existing.articleVisuals) !== JSON.stringify(content.articleVisuals) ||
         existing.articleReadiness !== content.articleReadiness);
      if (articleChanged && content.article) {
        const previewPath = await writeArticlePreview(root, content);
        const updated: ContentPackageRecord = {
          ...existing,
          article: content.article,
          articleVisuals: content.articleVisuals,
          articleReadiness: content.articleReadiness,
          articlePreviewPath: previewPath,
        };
        await writeJsonAtomic(destination, updated);
        await writeJsonAtomic(safeDataPath(root, '06-content-packages', 'articles', `${content.id}.json`), {
          id: content.id,
          revision: 1,
          readiness: content.articleReadiness,
          previewPath,
          article: content.article,
          visuals: content.articleVisuals,
        });
        result.updatedArticlePackages += 1;
      } else {
        result.skippedCount += 1;
      }
      continue;
      }
    }
    const jobs: VideoJobRecord[] = await writeContentAndJobs(root, content, 1, content.distributionMode !== 'article_only');
    if (content.article) {
      const previewPath = await writeArticlePreview(root, content);
      content.articlePreviewPath = previewPath;
      await writeJsonAtomic(destination, content);
      await writeJsonAtomic(safeDataPath(root, '06-content-packages', 'articles', `${content.id}.json`), {
        id: content.id,
        revision: 1,
        readiness: content.articleReadiness,
        previewPath,
        article: content.article,
        visuals: content.articleVisuals,
      });
    }
    result.createdPackages += 1;
    result.createdVideoJobs += jobs.length;
    result.packageIds.push(content.id);
    } catch {
      (result.assetFailures ??= []).push({ visualPlanId: task.visualPlan.id,
        reason: 'Production validation failed; source draft and plan retained for correction.' });
    }
  }
  await writeJsonAtomic(safeDataPath(root, 'reports', 'latest', '06-production-preparation.json'), {
    generatedAt: now.toISOString(), ...result,
    status: result.revisionRequired?.length || result.assetFailures?.length ? 'degraded' : 'completed',
  });
  return result;
}
