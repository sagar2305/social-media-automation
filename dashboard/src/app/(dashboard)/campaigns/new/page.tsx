/**
 * /campaigns/new — page wrapper for the campaign creation form.
 *
 * Server component shell that renders the client-side <CampaignForm/>.
 * Auth is enforced by the (dashboard) layout, so we can assume the user
 * is logged in by the time they reach this route.
 */

import { CampaignForm } from "./campaign-form";

export default function NewCampaignPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <CampaignForm />
    </div>
  );
}
