/**
 * /creator/<campaign>/setup/tiktok — campaign-scoped TikTok account
 * setup guide. Content fetched from CMS per campaign. Admins edit at
 * /signup-control/<campaign>/tiktok-setup.
 */

import { getPageContent } from "@/lib/cms";
import { TikTokSetupView } from "../../../setup/tiktok/view";

export const dynamic = "force-dynamic";

// Campaign existence is enforced by the parent [campaign]/layout.tsx.
export default async function CreatorTikTokSetupCampaignPage({
  params,
}: {
  params: Promise<{ campaign: string }>;
}) {
  const { campaign } = await params;
  const content = await getPageContent("tiktok-setup", campaign);
  return <TikTokSetupView content={content} campaign={campaign} />;
}
