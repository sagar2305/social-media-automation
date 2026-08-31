import { execFile as execFileCallback } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  createSupabaseWebsiteCmsClient,
  createWebsiteRevalidator,
  unpublishWebsiteArticleFromCms,
} from './website-cms-stage.js';

const execFile = promisify(execFileCallback);

export type InstantWebsitePublishResult = {
  published: number;
  skipped: number;
  failures: Array<{ exportPath: string; reason: string }>;
};

export type WebsiteCmsCredentials = { url: string; serviceRoleKey: string; projectRef: string };

function projectRefFromUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('CREDDY_SUPABASE_URL is invalid.');
  }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) {
    throw new Error('CREDDY_SUPABASE_URL must be a Supabase HTTPS project URL.');
  }
  const projectRef = url.hostname.slice(0, -'.supabase.co'.length);
  if (!/^[a-z0-9]{10,40}$/.test(projectRef)) throw new Error('CREDDY_SUPABASE_URL project reference is invalid.');
  return projectRef;
}

function projectRefFromLegacyJwt(value: string): string | undefined {
  const parts = value.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as { ref?: unknown; role?: unknown };
    if (payload.role !== 'service_role') throw new Error('Website CMS server credential has the wrong role.');
    return typeof payload.ref === 'string' ? payload.ref : undefined;
  } catch (error) {
    if (error instanceof Error && /wrong role/.test(error.message)) throw error;
    throw new Error('Website CMS server credential is invalid.');
  }
}

export function resolveWebsiteCmsCredentials(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): WebsiteCmsCredentials {
  const url = env.CREDDY_SUPABASE_URL?.trim();
  if (!url) throw new Error('CREDDY_SUPABASE_URL is missing.');
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing.');
  const projectRef = projectRefFromUrl(url);
  const credentialProjectRef = projectRefFromLegacyJwt(serviceRoleKey);
  if (credentialProjectRef && credentialProjectRef !== projectRef) {
    throw new Error('Website CMS URL and server credential project references do not match.');
  }
  return { url, serviceRoleKey, projectRef };
}

export function assertInstantWebsitePublishConfigured(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): void {
  const enabled = env.CREDDY_WEBSITE_AUTO_PUBLISH?.trim().toLowerCase() === 'true' ||
    env.CREDDY_WEBSITE_AUTO_PUBLISH_ON_APPROVAL?.trim().toLowerCase() === 'true';
  if (!enabled) {
    throw new Error('Automatic website publishing is disabled. Set CREDDY_WEBSITE_AUTO_PUBLISH=true.');
  }
  resolveWebsiteCmsCredentials(env);
}

export async function unpublishWebsiteArticleImmediately(options: {
  slug: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): Promise<{ removedAssets: number; revalidation: 'revalidated' | 'not_configured' | 'failed' }> {
  const env = options.env ?? process.env;
  assertInstantWebsitePublishConfigured(env);
  const credentials = resolveWebsiteCmsCredentials(env);
  return unpublishWebsiteArticleFromCms({
    slug: options.slug,
    client: createSupabaseWebsiteCmsClient(credentials.url, credentials.serviceRoleKey),
    revalidate: createWebsiteRevalidator({
      websiteBaseUrl: env.CREDDY_WEBSITE_BASE_URL,
      secret: env.CREDDY_WEBSITE_REVALIDATE_SECRET,
    }),
  });
}

export async function publishApprovedWebsiteArticlesImmediately(options: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  repositoryRoot?: string;
} = {}): Promise<InstantWebsitePublishResult> {
  const env = options.env ?? process.env;
  assertInstantWebsitePublishConfigured(env);
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  const cli = resolve(repositoryRoot, 'scripts/creddy/pipeline-cli.ts');
  const { stdout } = await execFile(process.execPath, ['--import', 'tsx', cli, 'agent-8-website-export'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      ...env,
      CREDDY_PIPELINE_ENABLED: 'true',
      CREDDY_WEBSITE_CMS_PUBLISH_ENABLED: 'true',
      CREDDY_WEBSITE_ASSET_WEBP_ENABLED: env.CREDDY_WEBSITE_ASSET_WEBP_ENABLED || 'true',
      CREDDY_WEBSITE_ASSET_WEBP_QUALITY: env.CREDDY_WEBSITE_ASSET_WEBP_QUALITY || '88',
      CREDDY_WEBSITE_CMS_FORCE_REPUBLISH: 'false',
    },
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
  });
  const parsed = JSON.parse(stdout) as { cms?: InstantWebsitePublishResult };
  if (!parsed.cms) throw new Error('Agent 8 completed without a CMS publish result.');
  if (parsed.cms.failures.length) throw new Error(`Agent 8 CMS publish failed for ${parsed.cms.failures.length} article(s).`);
  return parsed.cms;
}
