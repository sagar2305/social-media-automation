import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { stat } from 'node:fs/promises';

import {
  listJsonFiles,
  pathExists,
  readJson,
  safeDataPath,
  writeJsonAtomic,
} from './pipeline-store.js';
import { CREDDY_PIPELINE_VERSION } from './pipeline-types.js';
import type { ContentBankRecord, ContentDraftRecord, VisualPlanRecord } from './pipeline-types.js';
import { validateIndependentSlideshowCopy } from './copy-stage.js';
import { notifyCreddyContentReady } from './slack-notifications.js';
import type { CreddyContentReadySlackEvent, CreddyContentReadySlackResult } from './slack-notifications.js';

type SlideshowManifest = {
  version: 1;
  visualPlanId: string;
  canvas: { width: number; height: number; aspectRatio: string };
  fonts: {
    headline: { name: string; file: string };
    support: { name: string; file: string };
  };
  generationMode: string;
  imageGenerationCreditsUsed: number;
  slides: Array<{
    number: number;
    file: string;
    sourceText?: string;
    expression?: string;
    template?: string;
    templateFamily?: string;
    phoneTemplateId?: string | null;
    headlineLayout?: TextLayout;
    supportCopy?: string;
    supportLayout?: TextLayout | null;
    roleTreatment?: 'hook' | 'standard' | 'caution' | 'cta';
  }>;
};

type Box = [number, number, number, number];
type TextLayout = {
  lines: string[];
  fontSize: number;
  boxes: Box[];
  lineGap: number;
  treatment?: 'hook' | 'standard' | 'caution' | 'cta';
  emphasis?: string[];
  highlightedTokens?: string[];
};

const LOCKED_HEADLINE_FONT = {
  name: 'Tungsten Condensed Bold',
  file: 'assets/creddy/slideshow-templates/fonts/tungsten-condensed-bold.ttf',
};
const LOCKED_SUPPORT_FONT = {
  name: 'DIN Condensed Bold',
  file: 'assets/creddy/slideshow-templates/fonts/DIN-Condensed-Bold.ttf',
};
const APPROVED_EXPRESSION_TEMPLATES: Record<string, string> = {
  neutral: '01-neutral-friendly.png', waving: '02-waving-hello.png', thinking: '03-thinking.png',
  confused: '04-confused.png', celebrate: '05-celebrating.png', guide: '06-presenting.png',
  surprised: '07-surprised.png', sleepy: '08-sleepy.png', wink: '09-confident-wink.png',
  'thumbs-up': '10-thumbs-up.png', sad: '11-sad.png', worried: '12-worried.png',
  card: '13-card-approval.png', rewards: '14-rewards-excited.png', curious: '15-listening-curious.png',
  skeptical: '16-skeptical.png', idea: '17-aha-idea.png', pointing: '18-pointing-left.png',
  happy: '19-happy-laughing.png', urgent: '20-urgent-stop.png',
};
const APPROVED_PHONE_TEMPLATES: Record<string, string> = {
  wallet_vouchers: 'creddy-phone-wallet-vouchers-1080x1440.png',
  spend_goals: 'creddy-phone-spend-goals-1080x1440.png',
  app_store_dark: 'creddy-phone-app-store-dark-1080x1440.png',
  app_store_light: 'creddy-phone-app-store-light-1080x1440.png',
};

export type SlideshowBankResult = {
  eligible: number;
  created: number;
  updated: number;
  skipped: number;
  failures: string[];
  slackNotificationsSent: number;
  slackNotificationsSkipped: number;
  slackNotificationFailures: string[];
};

export type ContentReadyNotifier = (
  event: CreddyContentReadySlackEvent,
) => Promise<CreddyContentReadySlackResult>;

function validateId(id: string, label: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(id)) throw new Error(`Invalid ${label}`);
  return id;
}

function boxesOverlap(left: Box, right: Box): boolean {
  return !(left[2] <= right[0] || right[2] <= left[0] || left[3] <= right[1] || right[3] <= left[1]);
}

function validateTextLayout(layout: TextLayout | undefined, label: string, minimumGap: number): void {
  if (!layout || !Array.isArray(layout.lines) || !layout.lines.length || layout.fontSize <= 0) {
    throw new Error(`${label} layout is missing`);
  }
  if (!Number.isFinite(layout.lineGap) || layout.lineGap < minimumGap) {
    throw new Error(`${label} line spacing is unsafe`);
  }
  if (layout.lines.length !== layout.boxes.length) throw new Error(`${label} line boxes are incomplete`);
  for (let index = 1; index < layout.boxes.length; index += 1) {
    if (boxesOverlap(layout.boxes[index - 1]!, layout.boxes[index]!)) {
      throw new Error(`${label} lines overlap`);
    }
  }
}

async function validateSlides(
  manifestPath: string,
  manifest: SlideshowManifest,
  plan: VisualPlanRecord,
): Promise<string[]> {
  if (manifest.canvas.width !== 1080 || manifest.canvas.height !== 1440 || manifest.canvas.aspectRatio !== '3:4') {
    throw new Error('canvas must be exactly 1080x1440 (3:4)');
  }
  if (plan.format !== '3:4' || plan.characterPack !== 'credit-card-rewards/creddy') {
    throw new Error('visual plan is not the locked Creddy slideshow format');
  }
  if (manifest.generationMode !== 'deterministic-template-composition' || manifest.imageGenerationCreditsUsed !== 0) {
    throw new Error('slideshow must use the locked zero-credit deterministic templates');
  }
  if (manifest.fonts?.headline?.name !== LOCKED_HEADLINE_FONT.name ||
      manifest.fonts?.headline?.file !== LOCKED_HEADLINE_FONT.file ||
      manifest.fonts?.support?.name !== LOCKED_SUPPORT_FONT.name ||
      manifest.fonts?.support?.file !== LOCKED_SUPPORT_FONT.file) {
    throw new Error('slideshow used an unapproved font or font file');
  }
  if (manifest.slides.length !== 6) throw new Error(`expected 6 slides, found ${manifest.slides.length}`);
  if (plan.scenes.length !== 6) throw new Error('visual plan must contain exactly 6 scenes');
  const renderDirectory = dirname(manifestPath);
  const paths: string[] = [];
  const visibleExpressions: string[] = [];
  const currentRenderer = manifest.slides.every((slide) => Boolean(slide.roleTreatment));
  const treatments = new Set<string>();
  for (let index = 0; index < 6; index += 1) {
    const slide = manifest.slides[index];
    if (slide.number !== index + 1) throw new Error(`slide ${index + 1} has an invalid sequence number`);
    if (slide.sourceText !== plan.scenes[index]?.text || slide.expression !== plan.scenes[index]?.expression) {
      throw new Error(`slide ${index + 1} does not match its approved visual plan`);
    }
    validateTextLayout(slide.headlineLayout, `slide ${index + 1} headline`, 12);
    if (currentRenderer) {
      const role = plan.scenes[index]!.role;
      const expectedTreatment = role === 'hook' || role === 'caution' || role === 'cta' ? role : 'standard';
      if (slide.roleTreatment !== expectedTreatment || slide.headlineLayout?.treatment !== expectedTreatment) {
        throw new Error(`slide ${index + 1} did not use its approved role treatment`);
      }
      const minimumFont = expectedTreatment === 'hook' ? 96 : expectedTreatment === 'cta' ? 86 : 84;
      const maximumLines = expectedTreatment === 'hook' ? 4 : 5;
      if (slide.headlineLayout!.fontSize < minimumFont || slide.headlineLayout!.lines.length > maximumLines) {
        throw new Error(`slide ${index + 1} failed the mobile-legibility type gate`);
      }
      if (expectedTreatment === 'cta' && slide.headlineLayout!.boxes.some((box) => box[2] > 495)) {
        throw new Error('slide 6 CTA copy intrudes into the real-app phone proof safe zone');
      }
      if (JSON.stringify(slide.headlineLayout?.emphasis ?? []) !== JSON.stringify(plan.scenes[index]!.emphasis) ||
          (plan.scenes[index]!.emphasis.length > 0 && !slide.headlineLayout?.highlightedTokens?.length)) {
        throw new Error(`slide ${index + 1} did not render its approved semantic emphasis`);
      }
      treatments.add(expectedTreatment);
    }
    if (index < 5) {
      const expectedFile = APPROVED_EXPRESSION_TEMPLATES[slide.expression ?? ''];
      if (!expectedFile || slide.templateFamily !== 'expression' ||
          slide.template !== `assets/creddy/slideshow-expressions-1080x1440/${expectedFile}`) {
        throw new Error(`slide ${index + 1} did not use its approved Creddy expression asset`);
      }
      if (currentRenderer) {
        if (Boolean(slide.supportCopy?.trim()) !== Boolean(slide.supportLayout)) {
          throw new Error(`slide ${index + 1} support copy and compact treatment disagree`);
        }
        if (slide.supportLayout) validateTextLayout(slide.supportLayout, `slide ${index + 1} support card`, 5);
      } else {
        validateTextLayout(slide.supportLayout ?? undefined, `slide ${index + 1} support card`, 8);
        if (!slide.supportCopy?.trim()) throw new Error(`slide ${index + 1} support copy is missing`);
      }
      visibleExpressions.push(slide.expression!);
    } else {
      const expectedPhoneFile = APPROVED_PHONE_TEMPLATES[slide.phoneTemplateId ?? ''];
      if (!expectedPhoneFile || slide.templateFamily !== 'phone-screen' ||
          slide.template !== `assets/creddy/slideshow-templates/phone-screens/${expectedPhoneFile}`) {
        throw new Error('slide 6 must use one approved real-app phone-screen template');
      }
      // Legacy accepted plans predate explicit phone-template selection. Agent 5
      // now requires it for new plans while preserving the approved backlog.
      if (plan.phoneTemplateId && slide.phoneTemplateId !== plan.phoneTemplateId) {
        throw new Error('slide 6 phone screen must match the approved Agent 5 visual plan');
      }
      if (slide.supportCopy || slide.supportLayout != null) {
        throw new Error('slide 6 product proof must not be covered by a support-card overlay');
      }
    }
    const path = resolve(renderDirectory, slide.file);
    const rel = relative(renderDirectory, path);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`slide ${index + 1} escaped its render folder`);
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`slide ${index + 1} is not a file`);
    paths.push(path);
  }
  if (new Set(visibleExpressions).size !== 5) {
    throw new Error('slides 1-5 must use five distinct Creddy expressions');
  }
  if (visibleExpressions.some((expression, index) => index > 0 && expression === visibleExpressions[index - 1])) {
    throw new Error('adjacent Creddy slides cannot repeat an expression');
  }
  if (currentRenderer && !['hook', 'standard', 'cta'].every((treatment) => treatments.has(treatment))) {
    throw new Error('slideshow lacks the required hook, standard, and CTA visual rhythm');
  }
  return paths;
}

export async function runSlideshowContentBankHandoff(
  root: string,
  now = new Date(),
  notifier: ContentReadyNotifier = notifyCreddyContentReady,
): Promise<SlideshowBankResult> {
  const manifests = (await listJsonFiles(safeDataPath(root, '07-slideshow-renders')))
    .filter((path) => path.endsWith('/manifest.json'));
  const result: SlideshowBankResult = {
    eligible: manifests.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failures: [],
    slackNotificationsSent: 0,
    slackNotificationsSkipped: 0,
    slackNotificationFailures: [],
  };

  for (const manifestPath of manifests) {
    try {
      const manifest = await readJson<SlideshowManifest>(manifestPath);
      const visualPlanId = validateId(manifest.visualPlanId, 'visual plan id');
      const plan = await readJson<VisualPlanRecord>(safeDataPath(root, '06-visual-plans', `${visualPlanId}.json`));
      const contentDraftId = validateId(plan.contentDraftId, 'content draft id');
      const draft = await readJson<ContentDraftRecord>(safeDataPath(root, '06-content-drafts', `${contentDraftId}.json`));
      validateIndependentSlideshowCopy(draft);
      const slideImagePaths = await validateSlides(manifestPath, manifest, plan);
      const id = validateId(`slideshow-${visualPlanId}`, 'Content Bank id');
      const destination = safeDataPath(root, '09-pending-approval', `${id}.json`);
      const existing = (await pathExists(destination))
        ? await readJson<ContentBankRecord>(destination)
        : undefined;
      if (existing && !['pending_review', 'changes_requested', 'rendering_revision'].includes(existing.status)) {
        result.skipped += 1;
        continue;
      }
      const record: ContentBankRecord = {
        ...existing,
        version: CREDDY_PIPELINE_VERSION,
        id,
        contentPackageId: contentDraftId,
        mediaType: 'slideshow',
        contentDraftId,
        visualPlanId,
        slideshowManifestPath: manifestPath,
        slideImagePaths,
        slideCount: 6,
        createdAt: existing?.createdAt ?? now.toISOString(),
        status: 'pending_review',
        revision: existing?.revision ?? 1,
        changeRequest: undefined,
        approvedBy: undefined,
        approvedAt: undefined,
        destinations: undefined,
        rejectedBy: undefined,
        rejectedAt: undefined,
        rejectionReason: undefined,
      };
      await writeJsonAtomic(destination, record);
      if (existing) result.updated += 1;
      else result.created += 1;

      const receiptPath = safeDataPath(root, 'reports', 'slack-content-ready', `${id}-revision-${record.revision}.json`);
      if (await pathExists(receiptPath)) {
        result.slackNotificationsSkipped += 1;
      } else {
        const priorReceipts = (await listJsonFiles(safeDataPath(root, 'reports', 'slack-content-ready')))
          .filter((path) => path.includes(`/${id}-revision-`));
        if (existing && priorReceipts.length === 0) {
          // Slack review notifications were added after the first Content Bank
          // backlog already existed. Baseline those revisions instead of
          // flooding the channel; a later revision has a new receipt key and
          // will notify normally.
          await writeJsonAtomic(receiptPath, {
            version: 1,
            id,
            revision: record.revision,
            skippedAt: now.toISOString(),
            sent: false,
            reason: 'preexisting-before-slack-review-notifications',
          });
          result.slackNotificationsSkipped += 1;
          continue;
        }
        const notification = await notifier({
          id,
          hook: draft.hook,
          instagramCaption: draft.instagramCaption,
          tiktokCaption: draft.tiktokCaption,
          hashtags: draft.hashtags,
          slideImagePaths,
        });
        if (notification.sent) {
          await writeJsonAtomic(receiptPath, {
            version: 1,
            id,
            revision: record.revision,
            sentAt: now.toISOString(),
            channel: notification.channel,
            messageTs: notification.messageTs,
            fileIds: notification.fileIds ?? [],
          });
          result.slackNotificationsSent += 1;
        } else if (notification.error?.includes('is missing')) {
          result.slackNotificationsSkipped += 1;
        } else {
          result.slackNotificationFailures.push(`${id}: ${notification.error ?? 'Slack notification failed'}`);
        }
      }
    } catch (error) {
      result.failures.push(`${manifestPath}: ${(error as Error).message}`);
    }
  }

  await writeJsonAtomic(safeDataPath(root, 'reports', 'latest', '07-slideshow-content-bank.json'), {
    version: 1,
    generatedAt: now.toISOString(),
    ...result,
    status: result.failures.length === 0 ? 'completed' : 'partially_completed',
    policy: 'Human review only; no approval, scheduling, or publishing was performed.',
  });
  return result;
}
