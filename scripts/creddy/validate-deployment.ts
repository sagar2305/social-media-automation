import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import dotenv from 'dotenv';

import { requireStableDashboardBaseUrl } from './public-dashboard.js';

type EnvMap = Record<string, string | undefined>;

async function loadEnvironment(path: string): Promise<EnvMap> {
  try {
    return dotenv.parse(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Missing environment file: ${path}`);
    }
    throw error;
  }
}

function requireValue(env: EnvMap, key: string, label: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${label} is missing ${key}`);
  return value;
}

function requireMatchingValue(root: EnvMap, dashboard: EnvMap, key: string): void {
  const rootValue = requireValue(root, key, 'root .env.local');
  const dashboardValue = requireValue(dashboard, key, 'dashboard/.env.local');
  if (rootValue !== dashboardValue) throw new Error(`${key} differs between the two environment files`);
}

async function checkEndpoint(label: string, url: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    throw new Error(`${label} is unreachable: ${(error as Error).message}`);
  }
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  const body = await response.json() as { ok?: boolean; service?: string };
  if (body.ok !== true || body.service !== 'creddy-slack-actions') {
    throw new Error(`${label} returned an unexpected health response`);
  }
}

export async function validateCreddyDeployment(options: { live: boolean }): Promise<void> {
  const repository = resolve(process.cwd());
  const rootEnvironment = await loadEnvironment(resolve(repository, '.env.local'));
  const dashboardEnvironment = await loadEnvironment(resolve(repository, 'dashboard', '.env.local'));
  const rootBase = requireStableDashboardBaseUrl(rootEnvironment);
  const dashboardBase = requireStableDashboardBaseUrl(dashboardEnvironment);
  if (rootBase !== dashboardBase) {
    throw new Error('DASHBOARD_BASE_URL differs between root .env.local and dashboard/.env.local');
  }

  for (const key of [
    'BLOTATO_API_KEY',
    'SLACK_BOT_TOKEN',
    'SLACK_SIGNING_SECRET',
    'SLACK_SOCIAL_UPDATES_CHANNEL_ID',
  ]) {
    requireMatchingValue(rootEnvironment, dashboardEnvironment, key);
  }

  const dataRoot = requireValue(rootEnvironment, 'CREDDY_DATA_ROOT', 'root .env.local');
  if (!dataRoot.startsWith('/')) throw new Error('CREDDY_DATA_ROOT must be an absolute path');

  if (options.live) {
    const localBase = rootEnvironment.CREDDY_DASHBOARD_LOCAL_URL?.trim() || 'http://127.0.0.1:3000';
    await checkEndpoint('Local Slack action endpoint', `${localBase.replace(/\/$/, '')}/api/creddy/slack/actions`);
    await checkEndpoint('Public Slack action endpoint', `${rootBase}/api/creddy/slack/actions`);
  }

  console.log(JSON.stringify({
    valid: true,
    dashboardOrigin: rootBase,
    environmentFilesMatch: true,
    blotatoSecretPresent: true,
    slackSecretsPresent: true,
    liveEndpointsChecked: options.live,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  validateCreddyDeployment({ live: process.argv.includes('--live') }).catch((error) => {
    console.error(`Creddy deployment validation failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
