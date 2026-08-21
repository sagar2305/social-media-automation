export function isSpecificPublicPostUrl(
  platform: "instagram" | "tiktok",
  value?: string,
): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    const path = url.pathname;

    if (platform === "instagram") {
      return (host === "instagram.com" || host.endsWith(".instagram.com"))
        && /^\/(?:p|reel|tv)\/[^/]+/i.test(path);
    }

    if (host === "vm.tiktok.com" || host === "vt.tiktok.com") {
      return path !== "/";
    }
    return (host === "tiktok.com" || host.endsWith(".tiktok.com"))
      && (/^\/@[^/]+\/(?:video|photo)\/\d+/i.test(path) || /^\/t\/[^/]+/i.test(path));
  } catch {
    return false;
  }
}
