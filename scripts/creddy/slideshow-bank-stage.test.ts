import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { initializeCreddyDataRoot, readJson, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import { CREDDY_PIPELINE_VERSION, type ContentBankRecord, type ContentDraftRecord, type VisualPlanRecord } from './pipeline-types.js';
import { runSlideshowContentBankHandoff } from './slideshow-bank-stage.js';

const expressions = ['neutral', 'waving', 'thinking', 'confused', 'celebrate', 'pointing'] as const;
const files = ['01-neutral-friendly.png', '02-waving-hello.png', '03-thinking.png', '04-confused.png', '05-celebrating.png'];

async function fixture(): Promise<{ root: string; manifest: Record<string, unknown> }> {
  const root = await mkdtemp(join(tmpdir(), 'creddy-slideshow-bank-'));
  await initializeCreddyDataRoot(root);
  const draft: ContentDraftRecord = {
    version: CREDDY_PIPELINE_VERSION, id: 'draft-1', analysisId: 'analysis-1', canonicalId: 'canonical-1',
    createdAt: new Date().toISOString(), audience: 'US', slot: 'understand', hook: 'Hook',
    textScenes: expressions.map((_, index) => `Scene ${index + 1}`), narrationScript: 'Narration',
    instagramCaption: 'Caption', tiktokCaption: 'Caption', hashtags: ['#Creddy'],
    cta: { label: 'Open Creddy', deepLink: 'creddy://home' }, brief: 'Brief', sourceUrls: ['https://example.com'], factualClaims: [],
  };
  const plan: VisualPlanRecord = {
    version: CREDDY_PIPELINE_VERSION, id: 'plan-1', contentDraftId: draft.id, analysisId: draft.analysisId,
    canonicalId: draft.canonicalId, createdAt: new Date().toISOString(), format: '3:4', theme: 'midnight',
    characterPack: 'credit-card-rewards/creddy', phoneTemplateId: 'app_store_dark', cover: { headline: 'Hook', subheadline: 'Support' },
    scenes: expressions.map((expression, sceneIndex) => ({ sceneIndex, text: `Scene ${sceneIndex + 1}`, role: sceneIndex === 5 ? 'cta' : 'fact', expression, emphasis: [], background: { mode: 'template' } })),
    visualBrief: 'Brief', safetyOverlays: ['Verify'], sourceUrls: draft.sourceUrls, factualClaims: [],
  };
  await writeJsonAtomic(safeDataPath(root, '06-content-drafts', 'draft-1.json'), draft);
  await writeJsonAtomic(safeDataPath(root, '06-visual-plans', 'plan-1.json'), plan);
  const directory = safeDataPath(root, '07-slideshow-renders', 'plan-1');
  await mkdir(directory, { recursive: true });
  for (let index = 1; index <= 6; index += 1) await writeFile(join(directory, `slide-${String(index).padStart(2, '0')}.png`), 'png');
  const layout = { lines: ['Text'], fontSize: 80, boxes: [[10, 10, 100, 80]], lineGap: 12 };
  const support = { lines: ['Support'], fontSize: 32, boxes: [[10, 100, 100, 140]], lineGap: 8 };
  const manifest = {
    version: 1, visualPlanId: 'plan-1', canvas: { width: 1080, height: 1440, aspectRatio: '3:4' },
    fonts: {
      headline: { name: 'Tungsten Condensed Bold', file: 'assets/creddy/slideshow-templates/fonts/tungsten-condensed-bold.ttf' },
      support: { name: 'DIN Condensed Bold', file: 'assets/creddy/slideshow-templates/fonts/DIN-Condensed-Bold.ttf' },
    },
    generationMode: 'deterministic-template-composition', imageGenerationCreditsUsed: 0,
    slides: expressions.map((expression, index) => ({
      number: index + 1, file: `slide-${String(index + 1).padStart(2, '0')}.png`, sourceText: `Scene ${index + 1}`,
      expression, templateFamily: index === 5 ? 'phone-screen' : 'expression',
      template: index === 5 ? 'assets/creddy/slideshow-templates/phone-screens/creddy-phone-app-store-dark-1080x1440.png' : `assets/creddy/slideshow-expressions-1080x1440/${files[index]}`,
      phoneTemplateId: index === 5 ? 'app_store_dark' : null, headlineLayout: layout,
      supportCopy: index === 5 ? '' : 'Support', supportLayout: index === 5 ? null : support,
    })),
  };
  await writeJsonAtomic(join(directory, 'manifest.json'), manifest);
  return { root, manifest };
}

test('Agent 7 accepts only a varied six-slide locked-template slideshow', async () => {
  const { root } = await fixture();
  let notifications = 0;
  const notifier = async () => {
    notifications += 1;
    return { sent: true as const, channel: 'C123', messageTs: '123.456', fileIds: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'] };
  };
  const result = await runSlideshowContentBankHandoff(root, new Date(), notifier);
  assert.equal(result.created, 1);
  assert.equal(result.slackNotificationsSent, 1);
  assert.equal(notifications, 1);
  assert.deepEqual(result.failures, []);

  const rerun = await runSlideshowContentBankHandoff(root, new Date(), notifier);
  assert.equal(rerun.slackNotificationsSkipped, 1);
  assert.equal(notifications, 1, 'a persisted receipt prevents duplicate Slack messages');
});

test('Agent 7 accepts the role-driven renderer with semantic emphasis and optional compact support', async () => {
  const { root, manifest } = await fixture();
  const planPath = safeDataPath(root, '06-visual-plans', 'plan-1.json');
  const plan = await readJson<VisualPlanRecord>(planPath);
  const slides = manifest.slides as Array<Record<string, unknown>>;
  const treatments = ['hook', 'standard', 'standard', 'standard', 'caution', 'cta'] as const;
  plan.scenes.forEach((scene, index) => {
    scene.role = index === 0 ? 'hook' : index === 4 ? 'caution' : index === 5 ? 'cta' : 'context';
    scene.emphasis = [`Scene ${index + 1}`];
    scene.background.style = index === 4 ? 'burgundy' : index > 0 && index < 4 ? 'deep_navy' : 'spotlight';
    slides[index]!.roleTreatment = treatments[index];
    slides[index]!.headlineLayout = {
      ...(slides[index]!.headlineLayout as Record<string, unknown>),
      treatment: treatments[index],
      emphasis: scene.emphasis,
      highlightedTokens: ['Scene', String(index + 1)],
      fontSize: index === 0 ? 100 : 90,
    };
    if (index < 5) {
      slides[index]!.supportCopy = '';
      slides[index]!.supportLayout = null;
    }
  });
  await writeJsonAtomic(planPath, plan);
  await writeJsonAtomic(safeDataPath(root, '07-slideshow-renders', 'plan-1', 'manifest.json'), manifest);
  const result = await runSlideshowContentBankHandoff(root, new Date(), async () => ({
    sent: true as const, channel: 'C123', messageTs: '123.456', fileIds: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'],
  }));
  assert.deepEqual(result.failures, []);
  assert.equal(result.created, 1);

  const unsafeLayout = slides[5]!.headlineLayout as { boxes: number[][] };
  unsafeLayout.boxes = [[52, 142, 520, 220]];
  await writeJsonAtomic(safeDataPath(root, '07-slideshow-renders', 'plan-1', 'manifest.json'), manifest);
  const unsafe = await runSlideshowContentBankHandoff(root);
  assert.match(unsafe.failures[0]!, /phone proof safe zone/);
});

test('Agent 7 baselines legacy review items without flooding Slack, then notifies a new revision', async () => {
  const { root } = await fixture();
  const renderDirectory = safeDataPath(root, '07-slideshow-renders', 'plan-1');
  const bankPath = safeDataPath(root, '09-pending-approval', 'slideshow-plan-1.json');
  const legacy: ContentBankRecord = {
    version: CREDDY_PIPELINE_VERSION,
    id: 'slideshow-plan-1',
    contentPackageId: 'draft-1',
    mediaType: 'slideshow',
    contentDraftId: 'draft-1',
    visualPlanId: 'plan-1',
    slideshowManifestPath: join(renderDirectory, 'manifest.json'),
    slideImagePaths: Array.from({ length: 6 }, (_, index) => join(renderDirectory, `slide-${String(index + 1).padStart(2, '0')}.png`)),
    slideCount: 6,
    createdAt: new Date().toISOString(),
    status: 'pending_review',
    revision: 1,
  };
  await writeJsonAtomic(bankPath, legacy);
  let notifications = 0;
  const notifier = async () => {
    notifications += 1;
    return { sent: true as const, channel: 'C123', messageTs: '123.456', fileIds: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'] };
  };

  const baseline = await runSlideshowContentBankHandoff(root, new Date(), notifier);
  assert.equal(baseline.slackNotificationsSkipped, 1);
  assert.equal(notifications, 0, 'existing backlog must not be sent to Slack all at once');

  legacy.revision = 2;
  await writeJsonAtomic(bankPath, legacy);
  const revised = await runSlideshowContentBankHandoff(root, new Date(), notifier);
  assert.equal(revised.slackNotificationsSent, 1);
  assert.equal(notifications, 1, 'a later revision still gets a Slack review message');
});

test('Agent 7 rejects repeated expressions before the portal', async () => {
  const { root, manifest } = await fixture();
  const slides = manifest.slides as Array<Record<string, unknown>>;
  slides[1]!.expression = slides[0]!.expression;
  slides[1]!.template = slides[0]!.template;
  await writeJsonAtomic(safeDataPath(root, '07-slideshow-renders', 'plan-1', 'manifest.json'), manifest);
  const result = await runSlideshowContentBankHandoff(root);
  assert.equal(result.created, 0);
  assert.match(result.failures[0]!, /does not match|five distinct|repeat/);
});

test('Agent 7 rejects article-summary copy before the portal', async () => {
  const { root } = await fixture();
  const draftPath = safeDataPath(root, '06-content-drafts', 'draft-1.json');
  const draft = await readJson<ContentDraftRecord>(draftPath);
  draft.textScenes[1] = 'This article covers several rewards programs.';
  await writeJsonAtomic(draftPath, draft);

  const result = await runSlideshowContentBankHandoff(root);
  assert.equal(result.created, 0);
  assert.match(result.failures[0]!, /must teach the audience directly/);
});

test('Agent 7 rejects a missing phone proof or changed fonts before the portal', async () => {
  const missingPhone = await fixture();
  const slides = missingPhone.manifest.slides as Array<Record<string, unknown>>;
  slides[5]!.templateFamily = 'expression';
  await writeJsonAtomic(safeDataPath(missingPhone.root, '07-slideshow-renders', 'plan-1', 'manifest.json'), missingPhone.manifest);
  const phoneResult = await runSlideshowContentBankHandoff(missingPhone.root);
  assert.match(phoneResult.failures[0]!, /phone-screen/);

  const wrongFont = await fixture();
  (wrongFont.manifest.fonts as { headline: { name: string } }).headline.name = 'Wrong Font';
  await writeJsonAtomic(safeDataPath(wrongFont.root, '07-slideshow-renders', 'plan-1', 'manifest.json'), wrongFont.manifest);
  const fontResult = await runSlideshowContentBankHandoff(wrongFont.root);
  assert.match(fontResult.failures[0]!, /unapproved font/);
});
