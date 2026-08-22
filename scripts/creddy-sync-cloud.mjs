#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { readFile, readdir } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRole) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const configuredRoot = process.env.CREDDY_DATA_ROOT?.trim()
  || "/Users/mohitkourav/Documents/ChatGPT/Social media automation data";
if (!isAbsolute(configuredRoot)) {
  console.error("CREDDY_DATA_ROOT must be an absolute path");
  process.exit(1);
}

const dataRoot = resolve(configuredRoot, "creddy");
const supabase = createClient(url, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const bucket = "creddy-content";
const table = "creddy_content_bank";

function freshness(record) {
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
  ];
  return Math.max(0, ...values.map((value) => value ? Date.parse(value) : 0).filter(Number.isFinite));
}

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function records() {
  const byId = new Map();
  for (const directory of ["09-pending-approval", "10-approved", "11-scheduled", "12-published", "13-rejected-content"]) {
    const directoryPath = join(dataRoot, directory);
    for (const name of await readdir(directoryPath).catch(() => [])) {
      if (!name.endsWith(".json")) continue;
      const record = await json(join(directoryPath, name));
      const current = byId.get(record.id);
      if (!current || freshness(record) > freshness(current)) byId.set(record.id, record);
    }
  }
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function dto(record, content) {
  const slideshow = record.mediaType === "slideshow";
  const draft = "textScenes" in content;
  const caption = draft ? content.instagramCaption : content.caption;
  return {
    id: record.id,
    createdAt: record.createdAt,
    status: record.status,
    revision: record.revision,
    mediaType: slideshow ? "slideshow" : "video",
    slideCount: record.slideCount ?? 0,
    hasSlideshow: slideshow && record.slideImagePaths?.length === 6,
    hook: content.hook,
    scriptLines: draft ? content.textScenes : content.scriptLines,
    caption,
    instagramCaption: draft ? content.instagramCaption : content.platformCaptions?.instagram ?? caption,
    tiktokCaption: draft ? content.tiktokCaption : content.platformCaptions?.tiktok ?? caption,
    hashtags: content.hashtags ?? [],
    cta: content.cta,
    brief: content.brief,
    sourceUrls: content.sourceUrls ?? [],
    factualClaims: content.factualClaims ?? [],
    hasTextMusicVideo: Boolean(record.textMusicVideoPath),
    hasNarratedVideo: Boolean(record.narratedVideoPath),
    approvedBy: record.approvedBy,
    approvedAt: record.approvedAt,
    destinations: record.destinations ?? [],
    reviewDraft: record.reviewDraft,
    rejectedAt: record.rejectedAt,
    rejectionReason: record.rejectionReason,
    cloudBacked: true,
  };
}

function mime(path) {
  const extension = extname(path).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webm") return "video/webm";
  if (extension === ".mov") return "video/quicktime";
  return "video/mp4";
}

async function upload(localPath, remotePath) {
  const body = await readFile(localPath);
  const { error } = await supabase.storage.from(bucket).upload(remotePath, body, {
    cacheControl: "3600",
    contentType: mime(localPath),
    upsert: true,
  });
  if (error) throw new Error(`Upload ${remotePath}: ${error.message}`);
  return remotePath;
}

async function ensureInfrastructure() {
  const { data: existing, error: bucketError } = await supabase.storage.getBucket(bucket);
  if (bucketError && !/not found/i.test(bucketError.message)) throw bucketError;
  if (!existing) {
    const { error } = await supabase.storage.createBucket(bucket, {
      public: false,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ["image/png", "video/mp4", "video/quicktime", "video/webm"],
    });
    if (error) throw error;
  }
  const { error: tableError } = await supabase.from(table).select("id").limit(1);
  if (tableError) {
    throw new Error(`Cloud table is unavailable. Apply dashboard/migrations/add_creddy_cloud_content_bank.sql first: ${tableError.message}`);
  }
}

await ensureInfrastructure();
const items = await records();
console.log(`Syncing ${items.length} Creddy items to the private cloud mirror...`);

let completed = 0;
for (const record of items) {
  const slideshow = record.mediaType === "slideshow";
  const contentId = slideshow ? record.contentDraftId ?? record.contentPackageId : record.contentPackageId;
  const contentDirectory = slideshow ? "06-content-drafts" : "06-content-packages";
  const content = await json(join(dataRoot, contentDirectory, `${contentId}.json`));
  const assets = {};

  if (slideshow) {
    assets.slides = [];
    for (let index = 0; index < (record.slideImagePaths ?? []).length; index++) {
      assets.slides.push(await upload(record.slideImagePaths[index], `${record.id}/slides/slide-${index + 1}.png`));
    }
  } else {
    if (record.textMusicVideoPath) {
      assets.text_music = await upload(record.textMusicVideoPath, `${record.id}/video/text-music${extname(record.textMusicVideoPath).toLowerCase()}`);
    }
    if (record.narratedVideoPath) {
      assets.narrated = await upload(record.narratedVideoPath, `${record.id}/video/narrated${extname(record.narratedVideoPath).toLowerCase()}`);
    }
  }

  const sourceUpdatedAt = new Date(freshness(record) || Date.now()).toISOString();
  const { error } = await supabase.from(table).upsert({
    id: record.id,
    item: dto(record, content),
    assets,
    source_updated_at: sourceUpdatedAt,
    synced_at: new Date().toISOString(),
  }, { onConflict: "id" });
  if (error) throw new Error(`Upsert ${record.id}: ${error.message}`);
  completed++;
  console.log(`  ${completed}/${items.length} ${record.id}`);
}

console.log(`Cloud mirror complete: ${completed} items.`);

