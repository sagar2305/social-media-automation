/**
 * Legacy URL — redirects to the Minutewise creator login.
 *
 * Pre-multi-campaign, /creator/login rendered the Minutewise content
 * directly. Old bookmarks/links keep working by redirecting here.
 */

import { redirect } from "next/navigation";

export default function CreatorLoginLegacyPage(): never {
  redirect("/creator/minutewise/login");
}
