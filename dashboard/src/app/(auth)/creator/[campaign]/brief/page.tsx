/**
 * /creator/<campaign>/brief — campaign-scoped long-scroll internship brief.
 *
 * Thin server-component shell. The campaign segment selects which
 * cms_pages row to load; the view itself is the same BriefView used
 * by every campaign (we don't reskin per campaign — only copy + URLs
 * change). Admins edit at /signup-control/<campaign>/brief.
 */

import { getPageContent } from "@/lib/cms";
import { BriefView } from "../../brief/view";

export const dynamic = "force-dynamic";

// Existence check for `campaign` lives in the parent layout
// (creator/[campaign]/layout.tsx). If the slug isn't in the campaigns
// table, the layout calls notFound() before we get here.
export default async function CreatorBriefCampaignPage({
  params,
}: {
  params: Promise<{ campaign: string }>;
}) {
  const { campaign } = await params;
  const content = await getPageContent("brief", campaign);
  return <BriefView content={content} />;
}
