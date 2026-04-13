import Link from "next/link";
import { CampaignForm } from "@/components/campaign-form";

export default function NewCampaignPage() {
  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/campaigns"
          className="text-sm font-medium text-[#16a34a] hover:text-[#16a34a]/80 transition-colors"
        >
          ← All campaigns
        </Link>
        <h1 className="text-5xl font-semibold tracking-tight mt-2">
          New campaign
        </h1>
        <p className="text-lg text-muted-foreground mt-2">
          Set up a new A/B test campaign.
        </p>
      </div>
      <CampaignForm />
    </div>
  );
}
