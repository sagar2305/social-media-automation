/**
 * /creator/setup/tiktok — interactive 6-step TikTok account setup guide.
 *
 * Content fetched from CMS. Admins edit everything (text + styling)
 * via /signup-control/tiktok-setup.
 */

import { getPageContent } from "@/lib/cms";
import { TikTokSetupView } from "./view";

export const dynamic = "force-dynamic";

export default async function TikTokSetupPage() {
  const content = await getPageContent("tiktok-setup");
  return <TikTokSetupView content={content} />;
}
