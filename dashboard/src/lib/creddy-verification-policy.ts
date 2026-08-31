export type VerificationGate = {
  portfolioRank: number;
  selectedAt: string;
  official: {
    id: string;
    checkedAt: string;
    status: "verified" | "inconclusive" | "conflicting" | "unavailable";
    attemptedUrls: string[];
    evidence: Array<{ url: string; owner: string; sourceType: string }>;
    claimOutcomes: Array<{ field: string; status: "verified" | "unresolved" | "conflicting" | "not_found"; officialUrls: string[]; notes: string }>;
    remainingRequirements: string[];
    failureReasons: string[];
  };
  socialStatus: "verified" | "manual_confirmation_required" | "conflicting";
  factsVerifiedBy?: string;
  factsVerifiedAt?: string;
  factsVerificationRevision?: number;
};

export type VerificationBoundRecord = {
  analysisBatchId?: string;
  verificationGate?: VerificationGate;
};

export function resetFactsVerificationAfterPublicCopyEdit(gate?: VerificationGate): VerificationGate | undefined {
  if (!gate || gate.socialStatus === "conflicting") return gate;
  const reset = { ...gate, socialStatus: "manual_confirmation_required" as const };
  delete reset.factsVerifiedBy;
  delete reset.factsVerifiedAt;
  delete reset.factsVerificationRevision;
  return reset;
}

export function hasPublicCopyChanged(
  original: { instagramCaption: string; tiktokCaption: string; hashtags: string[] },
  edited: { instagramCaption: string; tiktokCaption: string; hashtags: string[] },
): boolean {
  return original.instagramCaption !== edited.instagramCaption ||
    original.tiktokCaption !== edited.tiktokCaption ||
    JSON.stringify(original.hashtags) !== JSON.stringify(edited.hashtags);
}

export function assertVerificationRecordIntegrity(bank: VerificationBoundRecord, source: VerificationBoundRecord): void {
  if (!bank.analysisBatchId && !source.analysisBatchId) return;
  if (!bank.analysisBatchId || bank.analysisBatchId !== source.analysisBatchId) {
    throw new Error("Current-workflow content has a missing or mismatched Agent 03 batch identity.");
  }
  if (!bank.verificationGate || !source.verificationGate) {
    throw new Error("Current-workflow content is missing its official-verification gate.");
  }
  const immutable = (gate: VerificationGate) => ({
    portfolioRank: gate.portfolioRank,
    selectedAt: gate.selectedAt,
    official: gate.official,
  });
  if (JSON.stringify(immutable(bank.verificationGate)) !== JSON.stringify(immutable(source.verificationGate))) {
    throw new Error("Content Bank and source content verification gates do not match.");
  }
}

export function assertSocialVerificationForRevision(gate: VerificationGate | undefined, revision: number): void {
  if (!gate) return;
  if (gate.official.status === "conflicting" || gate.socialStatus === "conflicting") {
    throw new Error("Official evidence conflicts with a material claim. Correct and re-review the content before social delivery.");
  }
  if (gate.socialStatus !== "verified") {
    throw new Error("Use ‘Facts verified and approve’ before scheduling, sending a draft, or publishing this social post.");
  }
  if (gate.official.status === "verified") return;
  if (!gate.factsVerifiedBy?.trim() || !gate.factsVerifiedAt || !Number.isFinite(Date.parse(gate.factsVerifiedAt)) ||
      gate.factsVerificationRevision !== revision) {
    throw new Error("Social factual approval is missing a valid actor, timestamp, or current revision.");
  }
}
