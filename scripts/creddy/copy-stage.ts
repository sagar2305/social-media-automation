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
  type ContentOpportunityTaskRecord,
} from './pipeline-types.js';

function words(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

const META_SOURCE_LANGUAGE = [
  /\b(?:this|the|that|a)\s+(?:article|story|report|guide|post|source|website)\b/i,
  /\b(?:article|source)\s+(?:report|review|summary|explainer|says|states|notes|covers)\b/i,
  /\baccording to\s+(?:(?:this|the|a|an)\s+)?(?:article|source|report|guide|website)\b/i,
  /\bsource[- ]linked\b/i,
  /\bsingle[- ]source\b/i,
  /\bevergreen\s+(?:orientation|item)\b/i,
  /\bcited\s+(?:article|guide|report|source)\b/i,
  /\b(?:read|review|visit|open)\s+(?:this|the)\s+(?:article|guide|report|source|website)\b/i,
];

function assertIndependentContent(value: string, field: string): void {
  if (META_SOURCE_LANGUAGE.some((pattern) => pattern.test(value))) {
    throw new Error(
      `${field} must teach the audience directly; article, source-report, guide-review, and other meta-source wording is not allowed`,
    );
  }
}

export function validateIndependentSlideshowCopy(
  draft: Pick<ContentDraftRecord, 'hook' | 'textScenes' | 'narrationScript'>,
): void {
  assertIndependentContent(draft.hook, 'Hook');
  draft.textScenes.forEach((scene, index) => assertIndependentContent(scene, `Text scene ${index + 1}`));
  assertIndependentContent(draft.narrationScript, 'Narration');
}

function normalizedSourceIdentifiers(article: CanonicalNewsRecord): string[] {
  const host = new URL(article.canonicalUrl).hostname.replace(/^www\./, '');
  const hostLabel = host.split('.')[0] ?? '';
  return [article.sourceName, host, hostLabel]
    .map((value) => value.trim().toLocaleLowerCase())
    .filter((value) => value.length >= 4);
}

function assertSlidesDoNotNamePublisher(draft: ContentDraftRecord, article: CanonicalNewsRecord): void {
  const slideCopy = [draft.hook, ...draft.textScenes, draft.narrationScript]
    .join('\n')
    .toLocaleLowerCase();
  const identifier = normalizedSourceIdentifiers(article)
    .find((candidate) => slideCopy.includes(candidate));
  if (identifier) {
    throw new Error(
      'On-slide copy and narration must be independent of the publisher; keep source attribution in captions, sourceUrls, and evidence only',
    );
  }
}

export function validateContentDraft(draft: ContentDraftRecord): ContentDraftRecord {
  if (draft.version !== CREDDY_PIPELINE_VERSION) throw new Error('Invalid content-draft version');
  if (!draft.id || !draft.analysisId || !draft.canonicalId) throw new Error('Content-draft IDs are required');
  if (!draft.id.startsWith('copy-')) throw new Error('Content-draft ID must start with copy-');
  if (!['act_now', 'understand', 'decide_or_discuss'].includes(draft.slot)) throw new Error('Invalid content slot');
  if (!draft.hook.trim() || draft.hook.length > 140) throw new Error('Hook must contain 1–140 characters');
  if (!Array.isArray(draft.textScenes) || draft.textScenes.length !== 6) {
    throw new Error('Creddy slideshow requires exactly six text scenes');
  }
  if (draft.textScenes.some((scene) => !scene.trim() || scene.length > 220)) {
    throw new Error('Every text scene must contain 1–220 characters');
  }
  validateIndependentSlideshowCopy(draft);
  const narrationWords = words(draft.narrationScript);
  if (narrationWords < 35 || narrationWords > 220) throw new Error('Narration must contain 35–220 words');
  if (!draft.instagramCaption.trim() || draft.instagramCaption.length > 2_200) {
    throw new Error('Instagram caption must contain 1–2200 characters');
  }
  if (!draft.tiktokCaption.trim() || draft.tiktokCaption.length > 2_200) {
    throw new Error('TikTok caption must contain 1–2200 characters');
  }
  if (!Array.isArray(draft.hashtags) || draft.hashtags.length < 3 || draft.hashtags.length > 12) {
    throw new Error('Content draft requires 3–12 hashtags');
  }
  if (!draft.cta?.deepLink.startsWith('creddy://')) throw new Error('CTA must use a creddy:// app deep link');
  if (!Array.isArray(draft.sourceUrls) || draft.sourceUrls.length === 0) throw new Error('At least one source URL is required');
  for (const value of draft.sourceUrls) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid source URL');
  }
  if (!Array.isArray(draft.factualClaims)) throw new Error('factualClaims must be an array');
  return draft;
}

async function opportunityTasks(root: string): Promise<ContentOpportunityTaskRecord[]> {
  const canonical = await Promise.all(
    (await listJsonFiles(safeDataPath(root, '03-canonical-news', 'approved')))
      .map((path) => readJson<CanonicalNewsRecord>(path)),
  );
  const articleById = new Map(canonical.map((article) => [article.canonicalId, article]));
  const tasks: ContentOpportunityTaskRecord[] = [];
  for (const path of await listJsonFiles(safeDataPath(root, '05-content-opportunities'))) {
    const decision = await readJson<AnalysisDecisionRecord>(path);
    if (!['auto_process', 'evergreen_queue'].includes(decision.route)) continue;
    const article = articleById.get(decision.canonicalId);
    if (article) tasks.push({ decision, article });
  }
  return tasks;
}

export async function listPendingCopyTasks(root: string): Promise<ContentOpportunityTaskRecord[]> {
  const tasks = await opportunityTasks(root);
  const pending: ContentOpportunityTaskRecord[] = [];
  for (const task of tasks) {
    if (!(await pathExists(safeDataPath(root, '06-content-drafts', `copy-${task.decision.id}.json`)))) {
      pending.push(task);
    }
  }
  return pending;
}

export async function acceptContentDraft(root: string, input: ContentDraftRecord): Promise<void> {
  const draft = validateContentDraft(input);
  const task = (await opportunityTasks(root))
    .find((candidate) => candidate.decision.id === draft.analysisId);
  if (!task) throw new Error(`Content opportunity not found: ${draft.analysisId}`);
  if (draft.id !== `copy-${draft.analysisId}`) throw new Error('Content-draft stable ID mismatch');
  if (draft.canonicalId !== task.decision.canonicalId) throw new Error('Canonical identity mismatch');
  if (!draft.sourceUrls.includes(task.article.canonicalUrl)) {
    throw new Error('Content draft must retain the canonical source URL');
  }
  if (JSON.stringify(draft.factualClaims) !== JSON.stringify(task.decision.claims)) {
    throw new Error('Content draft must preserve the accepted factual claims exactly');
  }
  assertSlidesDoNotNamePublisher(draft, task.article);

  await writeJsonAtomic(safeDataPath(root, '06-content-drafts', `${draft.id}.json`), draft);
  await writeJsonAtomic(safeDataPath(root, '06-content-drafts', 'scripts', `${draft.id}.json`), {
    id: draft.id,
    hook: draft.hook,
    textScenes: draft.textScenes,
    narrationScript: draft.narrationScript,
  });
  await writeJsonAtomic(safeDataPath(root, '06-content-drafts', 'captions', `${draft.id}.json`), {
    id: draft.id,
    instagramCaption: draft.instagramCaption,
    tiktokCaption: draft.tiktokCaption,
    hashtags: draft.hashtags,
    cta: draft.cta,
  });
  await writeJsonAtomic(safeDataPath(root, '06-content-drafts', 'briefs', `${draft.id}.json`), {
    id: draft.id,
    audience: draft.audience,
    slot: draft.slot,
    brief: draft.brief,
    sourceUrls: draft.sourceUrls,
    factualClaims: draft.factualClaims,
  });
}
