/**
 * Legacy URL — redirects to the Minutewise brief.
 *
 * Pre-multi-campaign, /creator/brief rendered the Minutewise content
 * directly. Old bookmarks/links keep working by redirecting here.
 */

import { redirect } from "next/navigation";

export default function CreatorBriefLegacyPage(): never {
  redirect("/creator/minutewise/brief");
}
