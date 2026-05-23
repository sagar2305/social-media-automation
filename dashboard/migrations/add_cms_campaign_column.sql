-- Multi-campaign extension for the Signup Control CMS.
--
-- Today every row in public.cms_pages and public.cms_page_versions is
-- keyed by `slug` alone, which implicitly scopes the entire CMS to the
-- Minutewise campaign. This migration adds a `campaign` column and
-- repoints the primary key to (campaign, slug) so the same 4 slugs
-- (brief, tiktok-setup, welcome, auth-form) can each store distinct
-- content for Minutewise, Roast AI, and Call Recorder.
--
-- The `welcome` slug is intentionally shared across campaigns — it's
-- the I'm-a-Creator / I'm-on-the-Team chooser shown BEFORE the user
-- picks a campaign. It gets pinned to the '_shared' sentinel value so
-- the reader doesn't have to special-case it at query time.
--
-- This migration is purely additive + a PK swap. Existing rows backfill
-- into the Minutewise campaign automatically.
--
-- Run once via Supabase Studio → SQL Editor. Idempotent.

ALTER TABLE public.cms_pages
  ADD COLUMN IF NOT EXISTS campaign text NOT NULL DEFAULT 'minutewise';
ALTER TABLE public.cms_page_versions
  ADD COLUMN IF NOT EXISTS campaign text NOT NULL DEFAULT 'minutewise';

-- The welcome slug is shared (rendered before any campaign is chosen).
-- Move any backfilled 'minutewise' welcome row to the '_shared'
-- sentinel so reads for any campaign find it.
UPDATE public.cms_pages         SET campaign = '_shared' WHERE slug = 'welcome';
UPDATE public.cms_page_versions SET campaign = '_shared' WHERE slug = 'welcome';

-- Swap the primary key from (slug) → (campaign, slug). Wrapped in
-- DO blocks so it's safe to run more than once.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cms_pages_pkey' AND conrelid = 'public.cms_pages'::regclass
  ) THEN
    -- Only drop+recreate if the existing PK is still (slug)-only.
    IF (
      SELECT array_to_string(array_agg(a.attname ORDER BY a.attnum), ',')
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.conname = 'cms_pages_pkey' AND c.conrelid = 'public.cms_pages'::regclass
    ) = 'slug' THEN
      ALTER TABLE public.cms_pages DROP CONSTRAINT cms_pages_pkey;
      ALTER TABLE public.cms_pages ADD PRIMARY KEY (campaign, slug);
    END IF;
  ELSE
    ALTER TABLE public.cms_pages ADD PRIMARY KEY (campaign, slug);
  END IF;
END $$;

-- The versions table never had a (slug)-based unique constraint — only
-- the bigserial `id` PK — so we only add a composite index for fast
-- history lookups by (campaign, slug).
CREATE INDEX IF NOT EXISTS cms_page_versions_campaign_slug_saved_at_idx
  ON public.cms_page_versions (campaign, slug, saved_at DESC);

-- Rewrite legacy welcome.creatorCard.href so the chooser is visible.
-- Pre-multi-campaign, /welcome's "I'm a Creator" card linked straight
-- to /creator/brief (Minutewise-only). Now the canonical href is
-- /welcome/campaign so the user picks which app's program they're
-- joining. Only update rows whose stored href is still the literal
-- legacy value — admins who already changed it (e.g. a campaign
-- landing-page experiment) keep their custom href.
UPDATE public.cms_pages
   SET content = jsonb_set(content, '{creatorCard,href}', '"/welcome/campaign"'::jsonb)
 WHERE slug = 'welcome'
   AND content -> 'creatorCard' ->> 'href' = '/creator/brief';

-- RLS policies from add_cms_rls.sql do not reference slug or campaign
-- columns, so they continue to work unchanged. The admin-write +
-- public-read split applies identically to every (campaign, slug) row.

-- Rollback (instant, zero data loss — restores the original single-
-- campaign layout):
--   ALTER TABLE public.cms_pages DROP CONSTRAINT cms_pages_pkey;
--   ALTER TABLE public.cms_pages ADD PRIMARY KEY (slug);
--   ALTER TABLE public.cms_pages DROP COLUMN campaign;
--   ALTER TABLE public.cms_page_versions DROP COLUMN campaign;
--   DROP INDEX IF EXISTS public.cms_page_versions_campaign_slug_saved_at_idx;
