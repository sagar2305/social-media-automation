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
 *
 * `experimental.serverActions.bodySizeLimit` raises the default 1 MB cap
 * on Server Action request bodies. The campaign create form posts the
 * hero image + CTA image as a single multipart FormData, and 1 MB is
 * easily blown past by two ordinary PNGs. The Supabase Storage bucket
 * caps individual files at 10 MB (Phase 4 migration) so 12 MB here
 * leaves headroom for the multipart envelope without letting clients
 * upload anything larger than the bucket would store anyway.
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
  experimental: {
    serverActions: {
      // Was 12 MB (covered hero + CTA only). Phase 17c added the
      // training-images upload to the create form (up to 15 images at
      // create time, 10 MB each per the bucket policy). Realistic
      // images are 0.5–2 MB each so a typical 15-image upload is
      // ~10–30 MB, but we leave headroom for the worst case.
      bodySizeLimit: "200mb",
    },
  },
};

export default nextConfig;
