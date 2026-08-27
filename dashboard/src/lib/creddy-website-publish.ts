import "server-only";

import { execFile as execFileCallback } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export type ArticleApprovalPublishResult = {
  id: string;
  slug: string;
  approvalRecorded: boolean;
  publishState: "published" | "skipped";
  liveUrl: string;
  publishedAt: string;
};

function repositoryRoot(): string {
  return resolve(process.env.CREDDY_REPO_ROOT?.trim() || resolve(process.cwd(), ".."));
}

async function runArticleAction(
  action: "approve" | "retry" | "repost" | "delete" | "request-changes",
  input: { id: string; actor: string; notes?: string },
): Promise<ArticleApprovalPublishResult | undefined> {
  const root = repositoryRoot();
  const command = resolve(root, "scripts/creddy/article-approval-command.ts");
  const { stdout } = await execFile(process.execPath, ["--import", "tsx", command, action], {
    cwd: root,
    env: {
      ...process.env,
      CREDDY_ARTICLE_ACTION_ID: input.id,
      CREDDY_ARTICLE_ACTION_ACTOR: input.actor,
      CREDDY_ARTICLE_ACTION_NOTES: input.notes ?? "",
      CREDDY_REPO_ROOT: root,
    },
    timeout: 150_000,
    maxBuffer: 1024 * 1024,
  });
  const parsed = JSON.parse(stdout) as ArticleApprovalPublishResult | { changed: true };
  return "changed" in parsed ? undefined : parsed;
}

export async function approveAndPublishCreddyWebsiteArticle(input: {
  id: string;
  approvedBy: string;
}): Promise<ArticleApprovalPublishResult> {
  const result = await runArticleAction("approve", { id: input.id, actor: input.approvedBy });
  if (!result) throw new Error("Article approval completed without a publication result");
  return result;
}

export async function retryCreddyWebsiteArticlePublish(id: string): Promise<ArticleApprovalPublishResult> {
  const result = await runArticleAction("retry", { id, actor: "existing-agent-7-approval" });
  if (!result) throw new Error("Article retry completed without a publication result");
  return result;
}

export async function repostCreddyWebsiteArticle(id: string, actor: string): Promise<ArticleApprovalPublishResult> {
  const result = await runArticleAction("repost", { id, actor });
  if (!result) throw new Error("Article repost completed without a publication result");
  return result;
}

export async function deleteCreddyWebsiteArticle(id: string, actor: string): Promise<void> {
  await runArticleAction("delete", { id, actor });
}

export async function requestCreddyWebsiteArticleChanges(input: {
  id: string;
  requestedBy: string;
  notes: string;
}): Promise<void> {
  await runArticleAction("request-changes", { id: input.id, actor: input.requestedBy, notes: input.notes });
}
