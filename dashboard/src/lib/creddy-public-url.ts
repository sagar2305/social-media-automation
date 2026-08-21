import { isIP } from 'node:net';

export function stableCreddyDashboardOrigin(value = process.env.DASHBOARD_BASE_URL): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLocaleLowerCase('en-US');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '/' && url.pathname !== '') ||
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.trycloudflare.com') ||
      isIP(hostname) !== 0 ||
      !hostname.includes('.')
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}
