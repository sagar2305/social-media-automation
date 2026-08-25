import { validateContentPackage, writeContentAndJobs } from './content-stage.js';
import { renderCreddyArticlePreview, validateCreddyArticle, validateCreddyArticleVisuals } from './article-content.js';
import { mkdir, writeFile } from 'node:fs/promises';
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
  type ContentDraftRecord,
  type ContentPackageRecord,
  type VideoJobRecord,
  type VisualPlanRecord,
} from './pipeline-types.js';

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

function topLevelJson(paths: string[], nested: RegExp): string[] {
  return paths.filter((path) => !nested.test(path));
}

export async function listProductionTasks(root: string): Promise<ProductionTaskRecord[]> {
  const decisions = await Promise.all(
    (await listJsonFiles(safeDataPath(root, '05-content-opportunities')))
      .map((path) => readJson<AnalysisDecisionRecord>(path)),
  );
  const eligibleAnalysisIds = new Set(decisions
    .filter((decision) =>
      decision.rubricVersion === 'creddy-ranking-v3' &&
      decision.verificationState === 'ready' &&
      ['auto_process', 'evergreen_queue'].includes(decision.route))
    .map((decision) => decision.id));
  const draftPaths = topLevelJson(
    await listJsonFiles(safeDataPath(root, '06-content-drafts')),
    /\/(scripts|captions|briefs|articles|legacy)\//,
  );
  const drafts = await Promise.all(draftPaths.map((path) => readJson<ContentDraftRecord>(path)));
  const draftById = new Map(drafts
    .filter((draft) =>
      draft.copyVersion === 'creddy-copy-v3' &&
      Boolean(draft.article) &&
      eligibleAnalysisIds.has(draft.analysisId))
    .map((draft) => [draft.id, draft]));
  const tasks: ProductionTaskRecord[] = [];
  for (const path of await listJsonFiles(safeDataPath(root, '06-visual-plans'))) {
    const visualPlan = await readJson<VisualPlanRecord>(path);
    const draft = draftById.get(visualPlan.contentDraftId);
    if (draft && visualPlan.articleVisuals) tasks.push({ draft, visualPlan });
  }
  return tasks;
}

export async function listPendingProductionTasks(root: string): Promise<ProductionTaskRecord[]> {
  const pending: ProductionTaskRecord[] = [];
  for (const task of await listProductionTasks(root)) {
    const id = `production-${task.draft.analysisId}`;
    if (!(await pathExists(safeDataPath(root, '06-content-packages', `${id}.json`)))) pending.push(task);
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

export function buildProductionPackage(task: ProductionTaskRecord, now = new Date()): ContentPackageRecord {
  const { draft, visualPlan } = task;
  if (visualPlan.contentDraftId !== draft.id) throw new Error('Visual plan and content draft do not match');
  if (visualPlan.scenes.some((scene, index) => scene.text !== draft.textScenes[index])) {
    throw new Error('Visual plan changed Agent 4 copy');
  }
  if (JSON.stringify(visualPlan.sourceUrls) !== JSON.stringify(draft.sourceUrls)
    || JSON.stringify(visualPlan.factualClaims) !== JSON.stringify(draft.factualClaims)) {
    throw new Error('Visual plan changed accepted evidence');
  }
  const content: ContentPackageRecord = {
    version: CREDDY_PIPELINE_VERSION,
    id: `production-${draft.analysisId}`,
    analysisId: draft.analysisId,
    canonicalId: draft.canonicalId,
    createdAt: now.toISOString(),
    audience: draft.audience,
    slot: draft.slot,
    hook: draft.hook,
    scriptLines: visualPlan.scenes.map((scene) => scene.text),
    narrationLines: partitionNarration(draft.narrationScript, visualPlan.scenes.length),
    caption: draft.instagramCaption,
    platformCaptions: { instagram: draft.instagramCaption, tiktok: draft.tiktokCaption },
    hashtags: draft.hashtags,
    cta: draft.cta,
    imagePrompts: visualPlan.scenes
      .filter((scene) => scene.background.mode === 'generated_illustration')
      .map((scene) => scene.background.prompt!),
    characterExpressions: visualPlan.scenes.map((scene) => scene.expression),
    visualPlanId: visualPlan.id,
    visualTheme: visualPlan.theme,
    brief: `${draft.brief}\n\nVisual direction: ${visualPlan.visualBrief}\nSafety overlays: ${visualPlan.safetyOverlays.join('; ')}`,
    sourceUrls: draft.sourceUrls,
    factualClaims: draft.factualClaims,
    article: draft.article,
    articleVisuals: visualPlan.articleVisuals,
    articleReadiness: draft.article && visualPlan.articleVisuals?.assets.every((asset) => Boolean(asset.assetPath))
      ? 'ready_for_review'
      : draft.article
        ? 'needs_assets'
        : undefined,
  };
  if (content.narrationLines!.join(' ') !== draft.narrationScript.trim().replace(/\s+/g, ' ')) {
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
      const articleChanged = Boolean(content.article) &&
        (JSON.stringify(existing.article) !== JSON.stringify(content.article) ||
         JSON.stringify(existing.articleVisuals) !== JSON.stringify(content.articleVisuals) ||
         existing.articleReadiness !== content.articleReadiness);
      if (articleChanged && content.article) {
        const previewPath = safeDataPath(root, '06-content-packages', 'articles', content.id, 'index.html');
        await mkdir(dirname(previewPath), { recursive: true });
        await writeFile(previewPath, renderCreddyArticlePreview(content.article));
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
    const jobs: VideoJobRecord[] = await writeContentAndJobs(root, content, 1);
    if (content.article) {
      const previewPath = safeDataPath(root, '06-content-packages', 'articles', content.id, 'index.html');
      await mkdir(dirname(previewPath), { recursive: true });
      await writeFile(previewPath, renderCreddyArticlePreview(content.article));
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
