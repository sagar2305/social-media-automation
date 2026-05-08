import type { NextConfig } from "next";

/**
 * Next.js config.
 *
 * `images.remotePatterns` whitelists the Supabase Storage CDN so
 * <Image src={campaign.image_url}> can render uploaded campaign hero/CTA
 * images. Without this entry every campaign card in /campaigns crashes
 * at render time with "Invalid src prop" on the image_url.
 *
 * The hostname is read from NEXT_PUBLIC_SUPABASE_URL so the same config
 * works across local/preview/prod projects without code changes.
 */

let supabaseHost: string | null = null;
try {
  const u = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (u) supabaseHost = new URL(u).hostname;
} catch {
  // Bad URL — leave host null; image domain just won't be whitelisted.
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      ...(supabaseHost
        ? [{ protocol: "https" as const, hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }]
        : []),
    ],
  },
};

export default nextConfig;
