"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/auth";
import {
  approveCreddyItem,
  cacheCreddyBlotatoMedia,
  getCreddySlideshowSubmission,
  recordCreddyBlotatoDestination,
  rejectCreddyItem,
  requestCreddyChanges,
  rescheduleCreddyDestination,
  restoreRejectedCreddyItem,
  saveCreddyReviewDraft,
  updateCreddySlideshowDesign,
} from "@/lib/creddy-file-store";
import { notifyCreddySlack } from "@/lib/creddy-slack-notifications";
import { syncCreddyBlotatoStatuses } from "@/lib/creddy-blotato-sync";
import { deleteCreddyWebsiteArticle, repostCreddyWebsiteArticle } from "@/lib/creddy-website-publish";
import {
  buildInstagramPostBody,
  buildTikTokPostBody,
  isBlotatoMediaUrl,
  listBlotatoAccounts,
  prepareLocalImageFiles,
  submitPost,
} from "@/lib/blotato";

const formats = ["text_music", "narrated"] as const;
const platforms = ["instagram", "tiktok"] as const;

function value(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function slideshowEditorValues(formData: FormData) {
  const selectedPlatforms = platforms.filter((platform) => value(formData, `${platform}_enabled`) === "on");
  const hashtagText = value(formData, "hashtags");
  return {
    id: value(formData, "id"),
    instagramCaption: value(formData, "instagram_caption"),
    tiktokCaption: value(formData, "tiktok_caption"),
    hashtags: hashtagText.split(/[\s,]+/).filter(Boolean),
    platforms: selectedPlatforms,
    accountIds: {
      instagram: value(formData, "instagram_account"),
      tiktok: value(formData, "tiktok_account"),
    },
    scheduledFor: value(formData, "scheduled_for") || undefined,
  };
}

export async function repostCreddyWebsiteArticleAction(formData: FormData): Promise<void> {
  const auth = await assertRole("editor");
  if (!auth.ok) throw new Error(auth.error);
  const id = value(formData, "id");
  let outcome = "article-reposted";
  try {
    await repostCreddyWebsiteArticle(id, auth.user.email || auth.user.id);
  } catch (error) {
    console.error(`[Creddy website] Repost failed for ${id}:`, error instanceof Error ? error.message : error);
    outcome = "article-publish-failed";
  }
  revalidatePath("/creddy/content-bank/articles");
  revalidatePath("/creddy/all-content");
  redirect(`/creddy/content-bank/articles?item=${encodeURIComponent(id)}&updated=${outcome}#${encodeURIComponent(id)}`);
}

export async function deleteCreddyWebsiteArticleAction(formData: FormData): Promise<void> {
  const auth = await assertRole("editor");
  if (!auth.ok) throw new Error(auth.error);
  const id = value(formData, "id");
  await deleteCreddyWebsiteArticle(id, auth.user.email || auth.user.id);
  revalidatePath("/creddy/content-bank/articles");
  revalidatePath("/creddy/all-content");
  redirect(`/creddy/content-bank/articles?item=${encodeURIComponent(id)}&updated=article-unpublished#${encodeURIComponent(id)}`);
}

export async function saveCreddyDraftAction(formData: FormData): Promise<void> {
  const auth = await assertRole("editor");
  if (!auth.ok) throw new Error(auth.error);
  await saveCreddyReviewDraft({
    ...slideshowEditorValues(formData),
    savedBy: auth.user.email || auth.user.id,
  });
  revalidatePath("/creddy/content-bank");
  revalidatePath("/creddy/calendar");
  revalidatePath("/creddy/all-content");
  const returnTo = value(formData, "return_to") === "/creddy/all-content/slideshows"
    ? "/creddy/all-content/slideshows"
    : "/creddy/content-bank/slideshows";
  redirect(`${returnTo}?updated=draft-saved`);
}

export type CreddySlideshowDesignActionState = { error?: string };

export async function updateCreddySlideshowDesignAction(
  _previousState: CreddySlideshowDesignActionState,
  formData: FormData,
): Promise<CreddySlideshowDesignActionState> {
  const auth = await assertRole("editor");
  if (!auth.ok) return { error: auth.error };
  const scenes = Array.from({ length: 6 }, (_, index) => ({
    text: value(formData, `slide_${index + 1}_text`),
    supportText: value(formData, `slide_${index + 1}_support`),
    expression: value(formData, `slide_${index + 1}_expression`),
    backgroundStyle: value(formData, `slide_${index + 1}_background`),
  }));
  try {
    await updateCreddySlideshowDesign({
      id: value(formData, "id"),
      editedBy: auth.user.email || auth.user.id,
      scenes,
      phoneTemplateId: value(formData, "phone_template"),
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Slides could not be regenerated" };
  }
  revalidatePath("/creddy/content-bank");
  revalidatePath("/creddy/all-content");
  revalidatePath("/creddy/calendar");
  const id = value(formData, "id");
  redirect(`/creddy/content-bank/slideshows?item=${encodeURIComponent(id)}&updated=slides-regenerated#${encodeURIComponent(id)}`);
}

export async function submitCreddySlideshowAction(formData: FormData): Promise<void> {
  const auth = await assertRole("editor");
  if (!auth.ok) throw new Error(auth.error);
  const editor = slideshowEditorValues(formData);
  const mode = value(formData, "publish_mode");
  if (!["now", "schedule", "tiktok_draft"].includes(mode)) throw new Error("Invalid publishing mode");
  if (!editor.platforms.length) throw new Error("Select Instagram or TikTok");
  if (mode === "tiktok_draft" && (editor.platforms.length !== 1 || editor.platforms[0] !== "tiktok")) {
    throw new Error("Blotato draft delivery is available only for TikTok");
  }
  let scheduledTime: string | undefined;
  if (mode === "schedule") {
    const scheduled = new Date(editor.scheduledFor ?? "");
    if (!Number.isFinite(scheduled.getTime()) || scheduled.getTime() <= Date.now()) {
      throw new Error("Choose a future calendar time");
    }
    scheduledTime = scheduled.toISOString();
  }

  const actor = auth.user.email || auth.user.id;
  await saveCreddyReviewDraft({ ...editor, savedBy: actor });
  const apiKey = process.env.BLOTATO_API_KEY;
  if (!apiKey) throw new Error("BLOTATO_API_KEY is not configured");
  const liveAccounts = await listBlotatoAccounts(apiKey);
  const accountById = new Map(liveAccounts.map((account) => [account.id, account]));
  for (const platform of editor.platforms) {
    const accountId = editor.accountIds[platform];
    const account = accountId ? accountById.get(accountId) : undefined;
    if (!account || account.platform !== platform) throw new Error(`Select a connected ${platform} account`);
  }

  const content = await getCreddySlideshowSubmission(editor.id);
  let mediaUrls = content.blotatoMediaUrls;
  if (mediaUrls.length !== 6 || !mediaUrls.every(isBlotatoMediaUrl)) {
    mediaUrls = await prepareLocalImageFiles(content.slideImagePaths, apiKey);
    await cacheCreddyBlotatoMedia(editor.id, mediaUrls);
  }
  const tags = editor.hashtags.map((tag) => `#${tag.replace(/^#+/, "")}`).join(" ");
  for (const platform of editor.platforms) {
    const accountId = editor.accountIds[platform]!;
    const caption = `${platform === "instagram" ? editor.instagramCaption : editor.tiktokCaption}${tags ? `\n\n${tags}` : ""}`;
    const payload = platform === "instagram"
      ? buildInstagramPostBody({ accountId, caption, mediaUrls, scheduledTime })
      : buildTikTokPostBody({
          accountId,
          caption,
          mediaUrls,
          title: content.hook,
          isVideo: false,
          scheduledTime,
          isDraft: mode === "tiktok_draft",
        });
    const submitted = await submitPost(payload, apiKey);
    const deliveryMode = mode === "tiktok_draft" ? "tiktok_draft" : mode === "schedule" ? "schedule" : "publish_now";
    const accepted = submitted.ok && Boolean(submitted.submissionId);
    await recordCreddyBlotatoDestination({
      id: editor.id,
      approvedBy: actor,
      destination: {
        format: "text_music",
        platform,
        account: accountId,
        mode: deliveryMode,
        scheduledFor: scheduledTime ?? new Date().toISOString(),
        status: accepted ? mode === "tiktok_draft" ? "draft_sent" : mode === "schedule" ? "scheduled" : "publishing" : "failed",
        submittedAt: accepted ? new Date().toISOString() : undefined,
        submissionId: submitted.ok ? submitted.submissionId ?? undefined : undefined,
        error: accepted ? undefined : submitted.ok ? "Blotato accepted the request but returned no submission ID" : submitted.error,
      },
    });
    const occurredAt = new Date().toISOString();
    if (accepted && mode === "schedule" && scheduledTime) {
      await notifyCreddySlack({
        kind: "scheduled",
        id: editor.id,
        hook: content.hook,
        platform,
        account: accountId,
        scheduledFor: scheduledTime,
        actor,
      });
    }
    if (accepted && mode === "tiktok_draft") {
      await notifyCreddySlack({
        kind: "draft_sent",
        id: editor.id,
        hook: content.hook,
        platform,
        account: accountId,
        occurredAt,
        actor,
        submissionId: submitted.submissionId ?? undefined,
      });
    }
    if (accepted && mode === "now") {
      await notifyCreddySlack({
        kind: "post_now",
        id: editor.id,
        hook: content.hook,
        platform,
        account: accountId,
        occurredAt,
        actor,
        submissionId: submitted.submissionId ?? undefined,
      });
    }
    if (!accepted) {
      await notifyCreddySlack({
        kind: "delivery_failed",
        id: editor.id,
        hook: content.hook,
        platform,
        account: accountId,
        occurredAt,
        actor,
        error: submitted.ok ? "Blotato returned no submission ID" : submitted.error,
      });
    }
    if (!submitted.ok) throw new Error(submitted.error);
    if (!submitted.submissionId) throw new Error("Blotato accepted the request but returned no submission ID");
  }
  revalidatePath("/creddy/content-bank");
  revalidatePath("/creddy/calendar");
  revalidatePath("/creddy/all-content");
  revalidatePath("/creddy/posts/scheduled");
  revalidatePath("/creddy/posts/publishing");
  const returnTo = value(formData, "return_to") === "/creddy/all-content/slideshows"
    ? "/creddy/all-content/slideshows"
    : "/creddy/content-bank/slideshows";
  redirect(`${returnTo}?updated=${mode === "schedule" ? "scheduled" : mode === "tiktok_draft" ? "tiktok-draft" : "submitted"}`);
}

export async function refreshCreddyDeliveryStatusesAction(): Promise<void> {
  const auth = await assertRole("viewer");
  if (!auth.ok) throw new Error(auth.error);
  await syncCreddyBlotatoStatuses({ force: true, minIntervalMs: 0 });
  revalidatePath("/creddy/content-bank");
  revalidatePath("/creddy/calendar");
  revalidatePath("/creddy/all-content");
  revalidatePath("/creddy/posts/scheduled");
  revalidatePath("/creddy/posts/publishing");
  revalidatePath("/creddy/posts/published");
  redirect("/creddy/content-bank/slideshows?updated=status-refreshed");
}

export async function approveCreddyAction(formData: FormData): Promise<void> {
  const auth = await assertRole("editor");
  if (!auth.ok) throw new Error(auth.error);
  const destinations: Array<{
    format: (typeof formats)[number];
    platform: (typeof platforms)[number];
    account: string;
    scheduledFor: string;
  }> = [];
  for (const format of formats) {
    for (const platform of platforms) {
      const prefix = `${format}_${platform}`;
      if (value(formData, `${prefix}_enabled`) !== "on") continue;
      destinations.push({
        format,
        platform,
        account: value(formData, `${prefix}_account`),
        scheduledFor: value(formData, `${prefix}_scheduled_for`),
      });
    }
  }
  await approveCreddyItem({
    id: value(formData, "id"),
    approvedBy: auth.user.email || auth.user.id,
    destinations,
  });
  revalidatePath("/creddy/content-bank");
  revalidatePath("/creddy/calendar");
  redirect("/creddy/content-bank?updated=approved");
}

export async function requestCreddyChangesAction(formData: FormData): Promise<void> {
  const auth = await assertRole("editor");
  if (!auth.ok) throw new Error(auth.error);
  await requestCreddyChanges({
    id: value(formData, "id"),
    requestedBy: auth.user.email || auth.user.id,
    notes: value(formData, "notes"),
  });
  revalidatePath("/creddy/content-bank");
  revalidatePath("/creddy/calendar");
  redirect("/creddy/content-bank?updated=changes-requested");
}

export async function rejectCreddyAction(formData: FormData): Promise<void> {
  const auth = await assertRole("editor");
  if (!auth.ok) throw new Error(auth.error);
  const id = value(formData, "id");
  const actor = auth.user.email || auth.user.id;
  const reason = value(formData, "reason");
  let hook = id;
  try {
    hook = (await getCreddySlideshowSubmission(id)).hook;
  } catch {
    // Rejection must remain available even if an older non-slideshow record
    // cannot provide the richer Slack title.
  }
  const rejectedAt = new Date().toISOString();
  await rejectCreddyItem({
    id,
    rejectedBy: actor,
    reason,
    externalDeliveryCleared: value(formData, "external_delivery_cleared") === "on",
  });
  await notifyCreddySlack({ kind: "rejected", id, hook, reason, rejectedAt, actor });
  revalidatePath("/creddy/content-bank");
  revalidatePath("/creddy/calendar");
  revalidatePath("/creddy/all-content");
  revalidatePath("/creddy/posts/rejected");
  const returnTo = value(formData, "return_to");
  const allowedDestinations = new Set([
    "/creddy/all-content/slideshows",
    "/creddy/all-content/videos",
    "/creddy/content-bank/slideshows",
    "/creddy/content-bank/videos",
  ]);
  const destination = allowedDestinations.has(returnTo) ? returnTo : "/creddy/all-content/slideshows";
  redirect(`${destination}?updated=rejected`);
}

export async function restoreRejectedCreddyAction(formData: FormData): Promise<void> {
  const auth = await assertRole("editor");
  if (!auth.ok) throw new Error(auth.error);
  const id = value(formData, "id");
  const mediaType = value(formData, "media_type") === "video" ? "videos" : "slideshows";
  await restoreRejectedCreddyItem({
    id,
    restoredBy: auth.user.email || auth.user.id,
  });
  revalidatePath("/creddy/content-bank");
  revalidatePath("/creddy/calendar");
  revalidatePath("/creddy/all-content");
  revalidatePath("/creddy/posts/rejected");
  redirect(`/creddy/content-bank/${mediaType}?item=${encodeURIComponent(id)}#${encodeURIComponent(id)}`);
}

export async function rescheduleCreddyAction(formData: FormData): Promise<void> {
  const auth = await assertRole("editor");
  if (!auth.ok) throw new Error(auth.error);
  await rescheduleCreddyDestination({
    id: value(formData, "id"),
    destinationKey: value(formData, "destination_key"),
    scheduledFor: value(formData, "scheduled_for"),
    changedBy: auth.user.email || auth.user.id,
  });
  revalidatePath("/creddy/content-bank");
  revalidatePath("/creddy/calendar");
}
