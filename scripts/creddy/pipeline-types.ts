import type { CreddyLegacyExpression, CreddyV4Expression } from './expression-library.js';

export const CREDDY_PIPELINE_VERSION = 1 as const;

export type CreddyPipelineStage =
  | 'collection'
  | 'filtering'
  | 'deduplication'
  | 'analysis'
  | 'content_generation'
  | 'video_rendering'
  | 'content_bank'
  | 'publishing';

export interface PipelineRunManifest {
  version: typeof CREDDY_PIPELINE_VERSION;
  runId: string;
  campaignSlug: 'credit-card-rewards';
  stage: CreddyPipelineStage;
  status: 'running' | 'completed' | 'partially_completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  inputCount: number;
  outputCount: number;
  skippedCount: number;
  failedCount: number;
  providerUsage?: {
    firecrawl: {
      scrapeRequests: number;
      scrapeSuccesses: number;
      scrapeFailures: number;
      searchRequests: number;
      searchSuccesses: number;
      searchFailures: number;
      reportedCredits?: number;
      responsesReportingCredits: number;
      creditsComplete: boolean;
    };
  };
  providerCredits?: number;
  errors: string[];
}

export interface SourceCollectionResult {
  sourceId: string;
  sourceName: string;
  configuredUrl: string;
  provider: 'firecrawl' | 'reddit_rss' | 'reddit_rss_fallback' | 'youtube_rss';
  status: 'completed' | 'completed_with_fallback' | 'failed';
  discoveredCount: number;
  error?: string;
}

export interface TopicSearchCollectionResult {
  id?: string;
  query: string;
  intent?: 'timely' | 'evergreen' | 'experimental';
  provider: 'firecrawl';
  status: 'completed' | 'failed';
  discoveredCount: number;
  error?: string;
}

export interface DiscoveryCandidateRecord {
  url: string;
  sourceId: string;
  sourceName: string;
  searchQuery?: string;
  queryId?: string;
  queryIntent?: 'timely' | 'evergreen' | 'experimental';
  /** Immutable publisher lane used when the pre-scrape selector enforced caps. */
  publisherKey?: string;
  /** Informational identity resolved from the completed article scrape. */
  resolvedPublisherKey?: string;
  eventFingerprint?: string;
  resolvedEventFingerprint?: string;
  discoveredTitle?: string;
  discoveredDescription?: string;
  discoveryClass?: 'core' | 'adjacent' | 'low_relevance';
  selectionReason?: string;
  disposition:
    | 'selected_for_scrape'
    | 'recently_checked'
    | 'deferred_capacity'
    | 'deferred_low_relevance'
    | 'stored_raw'
    | 'unchanged'
    | 'scrape_failed';
  rawRecordId?: string;
  error?: string;
}

export interface DiscoveryRunRecord {
  version: typeof CREDDY_PIPELINE_VERSION;
  runId: string;
  createdAt: string;
  candidateCount: number;
  scrapeLimit: number;
  sourceResults?: SourceCollectionResult[];
  topicSearchResults?: TopicSearchCollectionResult[];
  inactiveTopicSearchIds?: string[];
  candidates: DiscoveryCandidateRecord[];
}

export interface RawArticleRecord {
  version: typeof CREDDY_PIPELINE_VERSION;
  id: string;
  runId: string;
  sourceId: string;
  sourceName: string;
  sourceTier: 'B' | 'C' | 'D';
  factualUse: 'discovery_and_confirmation' | 'discovery_only' | 'signal_only';
  originalUrl: string;
  canonicalUrl: string;
  title: string;
  markdown: string;
  contentHash: string;
  titleFingerprint: string;
  fetchedAt: string;
  publishedAt?: string;
  providerMetadata: Record<string, unknown>;
}

export interface FilteredArticleRecord extends RawArticleRecord {
  qualification: {
    qualifies: true;
    matchedKeywords: string[];
    filterRunId?: string;
    filteredAt?: string;
  };
}

export interface RejectedArticleRecord {
  version: typeof CREDDY_PIPELINE_VERSION;
  id: string;
  sourceRecordId: string;
  canonicalUrl: string;
  rejectedAt: string;
  filterRunId?: string;
  dedupeRunId?: string;
  reason:
    | 'keyword_gate'
    | 'non_article'
    | 'insufficient_content'
    | 'invalid_source_response'
    | 'duplicate_url'
    | 'duplicate_content'
    | 'duplicate_title'
    | 'wrong_market'
    | 'irrelevant'
    | 'expired'
    | 'unsupported_claim'
    | 'low_value';
  details?: string;
}

export interface CanonicalNewsRecord extends FilteredArticleRecord {
  canonicalId: string;
  evidenceRecordIds: string[];
  cleanedMarkdown: string;
  deduplicatedAt: string;
  verification?: {
    status: 'corroborated' | 'single_source_unverified' | 'community_signal_only';
    evidenceSourceIds: string[];
    requiresFactCheck: boolean;
    reasons: string[];
  };
}

export interface AnalysisTaskRecord {
  version: typeof CREDDY_PIPELINE_VERSION;
  id: string;
  canonicalId: string;
  queuedAt: string;
  instructionsVersion: 'creddy-analysis-v1' | 'creddy-ranking-v2' | 'creddy-ranking-v3';
  /** Identifies the Agent 03 batch so only that run's diversified slate is
   * selected for the bounded official-verification pass. */
  queueRunId?: string;
  /** Present only for an audited retry of a retained official conflict. The
   * prior official evidence is context for correction, never an automatic
   * replacement for a fresh official verification pass. */
  correctionContext?: {
    historyId: string;
    reopenedBy: string;
    reopenedAt: string;
    reason: string;
    originalAnalysisBatchId: string;
    originalPortfolioRank: number;
    priorOfficialVerification: CreddyOfficialVerificationRecord;
  };
  article: CanonicalNewsRecord;
}

export type CreddyOfficialVerificationStatus =
  | 'verified'
  | 'inconclusive'
  | 'conflicting'
  | 'unavailable';

export interface CreddyOfficialEvidence {
  url: string;
  owner: string;
  sourceType: 'issuer' | 'airline' | 'hotel' | 'loyalty_program' | 'airport' | 'government';
}

export interface CreddyOfficialClaimOutcome {
  field: string;
  status: 'verified' | 'unresolved' | 'conflicting' | 'not_found';
  officialUrls: string[];
  notes: string;
}

export interface CreddyOfficialVerificationRecord {
  version: 1;
  id: string;
  decisionId: string;
  canonicalId: string;
  checkedAt: string;
  status: CreddyOfficialVerificationStatus;
  attemptedUrls: string[];
  evidence: CreddyOfficialEvidence[];
  claimOutcomes: CreddyOfficialClaimOutcome[];
  remainingRequirements: string[];
  failureReasons: string[];
}

export interface CreddyVerificationGate {
  portfolioRank: number;
  selectedAt: string;
  official: CreddyOfficialVerificationRecord;
  socialStatus: 'verified' | 'manual_confirmation_required' | 'conflicting';
  factsVerifiedBy?: string;
  factsVerifiedAt?: string;
  factsVerificationRevision?: number;
}

export interface OfficialVerificationTaskRecord {
  version: 1;
  id: string;
  portfolioRank: number;
  selectedAt: string;
  decision: AnalysisDecisionRecord;
  article: CanonicalNewsRecord;
}

export type CreddyAnalysisRoute =
  | 'auto_process'
  | 'reverify'
  | 'slack_review'
  | 'evergreen_queue'
  | 'defer'
  | 'rejected'
  | 'archived';

export interface CreddyClaim {
  field: string;
  value: string | number | boolean | null;
  sourceRecordIds: string[];
  confidence: number;
  conflict?: string;
}

export interface AnalysisDecisionRecord {
  version: typeof CREDDY_PIPELINE_VERSION;
  id: string;
  canonicalId: string;
  analyzedAt: string;
  market: 'US';
  headline: string;
  summary: string;
  eventType: string;
  topic: string;
  affectedPrograms: string[];
  requiredAction: string | null;
  expiry: string | null;
  claims: CreddyClaim[];
  /** Mandatory Creddy editorial fit. General deals do not qualify merely
   * because they contain a rewards keyword. */
  productFitScore?: number;
  /** Estimated audience-interest potential, not measured social engagement. */
  popularityScore?: number;
  /** Ranking v3 separates editorial upside from factual readiness. */
  rubricVersion?: 'creddy-ranking-v3';
  viralPotential?: {
    score: number;
    hookStrength: number;
    audienceBreadth: number;
    financialMagnitude: number;
    novelty: number;
    urgency: number;
    practicalUtility: number;
    visualPotential: number;
    discussionPotential: number;
    emotionalAspiration: number;
    shareSavePotential: number;
    reasons: string[];
  };
  channelScores?: {
    instagramTikTok: number;
    blogSeo: number;
    newsletter: number;
    evergreen: number;
  };
  freshnessScore?: number;
  editorialPriorityScore?: number;
  editorialDisposition?: 'produce' | 'evergreen' | 'defer' | 'reject';
  verificationState?: 'ready' | 'official_source_needed' | 'independent_confirmation_needed' | 'community_signal_only';
  verificationRequirements?: string[];
  hookType?: string;
  hookRationale?: string;
  portfolioCategory?: 'card_offer' | 'loyalty_news' | 'redemption' | 'travel_development' | 'evergreen_education';
  importanceScore: number;
  confidenceScore: number;
  importanceReasons: string[];
  confidenceReasons: string[];
  materialConflict: boolean;
  conflictChangesMessage: boolean;
  verificationExhausted: boolean;
  route: CreddyAnalysisRoute;
  rejectionReasons: string[];
  evidenceRecordIds: string[];
  /** Added durably by accept-analysis; legacy decisions omit it. */
  analysisBatchId?: string;
  /** Stable hash of the canonical article and evidence revision ranked by
   * Agent 03. A changed hash requeues only this canonical item. */
  analysisInputHash?: string;
  /** Explicit time horizon used by the rolling editorial queue. New ranking-v3
   * decisions should provide it; legacy records are classified conservatively. */
  freshnessClass?: 'breaking' | 'time_sensitive' | 'timely' | 'evergreen';
  /** First trustworthy occurrence of the material event, distinct from when a
   * publisher page was fetched. Required for unattended breaking delivery. */
  eventOccurredAt?: string;
  /** Concrete material change. Generic commentary can never use the urgent
   * unattended publication lane. */
  materialEventType?:
    | 'issuer_or_program_change'
    | 'offer_change'
    | 'deadline'
    | 'devaluation'
    | 'outage'
    | 'benefit_or_eligibility_change'
    | 'other_actionable_change';
  /** Present only after the rolling selector explicitly permits Agent 04 to
   * create content. Rankings alone never authorize expensive production. */
  productionAuthorization?: CreddyProductionAuthorization;
  /** Copied immutably from an audited conflict-reanalysis task. */
  correctionContext?: AnalysisTaskRecord['correctionContext'];
  /** Present only after a bounded official-verification task completed. */
  verificationGate?: CreddyVerificationGate;
}

export interface CreddyProductionAuthorization {
  version: 1;
  id: string;
  canonicalId: string;
  decisionId: string;
  analysisInputHash: string;
  decisionHash: string;
  officialVerificationHash: string;
  selectedAt: string;
  expiresAt?: string;
  lane: 'urgent' | 'daily' | 'hourly_blog';
  distributionMode: CreddyDistributionMode;
  reason: string;
  approvalMode: 'auto_urgent' | 'human_review';
  selectionRunId: string;
}

export interface AnalysisPerformanceFeedbackRecord {
  version: typeof CREDDY_PIPELINE_VERSION;
  id: string;
  canonicalId: string;
  recordedAt: string;
  channel: 'instagram_tiktok' | 'blog_seo' | 'newsletter' | 'evergreen';
  editorialVerdict?: 'promote' | 'accurate' | 'demote';
  views?: number;
  watchTimeSeconds?: number;
  shares?: number;
  saves?: number;
  comments?: number;
  clicks?: number;
  conversions?: number;
  note?: string;
}

export interface ContentPackageRecord {
  version: typeof CREDDY_PIPELINE_VERSION;
  /** Binds current-workflow output to its Agent 03 batch. Missing only on legacy records. */
  analysisBatchId?: string;
  distributionMode?: CreddyDistributionMode;
  productionAuthorization?: CreddyProductionAuthorization;
  contentDraftId?: string;
  id: string;
  analysisId: string;
  canonicalId: string;
  createdAt: string;
  audience: string;
  slot: 'act_now' | 'understand' | 'decide_or_discuss';
  hook: string;
  scriptLines: string[];
  caption: string;
  platformCaptions?: {
    instagram: string;
    tiktok: string;
  };
  hashtags: string[];
  cta: {
    label: string;
    deepLink: string;
    fallbackUrl?: string;
    kind?: 'product' | 'engagement';
    messageId?: CreddyCtaMessageId;
    capabilityId?: CreddyCapabilityId;
  };
  imagePrompts: string[];
  imagePaths?: string[];
  /** One Creddy mascot expression per script scene. Video Factory resolves
   * these symbolic names through the campaign character manifest. */
  characterExpressions?: CreddyCharacterExpression[];
  narrationLines?: string[];
  visualPlanId?: string;
  visualTheme?: CreddyVisualTheme;
  brief: string;
  sourceUrls: string[];
  factualClaims: CreddyClaim[];
  verificationGate?: CreddyVerificationGate;
  /** The website article travels with the same production package as social
   * assets. It is optional only for legacy packages. */
  article?: CreddyArticleDraft;
  articleVisuals?: CreddyArticleVisualPlan;
  articlePreviewPath?: string;
  articleReadiness?: 'needs_assets' | 'ready_for_review';
}

export type CreddyArticleCategory =
  | 'card_offers'
  | 'benefits'
  | 'points_and_miles'
  | 'loyalty_news'
  | 'award_travel'
  | 'guides';

export type CreddyArticleBlock =
  | { id: string; type: 'paragraph'; text: string; claimFields: string[] }
  | { id: string; type: 'heading'; level: 2 | 3; text: string }
  | { id: string; type: 'key_takeaways'; title: string; items: string[]; claimFields: string[] }
  | { id: string; type: 'callout'; tone: 'tip' | 'warning' | 'decision'; title: string; body: string; claimFields: string[] }
  | { id: string; type: 'comparison_table'; caption: string; columns: string[]; rows: string[][]; claimFields: string[] }
  | { id: string; type: 'visual'; visualId: string; caption: string }
  | { id: string; type: 'referral_card'; referralId: string; title: string; body: string; ctaLabel: string; claimFields: string[] }
  | { id: string; type: 'faq'; items: Array<{ question: string; answer: string; claimFields: string[] }> }
  | { id: string; type: 'subscribe'; title: string; body: string; consentLabel: string }
  | { id: string; type: 'download'; title: string; body: string; iosUrl: string; androidUrl: string };

export interface CreddyArticleDraft {
  version: 'creddy-article-v1';
  designVersion: 'creddy-guides-v1';
  id: string;
  slug: string;
  category: CreddyArticleCategory;
  title: string;
  dek: string;
  excerpt: string;
  seoTitle: string;
  seoDescription: string;
  authorName: 'Creddy Editorial';
  createdAt: string;
  updatedAt: string;
  readingMinutes: number;
  heroVisualId: string;
  blocks: CreddyArticleBlock[];
  sourceUrls: string[];
  referralDisclosure: string;
}

export type CreddyArticleVisualAsset = {
  id: string;
  usage: 'hero' | 'inline' | 'comparison';
  articleBlockId: string;
  assetType: 'editorial_illustration' | 'data_visualization' | 'licensed_photo' | 'creddy_product_capture';
  aspectRatio: '16:9' | '4:3' | '1:1';
  generationMode: 'generate' | 'compose' | 'supply';
  /** Identical art direction shared by every generated image in one article. */
  seriesStyle?: string;
  prompt?: string;
  negativePrompt?: string;
  altText: string;
  caption: string;
  claimFields: string[];
  assetPath?: string;
  provenance?: string;
};

export interface CreddyArticleVisualPlan {
  version: 'creddy-article-visuals-v1';
  designVersion: 'creddy-guides-v1';
  /** New Agent 05 plans lock the approved website presentation. Omitted only
   * on legacy plans created before the abstract editorial block was approved. */
  imageBlockStyle?: 'creddy-abstract-editorial-v1';
  assets: CreddyArticleVisualAsset[];
}

export interface ContentDraftRecord {
  version: typeof CREDDY_PIPELINE_VERSION;
  /** Binds current-workflow output to its Agent 03 batch. Missing only on legacy records. */
  analysisBatchId?: string;
  distributionMode?: CreddyDistributionMode;
  productionAuthorization?: CreddyProductionAuthorization;
  /** New Agent 04 drafts use the claim-traceable concept contract. Omitted only
   * on legacy drafts that remain readable by downstream stages. */
  copyVersion?: 'creddy-copy-v2' | 'creddy-copy-v3';
  id: string;
  analysisId: string;
  canonicalId: string;
  createdAt: string;
  audience: string;
  slot: 'act_now' | 'understand' | 'decide_or_discuss';
  hook: string;
  conceptPack?: ContentConceptPack;
  textScenes: string[];
  narrationScript: string;
  instagramCaption: string;
  tiktokCaption: string;
  hashtags: string[];
  cta: {
    label: string;
    deepLink: string;
    fallbackUrl?: string;
    /** Agent 04 v2 drafts must select an approved truthful CTA. Legacy
     * drafts remain readable without these fields. */
    kind?: 'product' | 'engagement';
    messageId?: CreddyCtaMessageId;
    capabilityId?: CreddyCapabilityId;
  };
  brief: string;
  sourceUrls: string[];
  factualClaims: CreddyClaim[];
  verificationGate?: CreddyVerificationGate;
  /** Agent 04 writes the complete Creddy guide in the same record as social
   * copy. Omitted only on legacy drafts retained for audit. */
  article?: CreddyArticleDraft;
}

export type CreddyCapabilityId =
  | 'general_card_value'
  | 'benefit_credit_tracking'
  | 'welcome_offer_progress'
  | 'renewal_tracking'
  | 'loyalty_wallet'
  | 'voucher_wallet';

export type CreddyCtaMessageId =
  | 'general-get-more-from-cards'
  | 'benefits-see-used-and-remaining'
  | 'benefits-track-before-reset'
  | 'welcome-see-progress-and-time'
  | 'renewal-review-benefits-and-timing'
  | 'loyalty-organize-points-and-status'
  | 'vouchers-organize-and-track-expiry'
  | 'engagement-save-award-checklist'
  | 'engagement-ask-audience-choice'
  | 'engagement-follow-creddy';

export type ContentConceptStyle =
  | 'specific_payoff'
  | 'loss_avoidance'
  | 'surprising_result'
  | 'contrast'
  | 'decision_question'
  | 'timely_change'
  | 'myth_correction';

export interface ContentConceptCandidate {
  id: string;
  style: ContentConceptStyle;
  concept: string;
  promise: string;
  supportingClaimFields: string[];
  /** Optional current research pattern. At most one of the four candidates may
   * use a trend pattern so stable editorial judgment remains the default. */
  trendPatternId?: string;
}

export interface ClaimTracedCopy {
  claimFields: string[];
}

export interface ContentConceptPack {
  trendSnapshotId?: string;
  /** Short standalone identity used in every platform title/cover, such as
   * "Citi AAdvantage Executive" or "Award tool". */
  subjectLabel: string;
  candidates: ContentConceptCandidate[];
  selectedCandidateId: string;
  selectionRationale: string;
  rejectionReasons: Array<{ candidateId: string; reason: string }>;
  resolution: { slideNumber: 2 | 3; slideExcerpt: string; explanation: string };
  fulfillment: {
    slideNumbers: number[];
    narrationExcerpt: string;
    instagramCaptionExcerpt: string;
    tiktokCaptionExcerpt: string;
  };
  platforms: {
    blog: ClaimTracedCopy & { headline: string; lede: string };
    newsletter: ClaimTracedCopy & { subject: string; preheader: string };
    youtubeLong: ClaimTracedCopy & { title: string; thumbnailPhrase: string; openingLine: string };
    youtubeShort: ClaimTracedCopy & { title: string; openingLine: string };
    instagram: ClaimTracedCopy & { coverHook: string; captionOpener: string };
    tiktok: ClaimTracedCopy & { coverHook: string; captionOpener: string };
  };
}

export interface ContentOpportunityTaskRecord {
  decision: AnalysisDecisionRecord;
  article: CanonicalNewsRecord;
  distributionMode: CreddyDistributionMode;
}

export type CreddyDistributionMode = 'article_only' | 'article_and_social';

export type CreddyVisualTheme = 'editorial' | 'midnight' | 'ledger' | 'poster' | 'aurora';

export interface VisualScenePlan {
  sceneIndex: number;
  text: string;
  role: 'hook' | 'fact' | 'context' | 'caution' | 'cta';
  expression: CreddyCharacterExpression;
  emphasis: string[];
  background: {
    mode: 'template' | 'generated_illustration';
    prompt?: string;
    style?: 'spotlight' | 'deep_navy' | 'forest' | 'burgundy';
  };
}

export interface VisualPlanRecord {
  version: typeof CREDDY_PIPELINE_VERSION;
  /** Binds current-workflow output to its Agent 03 batch. Missing only on legacy records. */
  analysisBatchId?: string;
  distributionMode?: CreddyDistributionMode;
  productionAuthorization?: CreddyProductionAuthorization;
  id: string;
  contentDraftId: string;
  analysisId: string;
  canonicalId: string;
  createdAt: string;
  format: '9:16' | '3:4' | 'article';
  theme: CreddyVisualTheme;
  characterPack: 'credit-card-rewards/creddy';
  /** Required for the locked 3:4 slideshow and selected from the approved
   * CTA capability rather than guessed by the renderer. */
  phoneTemplateId?: 'wallet_vouchers' | 'spend_goals' | 'app_store_dark' | 'app_store_light';
  cover: { headline: string; subheadline: string };
  scenes: VisualScenePlan[];
  visualBrief: string;
  safetyOverlays: string[];
  sourceUrls: string[];
  factualClaims: CreddyClaim[];
  verificationGate?: CreddyVerificationGate;
  /** Agent 05 plans website and social visuals together. */
  articleVisuals?: CreddyArticleVisualPlan;
}

export interface VisualPlanningTaskRecord {
  draft: ContentDraftRecord;
}

export type CreddyCharacterExpression = CreddyV4Expression | CreddyLegacyExpression;

export interface VideoJobRecord {
  version: typeof CREDDY_PIPELINE_VERSION;
  id: string;
  contentPackageId: string;
  revision: number;
  format: 'text_music' | 'narrated';
  videoFactoryJobId?: string;
  status: 'queued' | 'submitted' | 'rendering' | 'done' | 'failed';
  createdAt: string;
  updatedAt: string;
  outputPath?: string;
  error?: string;
}

export interface ContentBankRecord {
  version: typeof CREDDY_PIPELINE_VERSION;
  /** Binds current-workflow output to its Agent 03 batch. Missing only on legacy records. */
  analysisBatchId?: string;
  productionAuthorization?: CreddyProductionAuthorization;
  id: string;
  contentPackageId: string;
  mediaType?: 'video' | 'slideshow' | 'article';
  contentDraftId?: string;
  visualPlanId?: string;
  slideshowManifestPath?: string;
  slideImagePaths?: string[];
  slideCount?: number;
  articlePreviewPath?: string;
  articleReview?: {
    status: 'needs_assets' | 'pending_review' | 'changes_requested' | 'approved' | 'publishing' | 'published' | 'publish_failed' | 'unpublished';
    approvedBy?: string;
    approvedAt?: string;
    approvedContentSha256?: string;
    publishingStartedAt?: string;
    publishAttemptedAt?: string;
    publishAttempts?: number;
    publishError?: string;
    cmsIdentifier?: string;
    publishedAt?: string;
    publishedUrl?: string;
    unpublishedBy?: string;
    unpublishedAt?: string;
    requestedBy?: string;
    requestedAt?: string;
    changeNotes?: string;
    blockers?: string[];
    seoReview?: {
      status: 'pass' | 'needs_changes';
      reviewedAt: string;
      reportPath: string;
      contentSha256: string;
      warnings: string[];
    };
  };
  createdAt: string;
  updatedAt?: string;
  status: 'pending_review' | 'changes_requested' | 'rendering_revision' | 'approved' | 'scheduled' | 'published' | 'rejected';
  textMusicVideoPath?: string;
  narratedVideoPath?: string;
  revision: number;
  verificationGate?: CreddyVerificationGate;
  approvedBy?: string;
  approvedAt?: string;
  /** Distinguishes an audited unattended breaking-news policy decision from a
   * human approval. Never synthesize a human actor for auto_urgent. */
  approvalMode?: 'auto_urgent' | 'human_review';
  changeRequest?: {
    requestedBy: string;
    requestedAt: string;
    notes: string;
  };
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  destinations?: Array<{
    format: 'text_music' | 'narrated' | 'article';
    platform: 'instagram' | 'tiktok' | 'creddy_website';
    account: string;
    scheduledFor: string;
    mode?: 'tiktok_draft' | 'schedule' | 'publish_now';
    status: 'pending' | 'submitted' | 'draft_sent' | 'scheduled' | 'publishing' | 'published' | 'failed';
    submissionId?: string;
    mediaUrl?: string;
    publishedUrl?: string;
    error?: string;
    submittedAt?: string;
    publishedAt?: string;
    lastCheckedAt?: string;
  }>;
}
