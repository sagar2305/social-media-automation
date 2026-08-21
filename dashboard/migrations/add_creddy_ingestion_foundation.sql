-- Private, campaign-scoped storage for the Creddy news-intelligence pipeline.
--
-- This migration is additive and is NOT applied automatically. Run it in the
-- Social Automation Supabase project after reviewing it and supplying the
-- server worker with SUPABASE_SERVICE_ROLE_KEY. The separate Creddy product
-- Supabase remains read-only and is not referenced by this schema.
--
-- Data flow:
--   creddy_sources -> creddy_fetch_runs -> creddy_raw_articles
--                                      -> creddy_canonical_articles
--                                      -> creddy_article_evidence
--                                      -> creddy_review_cases (rare conflicts)

CREATE TABLE IF NOT EXISTS public.creddy_sources (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  source_key          text NOT NULL,
  name                text NOT NULL,
  base_url            text NOT NULL,
  source_class        text NOT NULL CHECK (source_class IN (
                        'specialist_publication', 'community', 'product_reference'
                      )),
  source_tier         text NOT NULL CHECK (source_tier IN ('A', 'B', 'C', 'D')),
  cadence             text NOT NULL CHECK (cadence IN ('twice_daily', 'daily', 'disabled')),
  factual_use         text NOT NULL CHECK (factual_use IN (
                        'discovery_and_confirmation', 'discovery_only', 'signal_only'
                      )),
  enabled             boolean NOT NULL DEFAULT false,
  discovery_config    jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_success_at     timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, campaign_id),
  UNIQUE (campaign_id, source_key),
  UNIQUE (campaign_id, base_url)
);

CREATE TABLE IF NOT EXISTS public.creddy_fetch_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  source_id           uuid,
  run_kind            text NOT NULL CHECK (run_kind IN (
                        'source_discovery', 'topic_search', 'article_scrape', 'manual'
                      )),
  search_query        text,
  status              text NOT NULL DEFAULT 'queued' CHECK (status IN (
                        'queued', 'running', 'succeeded', 'partially_succeeded', 'failed', 'cancelled'
                      )),
  idempotency_key     text NOT NULL,
  scheduled_for       timestamptz,
  started_at          timestamptz,
  completed_at        timestamptz,
  discovered_count    integer NOT NULL DEFAULT 0 CHECK (discovered_count >= 0),
  new_count           integer NOT NULL DEFAULT 0 CHECK (new_count >= 0),
  unchanged_count     integer NOT NULL DEFAULT 0 CHECK (unchanged_count >= 0),
  changed_count       integer NOT NULL DEFAULT 0 CHECK (changed_count >= 0),
  failed_count        integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  provider_credits    numeric(12, 4) NOT NULL DEFAULT 0 CHECK (provider_credits >= 0),
  cursor_before       jsonb,
  cursor_after        jsonb,
  error_summary       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, campaign_id),
  FOREIGN KEY (source_id, campaign_id)
    REFERENCES public.creddy_sources(id, campaign_id) ON DELETE RESTRICT,
  UNIQUE (campaign_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.creddy_raw_articles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  fetch_run_id        uuid NOT NULL,
  source_id           uuid,
  original_url        text NOT NULL,
  canonical_url       text NOT NULL,
  title               text,
  title_fingerprint   text NOT NULL DEFAULT '',
  extracted_markdown  text NOT NULL,
  content_hash        text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  published_at        timestamptz,
  source_updated_at   timestamptz,
  fetched_at          timestamptz NOT NULL DEFAULT now(),
  http_status         integer CHECK (http_status BETWEEN 100 AND 599),
  provider_metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_storage_path    text,
  change_class        text NOT NULL CHECK (change_class IN (
                        'new_url', 'unchanged', 'content_changed'
                      )),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, campaign_id),
  FOREIGN KEY (fetch_run_id, campaign_id)
    REFERENCES public.creddy_fetch_runs(id, campaign_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_id, campaign_id)
    REFERENCES public.creddy_sources(id, campaign_id) ON DELETE RESTRICT,
  UNIQUE (fetch_run_id, canonical_url, content_hash)
);

-- One row represents one deduplicated real-world event. Several publisher
-- URLs reporting the same transfer bonus or program change attach through
-- creddy_article_evidence instead of creating several content opportunities.
CREATE TABLE IF NOT EXISTS public.creddy_canonical_articles (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id               uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  story_key                 text NOT NULL,
  headline                  text NOT NULL,
  summary                   text,
  event_type                text,
  topic                     text,
  market                    text NOT NULL DEFAULT 'US' CHECK (market = 'US'),
  structured_data           jsonb NOT NULL DEFAULT '{}'::jsonb,
  claim_evidence            jsonb NOT NULL DEFAULT '[]'::jsonb,
  importance_score          numeric(5, 2) CHECK (importance_score BETWEEN 0 AND 100),
  confidence_score          numeric(5, 2) CHECK (confidence_score BETWEEN 0 AND 100),
  score_components          jsonb NOT NULL DEFAULT '{}'::jsonb,
  material_conflict         boolean NOT NULL DEFAULT false,
  conflict_changes_message  boolean NOT NULL DEFAULT false,
  verification_exhausted    boolean NOT NULL DEFAULT false,
  route                     text NOT NULL DEFAULT 'pending_analysis' CHECK (route IN (
                              'pending_analysis', 'auto_process', 'reverify', 'slack_review',
                              'evergreen_queue', 'defer', 'rejected', 'archived'
                            )),
  rejection_codes           text[] NOT NULL DEFAULT '{}'::text[],
  prompt_version            text,
  model                     text,
  first_seen_at             timestamptz NOT NULL DEFAULT now(),
  last_seen_at              timestamptz NOT NULL DEFAULT now(),
  processed_at              timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, campaign_id),
  UNIQUE (campaign_id, story_key),
  CHECK (
    route <> 'slack_review'
    OR (
      material_conflict = true
      AND conflict_changes_message = true
      AND verification_exhausted = true
      AND importance_score IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS public.creddy_article_evidence (
  campaign_id           uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  canonical_article_id  uuid NOT NULL,
  raw_article_id        uuid NOT NULL,
  evidence_role         text NOT NULL DEFAULT 'supporting' CHECK (evidence_role IN (
                          'primary', 'confirming', 'supporting', 'conflicting', 'signal'
  )),
  attached_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (canonical_article_id, raw_article_id),
  FOREIGN KEY (canonical_article_id, campaign_id)
    REFERENCES public.creddy_canonical_articles(id, campaign_id) ON DELETE CASCADE,
  FOREIGN KEY (raw_article_id, campaign_id)
    REFERENCES public.creddy_raw_articles(id, campaign_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.creddy_review_cases (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  canonical_article_id  uuid NOT NULL,
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN (
                          'pending', 'approved', 'skipped', 'held', 'expired', 'cancelled'
                        )),
  conflict_summary      text NOT NULL,
  conflicting_claims    jsonb NOT NULL DEFAULT '[]'::jsonb,
  slack_channel_id      text,
  slack_message_ts      text,
  decision_reason       text,
  decided_by            text,
  decided_at            timestamptz,
  expires_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (canonical_article_id, campaign_id)
    REFERENCES public.creddy_canonical_articles(id, campaign_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS creddy_sources_campaign_enabled_idx
  ON public.creddy_sources (campaign_id, enabled, cadence);
CREATE INDEX IF NOT EXISTS creddy_fetch_runs_campaign_created_idx
  ON public.creddy_fetch_runs (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS creddy_fetch_runs_source_created_idx
  ON public.creddy_fetch_runs (source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS creddy_raw_articles_campaign_url_idx
  ON public.creddy_raw_articles (campaign_id, canonical_url, fetched_at DESC);
CREATE INDEX IF NOT EXISTS creddy_raw_articles_content_hash_idx
  ON public.creddy_raw_articles (campaign_id, content_hash);
CREATE INDEX IF NOT EXISTS creddy_raw_articles_title_fingerprint_idx
  ON public.creddy_raw_articles (campaign_id, title_fingerprint)
  WHERE title_fingerprint <> '';
CREATE INDEX IF NOT EXISTS creddy_canonical_articles_route_score_idx
  ON public.creddy_canonical_articles (campaign_id, route, importance_score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS creddy_review_cases_pending_idx
  ON public.creddy_review_cases (campaign_id, created_at)
  WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS creddy_review_cases_one_pending_idx
  ON public.creddy_review_cases (canonical_article_id)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.creddy_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS creddy_sources_touch_updated_at ON public.creddy_sources;
CREATE TRIGGER creddy_sources_touch_updated_at
  BEFORE UPDATE ON public.creddy_sources
  FOR EACH ROW EXECUTE FUNCTION public.creddy_touch_updated_at();
DROP TRIGGER IF EXISTS creddy_fetch_runs_touch_updated_at ON public.creddy_fetch_runs;
CREATE TRIGGER creddy_fetch_runs_touch_updated_at
  BEFORE UPDATE ON public.creddy_fetch_runs
  FOR EACH ROW EXECUTE FUNCTION public.creddy_touch_updated_at();
DROP TRIGGER IF EXISTS creddy_canonical_articles_touch_updated_at ON public.creddy_canonical_articles;
CREATE TRIGGER creddy_canonical_articles_touch_updated_at
  BEFORE UPDATE ON public.creddy_canonical_articles
  FOR EACH ROW EXECUTE FUNCTION public.creddy_touch_updated_at();
DROP TRIGGER IF EXISTS creddy_review_cases_touch_updated_at ON public.creddy_review_cases;
CREATE TRIGGER creddy_review_cases_touch_updated_at
  BEFORE UPDATE ON public.creddy_review_cases
  FOR EACH ROW EXECUTE FUNCTION public.creddy_touch_updated_at();

ALTER TABLE public.creddy_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creddy_fetch_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creddy_raw_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creddy_canonical_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creddy_article_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creddy_review_cases ENABLE ROW LEVEL SECURITY;

-- No anonymous access. Background workers use the server-only service role;
-- signed-in dashboard admins receive access through these RLS policies.
REVOKE ALL ON public.creddy_sources FROM anon;
REVOKE ALL ON public.creddy_fetch_runs FROM anon;
REVOKE ALL ON public.creddy_raw_articles FROM anon;
REVOKE ALL ON public.creddy_canonical_articles FROM anon;
REVOKE ALL ON public.creddy_article_evidence FROM anon;
REVOKE ALL ON public.creddy_review_cases FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.creddy_sources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creddy_fetch_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creddy_raw_articles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creddy_canonical_articles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creddy_article_evidence TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creddy_review_cases TO authenticated;

DROP POLICY IF EXISTS creddy_sources_admin_all ON public.creddy_sources;
CREATE POLICY creddy_sources_admin_all ON public.creddy_sources
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
DROP POLICY IF EXISTS creddy_fetch_runs_admin_all ON public.creddy_fetch_runs;
CREATE POLICY creddy_fetch_runs_admin_all ON public.creddy_fetch_runs
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
DROP POLICY IF EXISTS creddy_raw_articles_admin_all ON public.creddy_raw_articles;
CREATE POLICY creddy_raw_articles_admin_all ON public.creddy_raw_articles
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
DROP POLICY IF EXISTS creddy_canonical_articles_admin_all ON public.creddy_canonical_articles;
CREATE POLICY creddy_canonical_articles_admin_all ON public.creddy_canonical_articles
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
DROP POLICY IF EXISTS creddy_article_evidence_admin_all ON public.creddy_article_evidence;
CREATE POLICY creddy_article_evidence_admin_all ON public.creddy_article_evidence
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
DROP POLICY IF EXISTS creddy_review_cases_admin_all ON public.creddy_review_cases;
CREATE POLICY creddy_review_cases_admin_all ON public.creddy_review_cases
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- Rollback (data-destructive; export first):
-- DROP TABLE public.creddy_review_cases;
-- DROP TABLE public.creddy_article_evidence;
-- DROP TABLE public.creddy_canonical_articles;
-- DROP TABLE public.creddy_raw_articles;
-- DROP TABLE public.creddy_fetch_runs;
-- DROP TABLE public.creddy_sources;
-- DROP FUNCTION public.creddy_touch_updated_at();
