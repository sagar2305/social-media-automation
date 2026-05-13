"use client";

/**
 * Per-campaign payout-rate-card editor (Edit page wrapper).
 *
 * Thin wrapper around the shared <PayoutConfigFields> component:
 * holds the draft, owns the save button, and persists via
 * `upsertCampaignPayoutConfig`. The actual form UI lives in
 * src/components/payout-config-fields.tsx so the create page can
 * reuse the exact same fields.
 *
 * All buttons here are type="button" so they never submit the
 * surrounding <form>.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DollarSign, AlertCircle, CheckCircle2, Info, Loader2,
} from "lucide-react";
import type { CampaignPayoutConfig } from "@/lib/types";
import {
  PayoutConfigFields,
  draftFromConfig,
  draftToUpsertPayload,
  type PayoutConfigDraft,
} from "@/components/payout-config-fields";
import { upsertCampaignPayoutConfig } from "../../../payouts/actions";

interface Props {
  campaignId: string;
  initial: CampaignPayoutConfig | null;
}

export function PayoutConfigEditor({ campaignId, initial }: Props) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [draft, setDraft] = useState<PayoutConfigDraft>(() => draftFromConfig(initial));

  function onSave() {
    setError(null);
    setSuccess(false);
    startSaving(async () => {
      const r = await upsertCampaignPayoutConfig({
        campaign_id: campaignId,
        ...draftToUpsertPayload(draft),
      });
      if (!r.ok) { setError(r.error); return; }
      setSuccess(true);
      router.refresh();
      // Auto-clear the success flash after a moment
      setTimeout(() => setSuccess(false), 4000);
    });
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-5">
        <div>
          <p className="text-base font-semibold flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            Payout configuration
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
            How creators on this campaign get paid. The platform calculates
            the amount and surfaces it in the Payouts inbox — you handle the
            actual transfer externally and mark it as paid.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-500">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            <span>Saved — runner will pick up the new config on next analytics refresh.</span>
          </div>
        )}

        <PayoutConfigFields value={draft} onChange={setDraft} disabled={saving} />

        {/* Save button */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Info className="h-3 w-3" />
            Saving triggers a recompute on the next analytics refresh (~6 h).
            Use <code className="font-mono px-1 py-0.5 rounded bg-muted text-[10px]">npx tsx scripts/payouts_recompute.ts --campaign={`<slug>`}</code> for instant.
          </p>
          <Button type="button" disabled={saving} onClick={onSave}>
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <DollarSign className="h-4 w-4 mr-1.5" />}
            Save payout config
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
