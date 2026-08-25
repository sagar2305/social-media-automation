import type {
  ContentDraftRecord,
  CreddyCapabilityId,
  CreddyCtaMessageId,
  VisualPlanRecord,
} from './pipeline-types.js';

export type CreddyPhoneTemplateId = NonNullable<VisualPlanRecord['phoneTemplateId']>;

export type CreddyCapability = {
  id: CreddyCapabilityId;
  publicEvidence: string;
  phoneTemplateId: CreddyPhoneTemplateId;
  messageIds: CreddyCtaMessageId[];
};

export type CreddyCtaMessage = {
  id: CreddyCtaMessageId;
  kind: 'product' | 'engagement';
  capabilityId?: CreddyCapabilityId;
  text: string;
  deepLink: 'creddy://home';
  fallbackUrl?: string;
  phoneTemplateId: CreddyPhoneTemplateId;
};

/**
 * Public-production capability evidence. Development-only flags and UUID-only
 * detail routes are intentionally excluded from social promises.
 */
export const CREDDY_PRODUCT_REGISTRY = {
  version: '2026-08-25',
  verifiedAt: '2026-08-25T00:00:00.000Z',
  reviewAfter: '2026-09-25T00:00:00.000Z',
  ios: {
    appId: '6768603911',
    bundleId: 'com.thebrewapps.creddy',
    publicVersion: '1.0.2',
    releasedAt: '2026-08-23T01:49:47.000Z',
  },
  android: {
    packageId: 'com.thebrewapps.creddy',
    publicUpdatedAt: '2026-08-08',
  },
} as const;

export const CREDDY_CAPABILITIES: Record<CreddyCapabilityId, CreddyCapability> = {
  general_card_value: {
    id: 'general_card_value',
    publicEvidence: 'Public listings describe a consolidated view of card benefits and credits.',
    phoneTemplateId: 'app_store_dark',
    messageIds: ['general-get-more-from-cards'],
  },
  benefit_credit_tracking: {
    id: 'benefit_credit_tracking',
    publicEvidence: 'Public listings show used value, remaining value, reset timing, and benefit logging.',
    phoneTemplateId: 'spend_goals',
    messageIds: ['benefits-see-used-and-remaining', 'benefits-track-before-reset'],
  },
  welcome_offer_progress: {
    id: 'welcome_offer_progress',
    publicEvidence: 'Public listings describe minimum-spend progress and deadline reminders.',
    phoneTemplateId: 'spend_goals',
    messageIds: ['welcome-see-progress-and-time'],
  },
  renewal_tracking: {
    id: 'renewal_tracking',
    publicEvidence: 'Public listings describe renewal reminders before an annual fee posts.',
    phoneTemplateId: 'spend_goals',
    messageIds: ['renewal-review-benefits-and-timing'],
  },
  loyalty_wallet: {
    id: 'loyalty_wallet',
    publicEvidence: 'Public listings describe points, miles, and elite-status balances in one wallet.',
    phoneTemplateId: 'wallet_vouchers',
    messageIds: ['loyalty-organize-points-and-status'],
  },
  voucher_wallet: {
    id: 'voucher_wallet',
    publicEvidence: 'The public app includes voucher tracking and expiration state.',
    phoneTemplateId: 'wallet_vouchers',
    messageIds: ['vouchers-organize-and-track-expiry'],
  },
};

export const CREDDY_CTA_MESSAGES: Record<CreddyCtaMessageId, CreddyCtaMessage> = {
  'general-get-more-from-cards': {
    id: 'general-get-more-from-cards', kind: 'product', capabilityId: 'general_card_value',
    text: 'Get more from the cards you already carry with Creddy.',
    deepLink: 'creddy://home', phoneTemplateId: 'app_store_dark',
  },
  'benefits-see-used-and-remaining': {
    id: 'benefits-see-used-and-remaining', kind: 'product', capabilityId: 'benefit_credit_tracking',
    text: 'See which card benefits you have used and what remains in Creddy.',
    deepLink: 'creddy://home', phoneTemplateId: 'spend_goals',
  },
  'benefits-track-before-reset': {
    id: 'benefits-track-before-reset', kind: 'product', capabilityId: 'benefit_credit_tracking',
    text: 'Track your card credits before they reset with Creddy.',
    deepLink: 'creddy://home', phoneTemplateId: 'spend_goals',
  },
  'welcome-see-progress-and-time': {
    id: 'welcome-see-progress-and-time', kind: 'product', capabilityId: 'welcome_offer_progress',
    text: 'See your welcome-offer progress and time left in Creddy.',
    deepLink: 'creddy://home', phoneTemplateId: 'spend_goals',
  },
  'renewal-review-benefits-and-timing': {
    id: 'renewal-review-benefits-and-timing', kind: 'product', capabilityId: 'renewal_tracking',
    text: 'Review your card benefits and renewal timing in Creddy.',
    deepLink: 'creddy://home', phoneTemplateId: 'spend_goals',
  },
  'loyalty-organize-points-and-status': {
    id: 'loyalty-organize-points-and-status', kind: 'product', capabilityId: 'loyalty_wallet',
    text: 'Keep your points, miles, and loyalty status organized in Creddy.',
    deepLink: 'creddy://home', phoneTemplateId: 'wallet_vouchers',
  },
  'vouchers-organize-and-track-expiry': {
    id: 'vouchers-organize-and-track-expiry', kind: 'product', capabilityId: 'voucher_wallet',
    text: 'Keep your card vouchers and expiration dates organized in Creddy.',
    deepLink: 'creddy://home', phoneTemplateId: 'wallet_vouchers',
  },
  'engagement-save-award-checklist': {
    id: 'engagement-save-award-checklist', kind: 'engagement',
    text: 'Save this checklist, then verify every award with the airline.',
    deepLink: 'creddy://home', phoneTemplateId: 'app_store_dark',
  },
  'engagement-ask-audience-choice': {
    id: 'engagement-ask-audience-choice', kind: 'engagement',
    text: 'Which option would you choose? Tell us below.',
    deepLink: 'creddy://home', phoneTemplateId: 'app_store_light',
  },
  'engagement-follow-creddy': {
    id: 'engagement-follow-creddy', kind: 'engagement',
    text: 'Follow Creddy for more points-and-miles decisions.',
    deepLink: 'creddy://home', phoneTemplateId: 'app_store_dark',
  },
};

export function selectedCtaMessage(draft: Pick<ContentDraftRecord, 'cta'>): CreddyCtaMessage {
  const id = draft.cta.messageId;
  if (!id || !(id in CREDDY_CTA_MESSAGES)) throw new Error('Agent 04 requires an approved CTA messageId');
  return CREDDY_CTA_MESSAGES[id];
}

export function validateApprovedCta(
  draft: Pick<ContentDraftRecord, 'copyVersion' | 'cta' | 'textScenes'>,
  now?: Date,
): void {
  if (draft.copyVersion !== 'creddy-copy-v2') return;
  const message = selectedCtaMessage(draft as Pick<ContentDraftRecord, 'cta'>);
  if (message.kind === 'product' && now && now.getTime() > Date.parse(CREDDY_PRODUCT_REGISTRY.reviewAfter)) {
    throw new Error('Creddy product capability registry is stale and must be reviewed before new Agent 04 copy');
  }
  if (draft.cta.kind !== message.kind || draft.cta.label !== message.text ||
      draft.cta.deepLink !== message.deepLink || draft.cta.fallbackUrl !== message.fallbackUrl) {
    throw new Error('CTA must match one approved current Creddy message exactly');
  }
  if (message.kind === 'product') {
    if (draft.cta.capabilityId !== message.capabilityId) {
      throw new Error('Product CTA capability does not match its approved message');
    }
    const capability = CREDDY_CAPABILITIES[message.capabilityId!];
    if (!capability.messageIds.includes(message.id)) {
      throw new Error('CTA message is not approved for the selected capability');
    }
  } else if (draft.cta.capabilityId !== undefined) {
    throw new Error('Engagement CTAs cannot claim a Creddy product capability');
  }
  if (draft.textScenes.length !== 6 || draft.textScenes[5] !== message.text) {
    throw new Error('Slide 6 must equal the approved CTA message exactly');
  }
}

export function phoneTemplateForDraft(draft: Pick<ContentDraftRecord, 'cta'>): CreddyPhoneTemplateId {
  return selectedCtaMessage(draft).phoneTemplateId;
}
