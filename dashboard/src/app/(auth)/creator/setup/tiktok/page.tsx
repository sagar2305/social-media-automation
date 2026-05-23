/**
 * Legacy URL — redirects to the Minutewise TikTok setup.
 *
 * Pre-multi-campaign, /creator/setup/tiktok rendered the Minutewise
 * content directly. Old bookmarks/links keep working by redirecting
 * here.
 */

import { redirect } from "next/navigation";

export default function CreatorTiktokSetupLegacyPage(): never {
  redirect("/creator/minutewise/setup/tiktok");
}
