import {
  listJsonFiles,
  pathExists,
  readJson,
  safeDataPath,
  writeJsonAtomic,
} from './pipeline-store.js';
import {
  CREDDY_PIPELINE_VERSION,
  type ContentDraftRecord,
  type CreddyCharacterExpression,
  type CreddyVisualTheme,
  type VisualPlanRecord,
  type VisualPlanningTaskRecord,
} from './pipeline-types.js';

export const CREDDY_MANIFEST_EXPRESSIONS = new Set<CreddyCharacterExpression>([
  'neutral', 'waving', 'thinking', 'confused', 'celebrate', 'guide', 'surprised',
  'sleepy', 'wink', 'thumbs-up', 'sad', 'worried', 'card', 'rewards', 'curious',
  'skeptical', 'idea', 'pointing', 'happy', 'urgent',
]);

export const CREDDY_VIDEO_THEMES = new Set<CreddyVisualTheme>([
  'editorial', 'midnight', 'ledger', 'poster', 'aurora',
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
    files.filter((path) => !/\/(scripts|captions|briefs)\//.test(path)),
  );
}

async function visualTasks(root: string): Promise<VisualPlanningTaskRecord[]> {
  return Promise.all((await contentDraftFiles(root)).map(async (path) => ({
    draft: await readJson<ContentDraftRecord>(path),
  })));
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
    if (!['template', 'generated_illustration'].includes(scene.background?.mode)) {
      throw new Error('Unsupported scene background mode');
    }
    if (scene.background.mode === 'generated_illustration' && !scene.background.prompt?.trim()) {
      throw new Error('Generated illustration scenes require a prompt');
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
  await writeJsonAtomic(safeDataPath(root, '06-visual-plans', `${plan.id}.json`), plan);
}
