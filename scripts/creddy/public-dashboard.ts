import { isIP } from 'node:net';

const EPHEMERAL_HOST_SUFFIXES = ['.trycloudflare.com'];

export function requireStableDashboardBaseUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const raw = env.DASHBOARD_BASE_URL?.trim();
  if (!raw) throw new Error('DASHBOARD_BASE_URL is required for Slack review actions');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DASHBOARD_BASE_URL must be a valid absolute URL');
  }

  if (url.protocol !== 'https:') throw new Error('DASHBOARD_BASE_URL must use HTTPS');
  if (url.username || url.password) throw new Error('DASHBOARD_BASE_URL must not contain credentials');
  if (url.search || url.hash) throw new Error('DASHBOARD_BASE_URL must not contain a query or fragment');
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('DASHBOARD_BASE_URL must be an origin without a path');
  }

  const hostname = url.hostname.toLocaleLowerCase('en-US');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    isIP(hostname) !== 0 ||
    !hostname.includes('.')
  ) {
    throw new Error('DASHBOARD_BASE_URL must use a public DNS hostname');
  }
  if (EPHEMERAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new Error(
      'DASHBOARD_BASE_URL must use a stable named hostname; temporary trycloudflare.com URLs are forbidden',
    );
  }

  return url.origin;
}

export function optionalStableDashboardBaseUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | undefined {
  try {
    return requireStableDashboardBaseUrl(env);
  } catch {
    return undefined;
  }
}
