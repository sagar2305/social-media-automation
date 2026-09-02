import { validateContentPackage, writeContentAndJobs } from './content-stage.js';
import { renderCreddyArticlePreview, validateCreddyArticle, validateCreddyArticleVisuals } from './article-content.js';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
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
    if (!existing || existing.distributionMode !== task.draft.distributionMode ||
        existing.analysisBatchId !== task.draft.analysisBatchId ||
        JSON.stringify(existing.productionAuthorization) !== JSON.stringify(task.draft.productionAuthorization) ||
        JSON.stringify(existing.verificationGate) !== JSON.stringify(task.draft.verificationGate) ||
        JSON.stringify(existing.factualClaims) !== JSON.stringify(task.draft.factualClaims)) pending.push(task);
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
  const visualAssets: Record<string, { src: string; altText: string }> = {};
  for (const asset of content.articleVisuals?.assets ?? []) {
    if (!asset.assetPath || !(await pathExists(asset.assetPath))) continue;
    const sourceExtension = extname(asset.assetPath).toLowerCase();
    const extension = ['.png', '.jpg', '.jpeg', '.webp'].includes(sourceExtension) ? sourceExtension : '.png';
    const filename = `${asset.id}${extension}`;
    const destination = safeDataPath(root, '06-content-packages', 'articles', content.id, 'assets', filename);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(asset.assetPath, destination);
    visualAssets[asset.id] = { src: `assets/${filename}`, altText: asset.altText };
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
    article: draft.article,
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
  }
  return result;
}
