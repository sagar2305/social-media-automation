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
  type CreddyCharacterExpression,
  type CreddyVisualTheme,
  type VisualPlanRecord,
  type VisualPlanningTaskRecord,
} from './pipeline-types.js';
import { phoneTemplateForDraft } from './product-capabilities.js';
import { validateCreddyArticleVisuals } from './article-content.js';

export const CREDDY_MANIFEST_EXPRESSIONS = new Set<CreddyCharacterExpression>([
  'neutral', 'waving', 'thinking', 'confused', 'celebrate', 'guide', 'surprised',
  'sleepy', 'wink', 'thumbs-up', 'sad', 'worried', 'card', 'rewards', 'curious',
  'skeptical', 'idea', 'pointing', 'happy', 'urgent',
]);

export const CREDDY_VIDEO_THEMES = new Set<CreddyVisualTheme>([
  'editorial', 'midnight', 'ledger', 'poster', 'aurora',
]);

const CREDDY_PHONE_TEMPLATES = new Set<NonNullable<VisualPlanRecord['phoneTemplateId']>>([
  'wallet_vouchers', 'spend_goals', 'app_store_dark', 'app_store_light',
]);

type ExpressionScene = Pick<VisualPlanRecord['scenes'][number], 'role' | 'text'>;

/** Selects an approved pose from scene meaning. Agent 5 may refine it, but never invent assets. */
export function selectCreddyExpression(
  scene: ExpressionScene,
  previous?: CreddyCharacterExpression,
): CreddyCharacterExpression {
  const text = scene.text.toLowerCase();
  const choose = (...options: CreddyCharacterExpression[]): CreddyCharacterExpression =>
    options.find((option) => option !== previous) ?? options[0]!;

  if (/expired|missed|lost|denied|devalu|bad news|removed|ending/.test(text)) {
    return choose('worried', 'sad', 'skeptical', 'urgent');
  }
  if (/urgent|deadline|last chance|today only|act now|immediately/.test(text)) {
    return choose('urgent', 'surprised', 'worried');
  }
  if (/\?|which|should|why|how|compare|worth it/.test(text)) {
    return choose('thinking', 'confused', 'curious', 'skeptical', 'idea');
  }
  if (/new|did you know|sweet spot|discovered|strategy|tip/.test(text)) {
    return choose('idea', 'curious', 'wink', 'pointing');
  }
  if (/points|miles|cashback|cash back|rewards|bonus|value/.test(text)) {
    return choose('rewards', 'happy', 'celebrate', 'thumbs-up');
  }
  if (/credit card|card benefit|annual fee|statement credit/.test(text)) {
    return choose('card', 'guide', 'pointing');
  }
  if (/approved|eligible|confirmed|works|success/.test(text)) {
    return choose('thumbs-up', 'celebrate', 'happy', 'wink');
  }
  if (scene.role === 'caution') return choose('worried', 'urgent', 'skeptical', 'surprised');
  if (scene.role === 'cta') return choose('pointing', 'waving', 'thumbs-up', 'wink');
  if (scene.role === 'hook') return choose('surprised', 'idea', 'curious');
  if (scene.role === 'fact') return choose('guide', 'card', 'rewards', 'thumbs-up');
  if (scene.role === 'context') return choose('thinking', 'curious', 'guide');
  return choose('neutral', 'waving');
}

function contentDraftFiles(root: string): Promise<string[]> {
  return listJsonFiles(safeDataPath(root, '06-content-drafts')).then((files) =>
    files.filter((path) => !/\/(scripts|captions|briefs|articles|legacy)\//.test(path)),
  );
}

async function visualTasks(root: string): Promise<VisualPlanningTaskRecord[]> {
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
  const drafts = await Promise.all(
    (await contentDraftFiles(root)).map((path) => readJson<ContentDraftRecord>(path)),
  );
  return drafts
    .filter((draft) =>
      draft.copyVersion === 'creddy-copy-v3' &&
      Boolean(draft.article) &&
      eligibleAnalysisIds.has(draft.analysisId))
    .map((draft) => ({ draft }));
}

export function validateVisualPlan(plan: VisualPlanRecord): VisualPlanRecord {
  if (plan.version !== CREDDY_PIPELINE_VERSION) throw new Error('Invalid visual-plan version');
  if (!plan.id || !plan.contentDraftId || !plan.analysisId || !plan.canonicalId) {
    throw new Error('Visual-plan IDs are required');
  }
  if (!['9:16', '3:4'].includes(plan.format)) {
    throw new Error('Creddy social visual plans must use 9:16 video or 3:4 slideshow format');
  }
  if (!CREDDY_VIDEO_THEMES.has(plan.theme)) throw new Error('Unsupported Creddy Video Factory theme');
  if (plan.characterPack !== 'credit-card-rewards/creddy') throw new Error('Unsupported character pack');
  if (!plan.cover?.headline.trim() || plan.cover.headline.length > 100) {
    throw new Error('Cover headline must contain 1–100 characters');
  }
  if (!plan.cover?.subheadline.trim() || plan.cover.subheadline.length > 140) {
    throw new Error('Cover subheadline must contain 1–140 characters');
  }
  if (!Array.isArray(plan.scenes) || plan.scenes.length < 3 || plan.scenes.length > 8) {
    throw new Error('Visual plan requires 3–8 scenes');
  }
  if (plan.format === '3:4' && plan.scenes.length !== 6) {
    throw new Error('A Creddy 3:4 slideshow post requires exactly 6 scenes');
  }
  if (plan.format === '3:4' && (!plan.phoneTemplateId || !CREDDY_PHONE_TEMPLATES.has(plan.phoneTemplateId))) {
    throw new Error('A Creddy 3:4 slideshow requires one approved phoneTemplateId');
  }
  if (plan.format === '3:4' && (plan.scenes[0]?.role !== 'hook' || plan.scenes[5]?.role !== 'cta')) {
    throw new Error('A Creddy slideshow requires a hook on slide 1 and CTA on slide 6');
  }
  if (plan.format === '3:4' && plan.cover.headline.trim().split(/\s+/).length > 12) {
    throw new Error('A Creddy slideshow cover must use at most 12 words; return copy to Agent 4 for shortening');
  }
  for (const [index, scene] of plan.scenes.entries()) {
    if (scene.sceneIndex !== index) throw new Error('Visual scene indexes must be zero-based and sequential');
    if (!scene.text.trim()) throw new Error('Every visual scene requires text');
    if (!['hook', 'fact', 'context', 'caution', 'cta'].includes(scene.role)) {
      throw new Error('Unsupported visual scene role');
    }
    if (!CREDDY_MANIFEST_EXPRESSIONS.has(scene.expression)) {
      throw new Error(`Expression is not present in the Creddy manifest: ${scene.expression}`);
    }
    if (!Array.isArray(scene.emphasis) || scene.emphasis.some((value) => !value.trim())) {
      throw new Error('Scene emphasis must be a string array');
    }
    if (plan.format === '3:4' && (scene.emphasis.length < 1 || scene.emphasis.length > 2)) {
      throw new Error('Each Creddy slideshow scene requires one meaningful emphasis phrase, or two linked numeric values');
    }
    if (plan.format === '3:4' && scene.emphasis.length === 2 &&
        scene.emphasis.some((value) => !/[\d$%]/.test(value))) {
      throw new Error('Two emphasis phrases are allowed only for linked numeric values');
    }
    if (scene.emphasis.some((value) => !scene.text.toLocaleLowerCase().includes(value.toLocaleLowerCase()))) {
      throw new Error('Every emphasis phrase must appear exactly in its scene text');
    }
    if (!['template', 'generated_illustration'].includes(scene.background?.mode)) {
      throw new Error('Unsupported scene background mode');
    }
    if (scene.background.style && !['spotlight', 'deep_navy', 'forest', 'burgundy'].includes(scene.background.style)) {
      throw new Error('Unsupported scene background style');
    }
    if (scene.background.mode === 'generated_illustration' && !scene.background.prompt?.trim()) {
      throw new Error('Generated illustration scenes require a prompt');
    }
    if (plan.format === '3:4' && scene.background.mode !== 'template') {
      throw new Error('Creddy slideshows remain mascot/app-led and use template backgrounds only');
    }
    if (plan.format === '3:4' && scene.text.trim().split(/\s+/).length > (index === 0 ? 12 : 22)) {
      throw new Error('Slideshow copy exceeds the premium-editorial word budget; return it to Agent 4 for shortening');
    }
  }
  if (plan.format === '3:4') {
    const styles = plan.scenes.map((scene) => scene.background.style ?? (scene.role === 'caution' ? 'burgundy' : 'spotlight'));
    if (plan.scenes.some((scene, index) => scene.role === 'caution' && styles[index] !== 'burgundy') ||
        plan.scenes.some((scene, index) => scene.role !== 'caution' && styles[index] === 'burgundy')) {
      throw new Error('Burgundy is reserved for genuine caution scenes');
    }
    if (styles[0] !== 'spotlight' || styles[5] !== 'spotlight') {
      throw new Error('Hook and CTA slides must use the recognizable Creddy spotlight treatment');
    }
    const deckAccents = new Set(styles.filter((style) => style === 'deep_navy' || style === 'forest'));
    if (deckAccents.size > 1) {
      throw new Error('A slideshow may use only one deck accent family beyond spotlight and caution burgundy');
    }
    if (!plan.scenes.slice(1, 5).some((scene) => scene.role === 'fact' || scene.role === 'context')) {
      throw new Error('A slideshow requires a standard editorial treatment between its hook and CTA');
    }
    if (plan.scenes.slice(0, 5).some((scene) => scene.role === 'cta')) {
      throw new Error('CTA treatment is reserved for slide 6');
    }
  }
  const uniqueExpressions = new Set(plan.scenes.map((scene) => scene.expression)).size;
  if (plan.format === '3:4' && uniqueExpressions < 5) {
    throw new Error('A six-slide Creddy post requires at least five script-appropriate expressions');
  }
  if (plan.scenes.some((scene, index) => index > 0 && scene.expression === plan.scenes[index - 1]!.expression)) {
    throw new Error('Adjacent Creddy slideshow scenes cannot repeat the same expression');
  }
  if (plan.format !== '3:4' && plan.scenes.length >= 3 && uniqueExpressions < 2) {
    throw new Error('Creddy visual plans with 3 or more scenes require at least two script-appropriate expressions');
  }
  if (!plan.visualBrief.trim()) throw new Error('Visual brief is required');
  if (!Array.isArray(plan.safetyOverlays)) throw new Error('safetyOverlays must be an array');
  if (!Array.isArray(plan.sourceUrls) || plan.sourceUrls.length === 0) throw new Error('Visual plan requires sources');
  if (!Array.isArray(plan.factualClaims)) throw new Error('Visual plan requires factual claims');
  return plan;
}

export async function listPendingVisualTasks(root: string): Promise<VisualPlanningTaskRecord[]> {
  const pending: VisualPlanningTaskRecord[] = [];
  for (const task of await visualTasks(root)) {
    const output = safeDataPath(root, '06-visual-plans', `visual-${task.draft.id}.json`);
    if (!(await pathExists(output))) pending.push(task);
  }
  return pending;
}

export async function acceptVisualPlan(root: string, input: VisualPlanRecord): Promise<void> {
  const plan = validateVisualPlan(input);
  const task = (await visualTasks(root)).find((item) => item.draft.id === plan.contentDraftId);
  if (!task) throw new Error(`Content draft not found: ${plan.contentDraftId}`);
  if (plan.id !== `visual-${plan.contentDraftId}`) throw new Error('Visual-plan stable ID mismatch');
  if (plan.analysisId !== task.draft.analysisId || plan.canonicalId !== task.draft.canonicalId) {
    throw new Error('Visual-plan identity mismatch');
  }
  if (plan.cover.headline !== task.draft.hook) {
    throw new Error('Visual plan must preserve the selected Agent 4 hook exactly');
  }
  if (plan.scenes.length !== task.draft.textScenes.length) {
    throw new Error('Visual plan must contain exactly one scene per Agent 4 text scene');
  }
  if (plan.scenes.some((scene, index) => scene.text !== task.draft.textScenes[index])) {
    throw new Error('Visual plan cannot change Agent 4 scene copy');
  }
  if (JSON.stringify(plan.sourceUrls) !== JSON.stringify(task.draft.sourceUrls)) {
    throw new Error('Visual plan must preserve Agent 4 source URLs exactly');
  }
  if (JSON.stringify(plan.factualClaims) !== JSON.stringify(task.draft.factualClaims)) {
    throw new Error('Visual plan must preserve accepted factual claims exactly');
  }
  if (task.draft.copyVersion === 'creddy-copy-v3') {
    if (!task.draft.article || !plan.articleVisuals) {
      throw new Error('Agent 05 must plan article and social visuals in the same visual record');
    }
    validateCreddyArticleVisuals(plan.articleVisuals, task.draft.article, task.draft.factualClaims);
    const articleVisualIds = new Set(
      task.draft.article.blocks.filter((block) => block.type === 'visual').map((block) => block.visualId),
    );
    if ([...articleVisualIds].some((id) => !plan.articleVisuals!.assets.some((asset) => asset.id === id))) {
      throw new Error('Agent 05 article plan is missing a visual requested by Agent 04');
    }
  }
  if (plan.format === '3:4' && plan.phoneTemplateId !== phoneTemplateForDraft(task.draft)) {
    throw new Error('Visual plan phone template must match the approved Agent 4 CTA');
  }
  await writeJsonAtomic(safeDataPath(root, '06-visual-plans', `${plan.id}.json`), plan);
}
