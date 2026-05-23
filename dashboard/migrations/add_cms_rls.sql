-- Lock down public.cms_pages + public.cms_page_versions with RLS.
--
-- Policy pattern is copied character-for-character from the existing
-- `accounts` table policies which have been working in this project:
--   • public SELECT  (so anonymous visitors can render the live pages)
--   • admin-only ALL (writes go through the SSR-cookie session, which
--     identifies admins via profiles.role = 'admin')
--
-- Service role / Management API always bypasses RLS by design, so the
-- smoke-test scripts (which use the Management API) keep working.
--
-- Rollback (instant, zero data loss):
--   DROP POLICY IF EXISTS cms_pages_public_read   ON public.cms_pages;
--   DROP POLICY IF EXISTS cms_pages_admin_write   ON public.cms_pages;
--   DROP POLICY IF EXISTS cms_versions_admin_all  ON public.cms_page_versions;
--   ALTER TABLE public.cms_pages          DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.cms_page_versions  DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.cms_pages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_page_versions  ENABLE ROW LEVEL SECURITY;

-- ─── cms_pages ──────────────────────────────────────────────────
-- Everyone can read (content is public-facing copy on /creator/*).
DROP POLICY IF EXISTS cms_pages_public_read ON public.cms_pages;
CREATE POLICY cms_pages_public_read ON public.cms_pages
  FOR SELECT
  USING (true);

-- Only admins can insert/update/delete. Server actions use the
-- authenticated user's session, so the auth.uid() lookup resolves
-- to the admin who clicked Save.
DROP POLICY IF EXISTS cms_pages_admin_write ON public.cms_pages;
CREATE POLICY cms_pages_admin_write ON public.cms_pages
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ─── cms_page_versions ─────────────────────────────────────────
-- Version history is internal admin tooling — admin-only for ALL
-- operations (read and write). Public visitors never need to see
-- the history table.
DROP POLICY IF EXISTS cms_versions_admin_all ON public.cms_page_versions;
CREATE POLICY cms_versions_admin_all ON public.cms_page_versions
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
