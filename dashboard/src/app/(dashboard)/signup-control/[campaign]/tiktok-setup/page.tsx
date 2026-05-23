import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getPageContentForEditor } from "@/lib/cms";
import { getCampaignBySlug } from "@/lib/campaigns";
import { campaignMeta, isCampaign } from "@/lib/cms-schemas";
import { TiktokSetupEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function SignupControlTiktokSetupPage({
  params,
}: {
  params: Promise<{ campaign: string }>;
}) {
  await requireRole("admin");
  const { campaign } = await params;
  const row = await getCampaignBySlug(campaign);
  if (!row) notFound();
  const label = row.name || (isCampaign(campaign) ? campaignMeta[campaign].label : campaign);
  const { content, updatedAt } = await getPageContentForEditor("tiktok-setup", campaign);
  return (
    <TiktokSetupEditor
      initial={content}
      updatedAt={updatedAt}
      campaign={campaign}
      campaignLabel={label}
    />
  );
}
