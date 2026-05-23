-- public.cms_pages — content store for the Signup Control admin editor.
-- One row per page on the creator-facing onboarding flow. The `content`
-- JSONB column matches a typed schema defined in
-- dashboard/src/lib/cms-schemas.ts. Defaults baked into
-- dashboard/src/lib/cms-defaults.ts are rendered whenever a row is
-- missing or malformed, so this table is purely additive — the creator
-- pages keep working even before any admin saves content.
--
-- Run once via Supabase Studio → SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS public.cms_pages (
  slug        text PRIMARY KEY,
  content     jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES auth.users(id)
);

-- Touch updated_at on every UPDATE so the admin can see freshness.
CREATE OR REPLACE FUNCTION public.cms_pages_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cms_pages_touch_updated_at ON public.cms_pages;
CREATE TRIGGER cms_pages_touch_updated_at
  BEFORE UPDATE ON public.cms_pages
  FOR EACH ROW EXECUTE FUNCTION public.cms_pages_touch_updated_at();

-- Auth/role gating happens in TypeScript (assertRole('admin') in
-- dashboard/src/app/(dashboard)/signup-control/actions.ts) — matches the
-- existing pattern in this codebase. No RLS policies added here to keep
-- behaviour consistent with the other tables in the schema.
