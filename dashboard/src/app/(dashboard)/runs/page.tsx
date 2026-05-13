import { RunsLive } from "@/components/runs-live";

export const dynamic = "force-dynamic";

/**
 * /runs is now a pure history view. The "Run a cycle on demand" panel
 * that used to sit at the top moved into each campaign's hero
 * (`RunCycleButton` on /campaigns/[slug]) once the engine went
 * multi-campaign — every cycle has to be tagged with a campaign_id and
 * the account picker has to be scoped to that campaign's accounts, so a
 * global account-list cycle picker no longer made sense.
 */
export default function RunsPage() {
  return (
    <div className="space-y-6">
      <RunsLive />
    </div>
  );
}
