/**
 * Legacy URL — redirects to the Minutewise creator signup.
 *
 * Pre-multi-campaign, /creator/signup rendered the Minutewise content
 * directly. Old bookmarks/links keep working by redirecting here.
 */

import { redirect } from "next/navigation";

export default function CreatorSignupLegacyPage(): never {
  redirect("/creator/minutewise/signup");
}
