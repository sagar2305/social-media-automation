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
  instructionsVersion: 'creddy-analysis-v1' | 'creddy-ranking-v2';
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
}

export interface ContentPackageRecord {
  version: typeof CREDDY_PIPELINE_VERSION;
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
}

export interface ContentDraftRecord {
  version: typeof CREDDY_PIPELINE_VERSION;
  id: string;
  analysisId: string;
  canonicalId: string;
  createdAt: string;
  audience: string;
  slot: 'act_now' | 'understand' | 'decide_or_discuss';
  hook: string;
  textScenes: string[];
  narrationScript: string;
  instagramCaption: string;
  tiktokCaption: string;
  hashtags: string[];
  cta: {
    label: string;
    deepLink: string;
    fallbackUrl?: string;
  };
  brief: string;
  sourceUrls: string[];
  factualClaims: CreddyClaim[];
}

export interface ContentOpportunityTaskRecord {
  decision: AnalysisDecisionRecord;
  article: CanonicalNewsRecord;
}

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
  };
}

export interface VisualPlanRecord {
  version: typeof CREDDY_PIPELINE_VERSION;
  id: string;
  contentDraftId: string;
  analysisId: string;
  canonicalId: string;
  createdAt: string;
  format: '9:16' | '3:4';
  theme: CreddyVisualTheme;
  characterPack: 'credit-card-rewards/creddy';
  cover: { headline: string; subheadline: string };
  scenes: VisualScenePlan[];
  visualBrief: string;
  safetyOverlays: string[];
  sourceUrls: string[];
  factualClaims: CreddyClaim[];
}

export interface VisualPlanningTaskRecord {
  draft: ContentDraftRecord;
}

export type CreddyCharacterExpression =
  | 'neutral'
  | 'waving'
  | 'thinking'
  | 'confused'
  | 'idea'
  | 'worried'
  | 'surprised'
  | 'sleepy'
  | 'sad'
  | 'wink'
  | 'card'
  | 'thumbs-up'
  | 'guide'
  | 'rewards'
  | 'celebrate'
  | 'curious'
  | 'skeptical'
  | 'pointing'
  | 'happy'
  | 'urgent'
  // Legacy names remain readable; the Video Factory adapter maps them to
  // the exact Creddy asset pack pose names before rendering.
  | 'excited'
  | 'concerned'
  | 'celebrating'
  | 'explaining'
  | 'starstruck';

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
  id: string;
  contentPackageId: string;
  mediaType?: 'video' | 'slideshow';
  contentDraftId?: string;
  visualPlanId?: string;
  slideshowManifestPath?: string;
  slideImagePaths?: string[];
  slideCount?: number;
  createdAt: string;
  status: 'pending_review' | 'changes_requested' | 'rendering_revision' | 'approved' | 'scheduled' | 'published' | 'rejected';
  textMusicVideoPath?: string;
  narratedVideoPath?: string;
  revision: number;
  approvedBy?: string;
  approvedAt?: string;
  changeRequest?: {
    requestedBy: string;
    requestedAt: string;
    notes: string;
  };
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  destinations?: Array<{
    format: 'text_music' | 'narrated';
    platform: 'instagram' | 'tiktok';
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
