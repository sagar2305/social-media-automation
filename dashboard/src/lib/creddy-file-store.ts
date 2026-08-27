import "server-only";

import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

import {
  CREDDY_BACKGROUND_STYLES,
  CREDDY_EXPRESSIONS,
  CREDDY_LEGACY_EXPRESSION_ALIASES,
  CREDDY_PHONE_TEMPLATES,
  type CreddySlideEditor,
} from "@/lib/creddy-slide-options";
import { isSpecificPublicPostUrl } from "@/lib/creddy-publication";

export {
  CREDDY_BACKGROUND_STYLES,
  CREDDY_EXPRESSIONS,
  CREDDY_PHONE_TEMPLATES,
  type CreddySlideEditor,
  type CreddySlideEditorScene,
} from "@/lib/creddy-slide-options";

const execFile = promisify(execFileCallback);

const DEFAULT_DATA_ROOT = "/Users/mohitkourav/Documents/ChatGPT/Social media automation data";
type Format = "text_music" | "narrated";
type Platform = "instagram" | "tiktok";

export type CreddyDeliveryMode = "tiktok_draft" | "schedule" | "publish_now";
export type CreddyDestinationStatus =
  | "pending"
  | "submitted"
  | "draft_sent"
  | "blotato_draft"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed";

export type CreddyDestination = {
  format: Format;
  platform: Platform;
  account: string;
  scheduledFor: string;
  mode?: CreddyDeliveryMode;
  status: CreddyDestinationStatus;
  submissionId?: string;
  publishedUrl?: string;
  error?: string;
  submittedAt?: string;
  publishedAt?: string;
  lastCheckedAt?: string;
  remoteListId?: string;
  remoteState?: string;
  remotePresence?: "present" | "absent" | "unknown";
  remoteMissingSince?: string;
};

type ReviewDraft = {
  savedBy: string;
  savedAt: string;
  platforms: Platform[];
  accountIds: Partial<Record<Platform, string>>;
  scheduledFor?: string;
};

type ContentBankFile = {
  version: 1;
  id: string;
  contentPackageId: string;
  mediaType?: "video" | "slideshow";
  contentDraftId?: string;
  visualPlanId?: string;
  slideshowManifestPath?: string;
  slideImagePaths?: string[];
  slideCount?: number;
  articlePreviewPath?: string;
  articleReview?: {
    status: "needs_assets" | "pending_review" | "changes_requested" | "approved" | "publishing" | "published" | "publish_failed" | "unpublished";
    approvedBy?: string;
    approvedAt?: string;
    approvedContentSha256?: string;
    publishingStartedAt?: string;
    publishAttemptedAt?: string;
    publishAttempts?: number;
    publishError?: string;
    cmsIdentifier?: string;
    publishedAt?: string;
    publishedUrl?: string;
    unpublishedBy?: string;
    unpublishedAt?: string;
    requestedBy?: string;
    requestedAt?: string;
    changeNotes?: string;
    blockers?: string[];
  };
  createdAt: string;
  updatedAt?: string;
  status: "pending_review" | "changes_requested" | "rendering_revision" | "approved" | "scheduled" | "published" | "rejected";
  textMusicVideoPath?: string;
  narratedVideoPath?: string;
  revision: number;
  approvedBy?: string;
  approvedAt?: string;
  destinations?: CreddyDestination[];
  changeRequest?: { requestedBy: string; requestedAt: string; notes: string };
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  statusBeforeRejection?: Exclude<ContentBankFile["status"], "rejected">;
  destinationsBeforeRejection?: CreddyDestination[];
  restoredBy?: string;
  restoredAt?: string;
  scheduleHistory?: Array<{ changedBy: string; changedAt: string; destinationKey: string; from: string; to: string }>;
  reviewDraft?: ReviewDraft;
  blotatoMediaUrls?: string[];
};

type ArticleFile = {
  id: string;
  slug: string;
  category: string;
  title: string;
  dek: string;
  excerpt: string;
  readingMinutes: number;
  blocks: unknown[];
  referralDisclosure: string;
};

type ContentPackageFile = {
  id: string;
  hook: string;
  scriptLines: string[];
  caption: string;
  platformCaptions?: { instagram: string; tiktok: string };
  hashtags: string[];
  cta?: { label: string; deepLink: string; fallbackUrl?: string };
  brief: string;
  sourceUrls: string[];
  article?: ArticleFile;
  articleVisuals?: { assets?: Array<{ id: string; assetPath?: string; aspectRatio?: string; altText?: string; caption?: string }> };
  factualClaims?: Array<{
    field: string;
    value: string | number | boolean | null;
    sourceRecordIds: string[];
    confidence: number;
    conflict?: string;
  }>;
};

type ContentDraftFile = {
  id: string;
  hook: string;
  textScenes: string[];
  instagramCaption: string;
  tiktokCaption: string;
  hashtags: string[];
  cta?: ContentPackageFile["cta"];
  brief: string;
  sourceUrls: string[];
  article?: ArticleFile;
  factualClaims?: ContentPackageFile["factualClaims"];
};

type VisualPlanFile = {
  version: number;
  id: string;
  contentDraftId: string;
  format: string;
  characterPack: string;
  phoneTemplateId?: string;
  cover?: { headline?: string; subheadline?: string };
  scenes: Array<{
    sceneIndex: number;
    text: string;
    supportText?: string;
    role?: string;
    expression: string;
    emphasis?: string[];
    background?: { mode?: string; style?: string };
  }>;
  safetyOverlays?: string[];
  articleVisuals?: { assets?: Array<{ id: string; assetPath?: string; aspectRatio?: string; altText?: string; caption?: string }> };
  [key: string]: unknown;
};

export type CreddyBankItemDto = {
  id: string;
  createdAt: string;
  status: ContentBankFile["status"];
  revision: number;
  mediaType: "video" | "slideshow";
  slideCount: number;
  hasSlideshow: boolean;
  hook: string;
  scriptLines: string[];
  caption: string;
  instagramCaption: string;
  tiktokCaption: string;
  hashtags: string[];
  cta?: ContentPackageFile["cta"];
  brief: string;
  sourceUrls: string[];
  factualClaims: NonNullable<ContentPackageFile["factualClaims"]>;
  hasTextMusicVideo: boolean;
  hasNarratedVideo: boolean;
  approvedBy?: string;
  approvedAt?: string;
  destinations: CreddyDestination[];
  reviewDraft?: ReviewDraft;
  rejectedAt?: string;
  rejectionReason?: string;
  slideEditor?: CreddySlideEditor;
  article?: ArticleFile;
  articlePreviewAvailable: boolean;
  articleImageCount: number;
  articleReview?: ContentBankFile["articleReview"];
  articlePublication?: {
    publishedAt: string;
    url: string;
    revalidation: "revalidated" | "not_configured" | "failed";
  };
  /** True when this DTO came from the deployed, read-only Supabase mirror. */
  cloudBacked?: boolean;
};

function root(): string {
  const configured = process.env.CREDDY_DATA_ROOT?.trim() || DEFAULT_DATA_ROOT;
  if (!isAbsolute(configured)) throw new Error("CREDDY_DATA_ROOT must be absolute");
  return resolve(configured, "creddy");
}

function safePath(...segments: string[]): string {
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Unsafe Creddy data path");
  }
  const base = root();
  const target = resolve(base, ...segments);
  const rel = relative(base, target);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Creddy path escaped its data root");
  return target;
}

function validateId(id: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(id)) throw new Error("Invalid content id");
  return id;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, path);
}

async function listFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => resolve(directory, entry.name))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function recordFreshness(record: ContentBankFile): number {
  const values = [
    record.updatedAt,
    record.createdAt,
    record.approvedAt,
    record.rejectedAt,
    record.restoredAt,
    ...(record.destinations ?? []).flatMap((destination) => [
      destination.lastCheckedAt,
      destination.publishedAt,
      destination.submittedAt,
    ]),
    ...(record.scheduleHistory ?? []).map((entry) => entry.changedAt),
  ];
  return Math.max(0, ...values.map((value) => value ? Date.parse(value) : 0).filter(Number.isFinite));
}

async function findBankFile(id: string): Promise<{ path: string; record: ContentBankFile }> {
  validateId(id);
  const candidates: Array<{ path: string; record: ContentBankFile }> = [];
  for (const directory of ["12-published", "11-scheduled", "10-approved", "09-pending-approval", "13-rejected-content"]) {
    const path = safePath(directory, `${id}.json`);
    try {
      candidates.push({ path, record: await readJson<ContentBankFile>(path) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  candidates.sort((left, right) => recordFreshness(right.record) - recordFreshness(left.record));
  if (candidates[0]) return candidates[0];
  throw new Error("Creddy content item not found");
}

function planSupportText(plan: VisualPlanFile, index: number): string {
  const explicit = plan.scenes[index]?.supportText?.trim();
  if (explicit) return explicit;
  if (index === 0) return plan.cover?.subheadline?.trim() || "Review the key point";
  if (index === plan.scenes.length - 1) return "";
  const overlay = plan.safetyOverlays?.find((value) => value.trim().length > 0 && value.trim().length <= 70)?.trim();
  return overlay || "Verify current details before deciding.";
}

function hasActiveExternalDelivery(record: ContentBankFile): boolean {
  return (record.destinations ?? []).some((destination) =>
    ["pending", "submitted", "draft_sent", "blotato_draft", "scheduled", "publishing"].includes(destination.status),
  );
}

async function readSlideEditor(record: ContentBankFile): Promise<CreddySlideEditor | undefined> {
  if (record.mediaType !== "slideshow" || !record.visualPlanId) return undefined;
  const plan = await readJson<VisualPlanFile>(safePath("06-visual-plans", `${validateId(record.visualPlanId)}.json`));
  const blockedReason = record.status === "published"
    ? "Published posts cannot be changed. Create a new revision instead."
    : record.status === "rejected"
      ? "Restore this post to the Review Queue before editing its slides."
      : record.status === "scheduled" || hasActiveExternalDelivery(record)
        ? "This post already has an external TikTok or Instagram delivery. Cancel it in Blotato first, then restore it to review before changing the images."
        : undefined;
  const fallbackExpression = CREDDY_EXPRESSIONS[0];
  return {
    scenes: plan.scenes.map((scene, index) => ({
      text: scene.text,
      supportText: planSupportText(plan, index),
      expression: CREDDY_EXPRESSIONS.includes(scene.expression as (typeof CREDDY_EXPRESSIONS)[number])
        ? scene.expression as (typeof CREDDY_EXPRESSIONS)[number]
        : CREDDY_LEGACY_EXPRESSION_ALIASES[scene.expression] ?? fallbackExpression,
      backgroundStyle: CREDDY_BACKGROUND_STYLES.includes(scene.background?.style as (typeof CREDDY_BACKGROUND_STYLES)[number])
        ? scene.background!.style as (typeof CREDDY_BACKGROUND_STYLES)[number]
        : "spotlight",
    })),
    phoneTemplateId: CREDDY_PHONE_TEMPLATES.includes(plan.phoneTemplateId as (typeof CREDDY_PHONE_TEMPLATES)[number])
      ? plan.phoneTemplateId as (typeof CREDDY_PHONE_TEMPLATES)[number]
      : "wallet_vouchers",
    editable: !blockedReason,
    blockedReason,
  };
}

async function toDto(record: ContentBankFile): Promise<CreddyBankItemDto> {
  const mediaType = record.mediaType === "slideshow" ? "slideshow" : "video";
  const content = mediaType === "slideshow"
    ? await readJson<ContentDraftFile>(
        safePath("06-content-drafts", `${validateId(record.contentDraftId ?? record.contentPackageId)}.json`),
      )
    : await readJson<ContentPackageFile>(
        safePath("06-content-packages", `${validateId(record.contentPackageId)}.json`),
      );
  const isDraft = "textScenes" in content;
  const caption = isDraft ? content.instagramCaption : content.caption;
  const articleImages = await articleImagePaths(record, content);
  let articlePublication: CreddyBankItemDto["articlePublication"];
  if (content.article?.slug && record.articleReview?.approvedAt) {
    try {
      const receipt = await readJson<{
        approvedAt: string;
        publishedAt: string;
        revalidation: "revalidated" | "not_configured" | "failed";
      }>(safePath("reports", "website-cms-published", `${content.article.slug}.json`));
      if (receipt.approvedAt === record.articleReview.approvedAt) {
        const baseUrl = (process.env.CREDDY_WEBSITE_BASE_URL?.trim() || "https://getcreddy.com").replace(/\/$/, "");
        articlePublication = {
          publishedAt: receipt.publishedAt,
          url: `${baseUrl}/blog/${content.article.slug}`,
          revalidation: receipt.revalidation,
        };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return {
    id: record.id,
    createdAt: record.createdAt,
    status: record.status,
    revision: record.revision,
    mediaType,
    slideCount: record.slideCount ?? 0,
    hasSlideshow: mediaType === "slideshow" && record.slideImagePaths?.length === 6,
    hook: content.hook,
    scriptLines: isDraft ? content.textScenes : content.scriptLines,
    caption,
    instagramCaption: isDraft ? content.instagramCaption : content.platformCaptions?.instagram ?? content.caption,
    tiktokCaption: isDraft ? content.tiktokCaption : content.platformCaptions?.tiktok ?? content.caption,
    hashtags: content.hashtags,
    cta: content.cta,
    brief: content.brief,
    sourceUrls: content.sourceUrls,
    factualClaims: content.factualClaims ?? [],
    hasTextMusicVideo: Boolean(record.textMusicVideoPath),
    hasNarratedVideo: Boolean(record.narratedVideoPath),
    approvedBy: record.approvedBy,
    approvedAt: record.approvedAt,
    destinations: record.destinations ?? [],
    reviewDraft: record.reviewDraft,
    rejectedAt: record.rejectedAt,
    rejectionReason: record.rejectionReason,
    slideEditor: await readSlideEditor(record),
    article: content.article,
    articlePreviewAvailable: Boolean(record.articlePreviewPath),
    articleImageCount: articleImages.length,
    articleReview: record.articleReview,
    articlePublication,
  };
}

async function articleImagePaths(
  record: ContentBankFile,
  content?: ContentDraftFile | ContentPackageFile,
): Promise<string[]> {
  let assets: Array<{ assetPath?: string; aspectRatio?: string }> | undefined;
  if (record.contentDraftId && record.visualPlanId) {
    const plan = await readJson<VisualPlanFile>(safePath("06-visual-plans", `${validateId(record.visualPlanId)}.json`));
    assets = plan.articleVisuals?.assets;
  } else {
    const source = content && "scriptLines" in content
      ? content
      : await readJson<ContentPackageFile>(safePath("06-content-packages", `${validateId(record.contentPackageId)}.json`));
    assets = source.articleVisuals?.assets;
  }
  const paths = (assets ?? []).filter((asset) => asset.aspectRatio === "16:9" && asset.assetPath).map((asset) => asset.assetPath!);
  return paths.length === 3 ? paths : [];
}

function validateEditableText(input: {
  instagramCaption: string;
  tiktokCaption: string;
  hashtags: string[];
}): { instagramCaption: string; tiktokCaption: string; hashtags: string[] } {
  const instagramCaption = input.instagramCaption.trim();
  const tiktokCaption = input.tiktokCaption.trim();
  if (!instagramCaption || instagramCaption.length > 2200) throw new Error("Instagram caption must be 1–2200 characters");
  if (!tiktokCaption || tiktokCaption.length > 2200) throw new Error("TikTok caption must be 1–2200 characters");
  const hashtags = [...new Set(input.hashtags.map((tag) => tag.trim().replace(/^#+/, "")).filter(Boolean))];
  if (hashtags.length > 30) throw new Error("Use no more than 30 hashtags");
  if (hashtags.some((tag) => !/^[\p{L}\p{N}_]+$/u.test(tag))) throw new Error("Hashtags may contain only letters, numbers, and underscores");
  return { instagramCaption, tiktokCaption, hashtags };
}

export async function saveCreddyReviewDraft(input: {
  id: string;
  savedBy: string;
  instagramCaption: string;
  tiktokCaption: string;
  hashtags: string[];
  platforms: Platform[];
  accountIds: Partial<Record<Platform, string>>;
  scheduledFor?: string;
}, now = new Date()): Promise<void> {
  const { path, record } = await findBankFile(input.id);
  if (record.mediaType !== "slideshow") throw new Error("This editor is only available for slideshows");
  if (record.status === "rejected" || record.status === "published") {
    throw new Error(`Cannot edit an item in ${record.status} state`);
  }
  const contentId = validateId(record.contentDraftId ?? record.contentPackageId);
  const contentPath = safePath("06-content-drafts", `${contentId}.json`);
  const content = await readJson<ContentDraftFile>(contentPath);
  const edited = validateEditableText(input);
  await writeJsonAtomic(contentPath, { ...content, ...edited });
  await writeJsonAtomic(path, {
    ...record,
    reviewDraft: {
      savedBy: input.savedBy,
      savedAt: now.toISOString(),
      platforms: [...new Set(input.platforms)],
      accountIds: input.accountIds,
      scheduledFor: input.scheduledFor,
    },
  });
}

export async function updateCreddySlideshowDesign(input: {
  id: string;
  editedBy: string;
  scenes: Array<{
    text: string;
    supportText: string;
    expression: string;
    backgroundStyle: string;
  }>;
  phoneTemplateId: string;
}, now = new Date()): Promise<void> {
  const { record } = await findBankFile(input.id);
  if (record.mediaType !== "slideshow" || !record.visualPlanId || !record.contentDraftId) {
    throw new Error("This item does not have an editable slideshow plan");
  }
  if (record.status === "published" || record.status === "rejected" || record.status === "scheduled" || hasActiveExternalDelivery(record)) {
    throw new Error("Cancel any external delivery and return the post to review before editing its slide images");
  }
  if (input.scenes.length !== 6) throw new Error("Exactly six slide designs are required");

  const normalizedScenes = input.scenes.map((scene, index) => {
    const text = scene.text.replace(/\s+/g, " ").trim();
    const supportText = scene.supportText.replace(/\s+/g, " ").trim();
    if (!text || text.length > 220) throw new Error(`Slide ${index + 1} text must be 1–220 characters`);
    if (index < 5 && (!supportText || supportText.length > 70)) {
      throw new Error(`Slide ${index + 1} supporting text must be 1–70 characters`);
    }
    if (!CREDDY_EXPRESSIONS.includes(scene.expression as (typeof CREDDY_EXPRESSIONS)[number])) {
      throw new Error(`Slide ${index + 1} uses an unknown Creddy expression`);
    }
    if (!CREDDY_BACKGROUND_STYLES.includes(scene.backgroundStyle as (typeof CREDDY_BACKGROUND_STYLES)[number])) {
      throw new Error(`Slide ${index + 1} uses an unknown background style`);
    }
    return { ...scene, text, supportText: index === 5 ? "" : supportText };
  });
  if (!CREDDY_PHONE_TEMPLATES.includes(input.phoneTemplateId as (typeof CREDDY_PHONE_TEMPLATES)[number])) {
    throw new Error("Choose an approved Creddy app-screen template");
  }

  const planId = validateId(record.visualPlanId);
  const draftId = validateId(record.contentDraftId);
  const planPath = safePath("06-visual-plans", `${planId}.json`);
  const draftPath = safePath("06-content-drafts", `${draftId}.json`);
  const sidecarPath = safePath("06-content-drafts", "scripts", `${draftId}.json`);
  const originalPlan = await readJson<VisualPlanFile>(planPath);
  const originalDraft = await readJson<ContentDraftFile>(draftPath);
  let originalSidecar: Record<string, unknown> | undefined;
  try {
    originalSidecar = await readJson<Record<string, unknown>>(sidecarPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const updatedPlan: VisualPlanFile = {
    ...originalPlan,
    phoneTemplateId: input.phoneTemplateId,
    cover: {
      ...originalPlan.cover,
      headline: normalizedScenes[0].text,
      subheadline: normalizedScenes[0].supportText,
    },
    scenes: originalPlan.scenes.map((scene, index) => ({
      ...scene,
      sceneIndex: index,
      text: normalizedScenes[index].text,
      supportText: normalizedScenes[index].supportText,
      expression: normalizedScenes[index].expression,
      background: { mode: "template", style: normalizedScenes[index].backgroundStyle },
    })),
    portalRevision: {
      revision: record.revision + 1,
      editedBy: input.editedBy,
      editedAt: now.toISOString(),
    },
  };

  const stageOutput = safePath("07-slideshow-renders", `.editor-${planId}-${randomUUID()}`);
  await mkdir(stageOutput, { recursive: true });
  const stagedPlanPath = resolve(stageOutput, "editor-source-plan.json");
  await writeFile(stagedPlanPath, `${JSON.stringify(updatedPlan, null, 2)}\n`, { flag: "wx" });
  const repoRoot = process.env.CREDDY_REPO_ROOT?.trim() || resolve(process.cwd(), "..");
  const renderer = resolve(repoRoot, "scripts", "creddy-render-slideshow.py");
  await access(renderer);
  try {
    await execFile(process.env.CREDDY_PYTHON_BIN?.trim() || "python3", [renderer, stagedPlanPath, stageOutput], {
      timeout: 90_000,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (error) {
    const stderr = typeof (error as { stderr?: unknown }).stderr === "string" ? (error as { stderr: string }).stderr.trim() : "";
    throw new Error(stderr ? `Slide design could not be rendered: ${stderr}` : "Slide design could not be rendered safely");
  }
  const renderedManifest = await readJson<{ slides?: unknown[] }>(resolve(stageOutput, "manifest.json"));
  if (renderedManifest.slides?.length !== 6) throw new Error("The slide renderer did not produce all six validated images");
  for (let slide = 1; slide <= 6; slide += 1) {
    const rendered = resolve(stageOutput, `slide-${String(slide).padStart(2, "0")}.png`);
    const info = await stat(rendered);
    if (!info.isFile() || info.size === 0) throw new Error(`Slide ${slide} failed render verification`);
  }

  const currentOutput = safePath("07-slideshow-renders", planId);
  const revisionOutput = safePath(
    "07-slideshow-renders",
    "revisions",
    planId,
    `revision-${record.revision}-${now.toISOString().replace(/[:.]/g, "-")}`,
  );
  await mkdir(dirname(revisionOutput), { recursive: true });
  await rename(currentOutput, revisionOutput);
  try {
    await rename(stageOutput, currentOutput);
  } catch (error) {
    await rename(revisionOutput, currentOutput);
    throw error;
  }

  const updatedDraft: ContentDraftFile = { ...originalDraft, hook: normalizedScenes[0].text, textScenes: normalizedScenes.map((scene) => scene.text) };
  const updatedRecord: ContentBankFile = {
    ...record,
    status: "pending_review",
    revision: record.revision + 1,
    approvedBy: undefined,
    approvedAt: undefined,
    destinations: [],
    blotatoMediaUrls: [],
    slideshowManifestPath: resolve(currentOutput, "manifest.json"),
    slideImagePaths: Array.from({ length: 6 }, (_, index) => resolve(currentOutput, `slide-${String(index + 1).padStart(2, "0")}.png`)),
  };

  try {
    await writeJsonAtomic(resolve(revisionOutput, "visual-plan.snapshot.json"), originalPlan);
    await writeJsonAtomic(resolve(revisionOutput, "content-draft.snapshot.json"), originalDraft);
    await writeJsonAtomic(planPath, updatedPlan);
    await writeJsonAtomic(draftPath, updatedDraft);
    if (originalSidecar) await writeJsonAtomic(sidecarPath, { ...originalSidecar, textScenes: updatedDraft.textScenes });
    for (const directory of ["09-pending-approval", "10-approved", "11-scheduled", "12-published"]) {
      const candidate = safePath(directory, `${record.id}.json`);
      try {
        await access(candidate);
        await writeJsonAtomic(candidate, updatedRecord);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await writeJsonAtomic(safePath("09-pending-approval", `${record.id}.json`), updatedRecord);
  } catch (error) {
    // Restore the previous render and source documents if the commit phase
    // fails. The successfully staged revision is kept in the revision folder
    // for diagnosis rather than risking deletion of user assets.
    const failedOutput = `${currentOutput}.failed-${randomUUID()}`;
    await rename(currentOutput, failedOutput);
    await rename(revisionOutput, currentOutput);
    await writeJsonAtomic(planPath, originalPlan);
    await writeJsonAtomic(draftPath, originalDraft);
    if (originalSidecar) await writeJsonAtomic(sidecarPath, originalSidecar);
    throw error;
  }
}

export async function getCreddySlideshowSubmission(id: string): Promise<{
  id: string;
  hook: string;
  instagramCaption: string;
  tiktokCaption: string;
  hashtags: string[];
  slideImagePaths: string[];
  blotatoMediaUrls: string[];
}> {
  const { record } = await findBankFile(id);
  if (record.mediaType !== "slideshow" || record.slideImagePaths?.length !== 6) {
    throw new Error("Six rendered slideshow images are required");
  }
  const dto = await toDto(record);
  return {
    id: record.id,
    hook: dto.hook,
    instagramCaption: dto.instagramCaption,
    tiktokCaption: dto.tiktokCaption,
    hashtags: dto.hashtags,
    slideImagePaths: record.slideImagePaths,
    blotatoMediaUrls: record.blotatoMediaUrls ?? [],
  };
}

export async function cacheCreddyBlotatoMedia(id: string, urls: string[]): Promise<void> {
  const { path, record } = await findBankFile(id);
  if (urls.length !== 6) throw new Error("Six Blotato media URLs are required");
  await writeJsonAtomic(path, { ...record, blotatoMediaUrls: urls });
}

export async function recordCreddyBlotatoDestination(input: {
  id: string;
  approvedBy: string;
  destination: CreddyDestination;
}): Promise<void> {
  const { path, record } = await findBankFile(input.id);
  const key = `${input.destination.platform}:${input.destination.account}:${input.destination.format}`;
  const destinations = (record.destinations ?? []).filter((destination) =>
    `${destination.platform}:${destination.account}:${destination.format}` !== key,
  );
  destinations.push(input.destination);
  // Blotato accepting a request is not proof that it is publicly visible.
  // Draft delivery, future scheduling, and immediate publishing therefore keep
  // distinct portal states until a later read-only status check confirms them.
  const status: ContentBankFile["status"] = input.destination.status === "scheduled"
    ? "scheduled"
    : input.destination.status === "published"
      ? "published"
      : "approved";
  const updated: ContentBankFile = {
    ...record,
    status,
    approvedBy: input.approvedBy,
    approvedAt: record.approvedAt ?? new Date().toISOString(),
    destinations,
  };
  await writeJsonAtomic(path, updated);
  if (status === "approved") await writeJsonAtomic(safePath("10-approved", `${record.id}.json`), updated);
  if (status === "scheduled") await writeJsonAtomic(safePath("11-scheduled", `${record.id}.json`), updated);
  if (status === "published") await writeJsonAtomic(safePath("12-published", `${record.id}.json`), updated);
}

export async function reconcileCreddyBlotatoDestination(input: {
  id: string;
  submissionId: string;
  remoteStatus: "in-progress" | "queued" | "scheduled" | "published" | "failed";
  publishedUrl?: string;
  error?: string;
  remotePresence?: "present" | "absent" | "unknown";
  remoteListState?: string;
  remoteListId?: string;
}, now = new Date()): Promise<void> {
  const { path, record } = await findBankFile(input.id);
  const destination = record.destinations?.find((item) => item.submissionId === input.submissionId);
  if (!destination) throw new Error("Blotato destination not found");

  destination.lastCheckedAt = now.toISOString();
  destination.remotePresence = input.remotePresence ?? "unknown";
  destination.remoteState = input.remoteListState ?? input.remoteStatus;
  if (input.remoteListId) destination.remoteListId = input.remoteListId;
  if (destination.remotePresence === "present") destination.remoteMissingSince = undefined;
  if (destination.remotePresence === "absent") destination.remoteMissingSince ??= now.toISOString();
  destination.error = input.remoteStatus === "failed" ? input.error ?? "Blotato delivery failed" : undefined;
  const verifiedPublishedUrl = isSpecificPublicPostUrl(destination.platform, input.publishedUrl)
    ? input.publishedUrl
    : undefined;
  if (verifiedPublishedUrl) destination.publishedUrl = verifiedPublishedUrl;

  if (input.remoteStatus === "failed") {
    destination.status = "failed";
  } else if (input.remoteStatus === "published" && (destination.mode !== "tiktok_draft" || verifiedPublishedUrl)) {
    destination.status = "published";
    destination.publishedAt ??= now.toISOString();
  } else if (destination.mode === "tiktok_draft") {
    // For TikTok inbox delivery, Blotato's "published" response can mean the
    // draft was delivered—not that it is public. A public URL is the stronger
    // signal, so the portal remains honest until one is returned.
    destination.status = "draft_sent";
  } else if (["draft", "drafted"].includes(input.remoteListState?.toLocaleLowerCase("en-US") ?? "")) {
    destination.status = "blotato_draft";
  } else if (
    destination.mode === "schedule" &&
    destination.remotePresence === "absent" &&
    destination.submittedAt &&
    now.getTime() - new Date(destination.submittedAt).getTime() >= 15 * 60_000
  ) {
    // Blotato's status-by-submission endpoint can remain `in-progress` after a
    // user removes a post from the remote schedule. Its live list endpoint is
    // the stronger calendar signal. After a grace period, absence means the
    // item is no longer scheduled; the common Blotato UI action is Move to
    // Drafts. Keep the evidence explicit rather than claiming publication.
    destination.status = "blotato_draft";
  } else if (destination.mode === "schedule") {
    destination.status = "scheduled";
  } else {
    destination.status = "publishing";
  }

  const destinations = record.destinations ?? [];
  const status: ContentBankFile["status"] = destinations.length > 0 && destinations.every((item) => item.status === "published")
    ? "published"
    : destinations.some((item) => item.status === "scheduled")
      ? "scheduled"
      : "approved";
  const updated: ContentBankFile = { ...record, status, destinations, updatedAt: now.toISOString() };
  await writeJsonAtomic(path, updated);
  if (status === "approved") await writeJsonAtomic(safePath("10-approved", `${record.id}.json`), updated);
  if (status === "scheduled") await writeJsonAtomic(safePath("11-scheduled", `${record.id}.json`), updated);
  if (status === "published") await writeJsonAtomic(safePath("12-published", `${record.id}.json`), updated);
}

export async function listCreddyBankItems(): Promise<CreddyBankItemDto[]> {
  const paths = (
    await Promise.all(
      ["09-pending-approval", "10-approved", "11-scheduled", "12-published", "13-rejected-content"].map((directory) => listFiles(safePath(directory))),
    )
  ).flat();
  const records = await Promise.all(paths.map((path) => readJson<ContentBankFile>(path)));
  const byId = new Map<string, ContentBankFile>();
  for (const record of records) {
    const existing = byId.get(record.id);
    if (!existing || recordFreshness(record) > recordFreshness(existing)) byId.set(record.id, record);
  }
  const unique = [...byId.values()];
  const localItems = await Promise.all(
    unique.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((record) => toDto(record)),
  );
  if (localItems.length > 0) return localItems;

  const { listCreddyCloudBankItems } = await import("@/lib/creddy-cloud-store");
  return listCreddyCloudBankItems();
}

export async function writeCreddyLiveSyncReport(report: unknown): Promise<void> {
  await writeJsonAtomic(safePath("reports", "latest", "blotato-live-sync.json"), report);
}

export async function approveCreddyItem(input: {
  id: string;
  approvedBy: string;
  destinations: Array<Omit<CreddyDestination, "status">>;
}, now = new Date()): Promise<void> {
  const { record } = await findBankFile(input.id);
  if (record.status !== "pending_review" && record.status !== "changes_requested") {
    throw new Error(`Cannot approve an item in ${record.status} state`);
  }
  if (!input.destinations.length) throw new Error("Select at least one destination");
  const seen = new Set<string>();
  const destinations = input.destinations.map((destination) => {
    const account = destination.account.trim();
    if (!account) throw new Error("Every selected destination needs an account");
    const scheduled = new Date(destination.scheduledFor);
    if (!Number.isFinite(scheduled.getTime()) || scheduled <= now) {
      throw new Error("Every selected destination needs a future schedule time");
    }
    const key = `${destination.platform}:${account}:${destination.format}`;
    if (seen.has(key)) throw new Error("Duplicate destination");
    seen.add(key);
    return { ...destination, account, scheduledFor: scheduled.toISOString(), status: "pending" as const };
  });
  const approved: ContentBankFile = {
    ...record,
    status: "approved",
    approvedBy: input.approvedBy,
    approvedAt: now.toISOString(),
    destinations,
  };
  await writeJsonAtomic(safePath("10-approved", `${record.id}.json`), approved);
  await writeJsonAtomic(safePath("09-pending-approval", `${record.id}.json`), approved);
  await writeJsonAtomic(safePath("11-scheduled", `${record.id}.json`), { ...approved, status: "scheduled" });
}

/** Slack's green tick is an editorial approval only. It intentionally does
 * not create destinations, schedules, or any external delivery. */
export async function approveCreddyItemFromSlack(input: {
  id: string;
  approvedBy: string;
}, now = new Date()): Promise<void> {
  const { path, record } = await findBankFile(input.id);
  if (record.status !== "pending_review" && record.status !== "changes_requested") {
    throw new Error(`Cannot approve an item in ${record.status} state`);
  }
  const approved: ContentBankFile = {
    ...record,
    status: "approved",
    approvedBy: input.approvedBy,
    approvedAt: now.toISOString(),
    destinations: [],
  };
  await writeJsonAtomic(path, approved);
  await writeJsonAtomic(safePath("09-pending-approval", `${record.id}.json`), approved);
  await writeJsonAtomic(safePath("10-approved", `${record.id}.json`), approved);
}

export async function requestCreddyChanges(input: {
  id: string;
  requestedBy: string;
  notes: string;
}): Promise<void> {
  const { path, record } = await findBankFile(input.id);
  if (record.status !== "pending_review" && record.status !== "changes_requested") {
    throw new Error(`Cannot request changes from ${record.status} state`);
  }
  const notes = input.notes.trim();
  if (notes.length < 5 || notes.length > 2000) throw new Error("Revision notes must be 5–2000 characters");
  await writeJsonAtomic(path, {
    ...record,
    status: "changes_requested",
    revision: record.revision + 1,
    changeRequest: { requestedBy: input.requestedBy, requestedAt: new Date().toISOString(), notes },
  });
}

export async function rejectCreddyItem(input: {
  id: string;
  rejectedBy: string;
  reason: string;
  externalDeliveryCleared?: boolean;
}, now = new Date()): Promise<void> {
  const { path, record } = await findBankFile(input.id);
  if (record.status === "published" || record.status === "rejected") {
    throw new Error(`Cannot reject an item in ${record.status} state`);
  }
  const activeExternalDelivery = (record.destinations ?? []).some((destination) =>
    ["pending", "submitted", "draft_sent", "blotato_draft", "scheduled", "publishing"].includes(destination.status),
  );
  if (activeExternalDelivery && !input.externalDeliveryCleared) {
    throw new Error("Confirm that every external Blotato or TikTok delivery has been removed before rejecting this post");
  }
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 2000) {
    throw new Error("Rejection reason must be 5–2000 characters");
  }
  const rejected: ContentBankFile = {
    ...record,
    status: "rejected",
    statusBeforeRejection: record.status,
    destinationsBeforeRejection: record.destinations ?? [],
    rejectedBy: input.rejectedBy,
    rejectedAt: now.toISOString(),
    rejectionReason: reason,
  };
  // Update the highest-priority source record as well as the rejected archive.
  // This prevents an older scheduled/approved copy from masking the rejection.
  await writeJsonAtomic(path, rejected);
  await writeJsonAtomic(safePath("13-rejected-content", `${record.id}.json`), rejected);
  await writeJsonAtomic(safePath("09-pending-approval", `${record.id}.json`), rejected);
}

export async function restoreRejectedCreddyItem(input: {
  id: string;
  restoredBy: string;
}, now = new Date()): Promise<void> {
  const { path, record } = await findBankFile(input.id);
  if (record.status !== "rejected") throw new Error(`Cannot restore an item in ${record.status} state`);

  // Restored content always returns to human review. Previous delivery records
  // are retained as rejection audit data, but are not reactivated because an
  // undo in this portal must never resubmit or resume a social post.
  const restored: ContentBankFile = {
    ...record,
    status: "pending_review",
    destinations: [],
    restoredBy: input.restoredBy,
    restoredAt: now.toISOString(),
  };
  await writeJsonAtomic(path, restored);
  await writeJsonAtomic(safePath("09-pending-approval", `${record.id}.json`), restored);

  // Keep the rejected copy as an immutable history file without allowing the
  // rejected directory's live record to override the restored review record.
  const rejectedPath = safePath("13-rejected-content", `${record.id}.json`);
  try {
    const historyPath = safePath("13-rejected-content", "history", `${record.id}-${now.getTime()}-${randomUUID()}.json`);
    await mkdir(dirname(historyPath), { recursive: true });
    await rename(rejectedPath, historyPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function getCreddyMediaPath(id: string, format: Format): Promise<{ path: string; mime: string }> {
  const { record } = await findBankFile(id);
  const path = format === "narrated" ? record.narratedVideoPath : record.textMusicVideoPath;
  if (!path || !isAbsolute(path)) throw new Error("Video is not available");
  const allowed = safePath("08-rendered-videos", format === "narrated" ? "narrated" : "text-music");
  const rel = relative(allowed, resolve(path));
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Video path is outside rendered media");
  const info = await stat(path);
  if (!info.isFile()) throw new Error("Video is not a file");
  const extension = extname(path).toLowerCase();
  const mime = extension === ".webm" ? "video/webm" : extension === ".mov" ? "video/quicktime" : "video/mp4";
  return { path, mime };
}

export async function getCreddyArticlePreviewPath(id: string): Promise<string> {
  const { record } = await findBankFile(id);
  const path = record.articlePreviewPath;
  if (!path || !isAbsolute(path)) throw new Error("Article preview is not available");
  const allowed = safePath("06-content-packages", "articles");
  const rel = relative(allowed, resolve(path));
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Article preview path is outside production packages");
  const info = await stat(path);
  if (!info.isFile() || extname(path).toLowerCase() !== ".html") throw new Error("Article preview is invalid");
  return path;
}

export async function getCreddyArticleImagePath(id: string, index: number): Promise<{ path: string; mime: string }> {
  if (!Number.isInteger(index) || index < 0 || index > 2) throw new Error("Invalid article image index");
  const { record } = await findBankFile(id);
  const paths = await articleImagePaths(record);
  const path = paths[index];
  if (!path || !isAbsolute(path)) throw new Error("Article image is not available");
  const rel = relative(root(), resolve(path));
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Article image is outside the Creddy data root");
  const info = await stat(path);
  if (!info.isFile()) throw new Error("Article image is not a file");
  const extension = extname(path).toLowerCase();
  const mime = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  return { path, mime };
}

export async function getCreddyArticlePreviewHtml(id: string): Promise<string> {
  const path = await getCreddyArticlePreviewPath(id);
  const { record } = await findBankFile(id);
  const images = await articleImagePaths(record);
  if (images.length !== 3) throw new Error("Article preview requires exactly three approved 16:9 images");
  const byName = new Map(images.map((imagePath, index) => [imagePath.split("/").at(-1), index]));
  const html = await readFile(path, "utf8");
  return html.replace(/src=(["'])assets\/([^"']+)\1/g, (match, quote: string, name: string) => {
    const index = byName.get(name);
    return index === undefined ? match : `src=${quote}/api/creddy/article-image/${encodeURIComponent(id)}/${index}${quote}`;
  });
}

export async function getCreddySlidePath(id: string, slide: number): Promise<{ path: string; mime: string }> {
  const { record } = await findBankFile(id);
  if (record.mediaType !== "slideshow") throw new Error("Content item is not a slideshow");
  if (!Number.isInteger(slide) || slide < 1 || slide > 6) throw new Error("Invalid slide number");
  const path = record.slideImagePaths?.[slide - 1];
  if (!path || !isAbsolute(path)) throw new Error("Slide is not available");
  const allowed = safePath("07-slideshow-renders");
  const rel = relative(allowed, resolve(path));
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Slide path is outside rendered media");
  const info = await stat(path);
  if (!info.isFile()) throw new Error("Slide is not a file");
  return { path, mime: "image/png" };
}

export async function resolveCreddySlackReview(input: {
  id: string;
  action: "process" | "skip" | "hold";
  resolvedBy: string;
}): Promise<void> {
  const id = validateId(input.id);
  const decisionPath = safePath("03-canonical-news", "slack-review", `${id}.json`);
  const resolutionPath = safePath("03-canonical-news", "slack-review", "resolutions", `${id}.json`);
  try {
    await access(resolutionPath);
    throw new Error("This Slack review was already resolved");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const decision = await readJson<Record<string, unknown>>(decisionPath);
  const resolution = {
    decisionId: id,
    action: input.action,
    resolvedBy: input.resolvedBy,
    resolvedAt: new Date().toISOString(),
  };
  if (input.action === "process") {
    await writeJsonAtomic(safePath("05-content-opportunities", `${id}.json`), {
      ...decision,
      route: "auto_process",
      humanOverride: resolution,
    });
  } else if (input.action === "skip") {
    await writeJsonAtomic(safePath("03-canonical-news", "archived", `slack-${id}.json`), {
      ...decision,
      route: "archived",
      humanOverride: resolution,
    });
  }
  await writeJsonAtomic(resolutionPath, resolution);
}

export async function rescheduleCreddyDestination(input: {
  id: string;
  destinationKey: string;
  scheduledFor: string;
  changedBy: string;
}, now = new Date()): Promise<void> {
  const id = validateId(input.id);
  const path = safePath("11-scheduled", `${id}.json`);
  const record = await readJson<ContentBankFile>(path);
  if (record.status !== "scheduled" || !record.destinations?.length) {
    throw new Error("Only scheduled Creddy content can be moved");
  }
  const target = new Date(input.scheduledFor);
  if (!Number.isFinite(target.getTime()) || target <= now) throw new Error("New schedule must be in the future");
  const destination = record.destinations.find((item) =>
    `${item.platform}:${item.account}:${item.format}` === input.destinationKey,
  );
  if (!destination) throw new Error("Scheduled destination not found");
  if (destination.status !== "pending") throw new Error("Submitted or completed posts cannot be moved");
  const from = destination.scheduledFor;
  destination.scheduledFor = target.toISOString();
  record.scheduleHistory = [
    ...(record.scheduleHistory ?? []),
    { changedBy: input.changedBy, changedAt: now.toISOString(), destinationKey: input.destinationKey, from, to: destination.scheduledFor },
  ];
  await writeJsonAtomic(path, record);
}
