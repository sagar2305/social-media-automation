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
  type ContentConceptPack,
  type ContentDraftRecord,
  type ContentOpportunityTaskRecord,
} from './pipeline-types.js';

function words(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

const BANNED_HYPE = [
  /\byou won['’]?t believe\b/i,
  /\b(?:secret|hack|game[ -]?changer)\b/i,
  /(?:^|[\s“"'(])(?:I|i|we|We|me|Me|my|My|mine|Mine|our|Our|ours|Ours)(?=$|[\s,.!?;:”"')])/,
  /\b(?:last chance|act now|don['’]?t wait|ends soon|before it['’]?s gone)\b/i,
  /[!?]{2,}/,
  /\b[A-Z]{5,}\b/,
];

const GUARDED_SUPERLATIVES = [
  'best', 'biggest', 'free', 'guaranteed', 'highest', 'record',
] as const;

function normalizedNumericTokens(value: string): Set<string> {
  const matches = value.match(/\$?\d[\d,.]*(?:\.\d+)?(?:k|m)?%?/gi) ?? [];
  return new Set(matches.map((raw) => {
    const currency = raw.startsWith('$');
    const percent = raw.endsWith('%');
    const suffix = raw.replace(/[%]$/, '').toLowerCase().endsWith('k')
      ? 1_000
      : raw.replace(/[%]$/, '').toLowerCase().endsWith('m')
        ? 1_000_000
        : 1;
    const numeric = Number(raw.replace(/^\$/, '').replace(/[%km,]/gi, '')) * suffix;
    return `${currency ? '$' : ''}${numeric}${percent ? '%' : ''}`;
  }));
}

function conceptCopy(pack: ContentConceptPack): string[] {
  const { platforms } = pack;
  return [
    ...pack.candidates.flatMap((candidate) => [candidate.concept, candidate.promise]),
    platforms.blog.headline, platforms.blog.lede,
    platforms.newsletter.subject, platforms.newsletter.preheader,
    platforms.youtubeLong.title, platforms.youtubeLong.thumbnailPhrase, platforms.youtubeLong.openingLine,
    platforms.youtubeShort.title, platforms.youtubeShort.openingLine,
    platforms.instagram.coverHook, platforms.instagram.captionOpener,
    platforms.tiktok.coverHook, platforms.tiktok.captionOpener,
  ];
}

function assertDisplayCopy(value: string, field: string, max: number, maxWords?: number): void {
  if (!value.trim() || value.length > max || (maxWords !== undefined && words(value) > maxWords)) {
    throw new Error(`${field} must contain 1–${max} characters${maxWords ? ` and at most ${maxWords} words` : ''}`);
  }
  if (BANNED_HYPE.some((pattern) => pattern.test(value))) {
    throw new Error(`${field} contains prohibited clickbait, fabricated experience, punctuation, or all-caps bait`);
  }
}

export function validateContentConceptPack(draft: ContentDraftRecord): ContentConceptPack {
  const pack = draft.conceptPack;
  if (!pack) throw new Error('Agent 04 copy v2 requires a concept pack');
  if (!pack.subjectLabel?.trim() || pack.subjectLabel.length > 50) {
    throw new Error('Concept pack requires a concise standalone subject label');
  }
  if (!Array.isArray(pack.candidates) || pack.candidates.length !== 4) {
    throw new Error('Concept pack requires exactly four candidates');
  }
  const candidateIds = new Set(pack.candidates.map((candidate) => candidate.id));
  const styles = new Set(pack.candidates.map((candidate) => candidate.style));
  const normalizedConcepts = new Set(pack.candidates.map((candidate) =>
    candidate.concept.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()));
  if (candidateIds.size !== 4 || styles.size !== 4 || normalizedConcepts.size !== 4) {
    throw new Error('Concept candidates require unique IDs, styles, and normalized copy');
  }
  const selected = pack.candidates.find((candidate) => candidate.id === pack.selectedCandidateId);
  if (!selected) throw new Error('Selected concept candidate does not exist');
  if (!pack.selectionRationale.trim()) throw new Error('Concept selection rationale is required');
  const rejected = pack.rejectionReasons;
  if (!Array.isArray(rejected) || rejected.length !== 3 ||
      new Set(rejected.map((item) => item.candidateId)).size !== 3 ||
      rejected.some((item) => !item.reason.trim() || item.candidateId === selected.id || !candidateIds.has(item.candidateId))) {
    throw new Error('Concept pack requires one rejection reason for every non-selected candidate');
  }
  if (![2, 3].includes(pack.resolution?.slideNumber) || !pack.resolution?.explanation.trim()) {
    throw new Error('Concept pack must explain how the promise resolves by slide 2 or 3');
  }
  const resolutionScene = draft.textScenes[pack.resolution.slideNumber - 1];
  if (!pack.resolution.slideExcerpt?.trim() || pack.resolution.slideExcerpt.length > 160 ||
      !resolutionScene?.includes(pack.resolution.slideExcerpt)) {
    throw new Error('Concept resolution excerpt must appear exactly on the declared resolution slide');
  }
  if (!Array.isArray(pack.fulfillment?.slideNumbers) ||
      !pack.fulfillment.slideNumbers.includes(pack.resolution.slideNumber) ||
      pack.fulfillment.slideNumbers.some((number) => !Number.isInteger(number) || number < 1 || number > 6)) {
    throw new Error('Concept fulfillment must identify valid slides and include the resolution slide');
  }
  const excerpts = [
    [pack.fulfillment.narrationExcerpt, draft.narrationScript, 'narration'],
    [pack.fulfillment.instagramCaptionExcerpt, draft.instagramCaption, 'Instagram caption'],
    [pack.fulfillment.tiktokCaptionExcerpt, draft.tiktokCaption, 'TikTok caption'],
  ] as const;
  for (const [excerpt, output, name] of excerpts) {
    if (!excerpt.trim() || excerpt.length > 160 || !output.includes(excerpt)) {
      throw new Error(`Concept fulfillment ${name} excerpt must appear exactly in the finished output`);
    }
  }

  const acceptedFields = new Set(draft.factualClaims.map((claim) => claim.field));
  const selectedFields = new Set(selected.supportingClaimFields);
  const traces = [
    ...pack.candidates.map((candidate) => [candidate.supportingClaimFields, `candidate ${candidate.id}`] as const),
    ...Object.entries(pack.platforms).map(([name, platform]) => [platform.claimFields, name] as const),
  ];
  for (const [fields, name] of traces) {
    if (!Array.isArray(fields) || fields.length === 0 || fields.some((field) => !acceptedFields.has(field))) {
      throw new Error(`${name} must reference one or more accepted factual claim fields`);
    }
  }
  for (const [name, platform] of Object.entries(pack.platforms)) {
    if ([...selectedFields].some((field) => !platform.claimFields.includes(field))) {
      throw new Error(`${name} must preserve every selected-concept claim field`);
    }
  }

  for (const candidate of pack.candidates) {
    assertDisplayCopy(candidate.concept, `Candidate ${candidate.id} concept`, 140);
    assertDisplayCopy(candidate.promise, `Candidate ${candidate.id} promise`, 220);
  }
  assertDisplayCopy(pack.platforms.blog.headline, 'Blog headline', 70);
  assertDisplayCopy(pack.platforms.blog.lede, 'Blog lede', 240);
  assertDisplayCopy(pack.platforms.newsletter.subject, 'Newsletter subject', 55);
  assertDisplayCopy(pack.platforms.newsletter.preheader, 'Newsletter preheader', 90);
  assertDisplayCopy(pack.platforms.youtubeLong.title, 'YouTube title', 70);
  assertDisplayCopy(pack.platforms.youtubeLong.thumbnailPhrase, 'YouTube thumbnail phrase', 28, 4);
  assertDisplayCopy(pack.platforms.youtubeLong.openingLine, 'YouTube opening line', 100);
  assertDisplayCopy(pack.platforms.youtubeShort.title, 'YouTube Short title', 70);
  assertDisplayCopy(pack.platforms.youtubeShort.openingLine, 'YouTube Short opening line', 100);
  assertDisplayCopy(pack.platforms.instagram.coverHook, 'Instagram cover hook', 60, 10);
  assertDisplayCopy(pack.platforms.instagram.captionOpener, 'Instagram caption opener', 160);
  assertDisplayCopy(pack.platforms.tiktok.coverHook, 'TikTok cover hook', 60, 10);
  assertDisplayCopy(pack.platforms.tiktok.captionOpener, 'TikTok caption opener', 160);
  const standaloneTitles = [
    ['Blog headline', pack.platforms.blog.headline],
    ['Newsletter subject', pack.platforms.newsletter.subject],
    ['YouTube title', pack.platforms.youtubeLong.title],
    ['YouTube Short title', pack.platforms.youtubeShort.title],
    ['Instagram cover hook', pack.platforms.instagram.coverHook],
    ['TikTok cover hook', pack.platforms.tiktok.coverHook],
  ] as const;
  for (const [name, value] of standaloneTitles) {
    if (!value.toLocaleLowerCase().includes(pack.subjectLabel.toLocaleLowerCase())) {
      throw new Error(`${name} must name the standalone subject: ${pack.subjectLabel}`);
    }
  }
  if (draft.hook !== pack.platforms.instagram.coverHook) {
    throw new Error('Legacy hook must equal the selected Instagram cover hook');
  }

  const acceptedCopy = draft.factualClaims.map((claim) => JSON.stringify(claim.value)).join(' ');
  const acceptedNumbers = normalizedNumericTokens(acceptedCopy);
  for (const value of conceptCopy(pack)) {
    for (const token of normalizedNumericTokens(value)) {
      if (!acceptedNumbers.has(token)) throw new Error(`Concept copy contains unsupported number: ${token}`);
    }
  }
  const acceptedLower = acceptedCopy.toLocaleLowerCase();
  for (const value of conceptCopy(pack)) {
    const lower = value.toLocaleLowerCase();
    for (const word of GUARDED_SUPERLATIVES) {
      if (new RegExp(`\\b${word}\\b`, 'i').test(lower) && !new RegExp(`\\b${word}\\b`, 'i').test(acceptedLower)) {
        throw new Error(`Concept copy contains unsupported superlative or guarantee: ${word}`);
      }
    }
  }
  return pack;
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
  if (draft.copyVersion === 'creddy-copy-v2') validateContentConceptPack(draft);
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
    const output = safeDataPath(root, '06-content-drafts', `copy-${task.decision.id}.json`);
    if (!(await pathExists(output)) ||
        (await readJson<ContentDraftRecord>(output)).copyVersion !== 'creddy-copy-v2') {
      pending.push(task);
    }
  }
  return pending;
}

export async function acceptContentDraft(root: string, input: ContentDraftRecord): Promise<void> {
  const draft = validateContentDraft(input);
  if (draft.copyVersion !== 'creddy-copy-v2') {
    throw new Error('New Agent 04 drafts must use creddy-copy-v2');
  }
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

  const outputPath = safeDataPath(root, '06-content-drafts', `${draft.id}.json`);
  if (await pathExists(outputPath)) {
    const previous = await readJson<ContentDraftRecord>(outputPath);
    if (previous.copyVersion !== 'creddy-copy-v2') {
      const archiveSuffix = previous.createdAt.replace(/[^0-9A-Za-z]+/g, '').slice(0, 24) || 'undated';
      await writeJsonAtomic(
        safeDataPath(root, '06-content-drafts', 'legacy', `${previous.id}-${archiveSuffix}.json`),
        previous,
      );
    }
  }
  await writeJsonAtomic(outputPath, draft);
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
