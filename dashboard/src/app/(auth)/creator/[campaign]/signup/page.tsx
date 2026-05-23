/**
 * /creator/<campaign>/signup — campaign-scoped creator signup.
 * Copy + styling fetched from CMS (slug "auth-form", per-campaign row).
 * Admins edit at /signup-control/<campaign>/auth-form.
 */

import { getPageContent } from "@/lib/cms";
import { CreatorAuthForm } from "@/components/creator-auth-form";
import { CustomSections } from "@/lib/cms-render";

export const dynamic = "force-dynamic";

// Campaign existence is enforced by the parent [campaign]/layout.tsx.
export default async function CreatorSignupCampaignPage({
  params,
}: {
  params: Promise<{ campaign: string }>;
}) {
  const { campaign } = await params;
  const copy = await getPageContent("auth-form", campaign);
  return (
    <>
      <CreatorAuthForm defaultTab="signup" copy={copy} campaign={campaign} />
      {copy.customSections && copy.customSections.length > 0 && (
        <div className="w-full max-w-xl px-4 pb-10">
          <CustomSections list={copy.customSections} />
        </div>
      )}
    </>
  );
}
