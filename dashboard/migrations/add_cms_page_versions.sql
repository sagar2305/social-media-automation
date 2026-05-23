-- public.cms_page_versions — version snapshots for the Signup Control CMS.
-- One row per save: every time savePageContent succeeds, the previous
-- content of public.cms_pages is appended here so admins can browse
-- history and restore an earlier version. New rows have no impact on
-- the live creator pages (those only read cms_pages); this table is
-- purely a safety net.
--
-- Run once via Supabase Studio → SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS public.cms_page_versions (
  id           bigserial PRIMARY KEY,
  slug         text NOT NULL,
  content      jsonb NOT NULL,
  saved_at     timestamptz NOT NULL DEFAULT now(),
  saved_by     uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS cms_page_versions_slug_saved_at_idx
  ON public.cms_page_versions (slug, saved_at DESC);
