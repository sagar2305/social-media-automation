import { resolve } from 'node:path';

import dotenv from 'dotenv';

import { approveAndPublishWebsiteArticle, autoPublishWebsiteArticle, requestWebsiteArticleChanges, unpublishWebsiteArticle } from './article-approval-service.js';
import { publishApprovedWebsiteArticlesImmediately, unpublishWebsiteArticleImmediately } from './instant-website-publish.js';
import { resolveCreddyDataRoot } from './pipeline-store.js';

dotenv.config({ path: '.env.local', quiet: true });

async function main(): Promise<void> {
  const action = process.argv[2];
  const id = process.env.CREDDY_ARTICLE_ACTION_ID?.trim();
  const actor = process.env.CREDDY_ARTICLE_ACTION_ACTOR?.trim();
  if (!id || !actor) throw new Error('Article action identity is missing');
  const root = resolveCreddyDataRoot();
  if (action === 'request-changes') {
    await requestWebsiteArticleChanges({
      root,
      id,
      requestedBy: actor,
      notes: process.env.CREDDY_ARTICLE_ACTION_NOTES ?? '',
    });
    process.stdout.write(`${JSON.stringify({ changed: true })}\n`);
    return;
  }
  if (action === 'delete') {
    const result = await unpublishWebsiteArticle({
      root,
      id,
      unpublishedBy: actor,
      unpublish: (slug) => unpublishWebsiteArticleImmediately({ slug }),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (!['approve', 'auto-publish', 'retry', 'repost'].includes(action ?? '')) throw new Error('Unknown article action');
  const repositoryRoot = resolve(process.env.CREDDY_REPO_ROOT?.trim() || process.cwd());
  const publishInput = {
    root,
    id,
    websiteBaseUrl: process.env.CREDDY_WEBSITE_BASE_URL,
    publish: () => publishApprovedWebsiteArticlesImmediately({ env: process.env, repositoryRoot }),
  };
  const result = action === 'auto-publish' || action === 'repost'
    ? await autoPublishWebsiteArticle(publishInput)
    : await approveAndPublishWebsiteArticle({ ...publishInput, approvedBy: actor });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

await main();
