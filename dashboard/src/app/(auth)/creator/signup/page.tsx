/**
 * Creator signup. Copy + styling fetched from CMS (slug "auth-form").
 * Admins edit at /signup-control/auth-form.
 */

import { getPageContent } from "@/lib/cms";
import { CreatorAuthForm } from "@/components/creator-auth-form";
import { CustomSections } from "@/lib/cms-render";

export const dynamic = "force-dynamic";

export default async function CreatorSignupPage() {
  const copy = await getPageContent("auth-form");
  return (
    <>
      <CreatorAuthForm defaultTab="signup" copy={copy} />
      {copy.customSections && copy.customSections.length > 0 && (
        <div className="w-full max-w-xl px-4 pb-10">
          <CustomSections list={copy.customSections} />
        </div>
      )}
    </>
  );
}
