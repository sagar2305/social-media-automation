-- Add an explicit "show on /welcome/campaign chooser" flag to public.campaigns.
--
-- Previously the public chooser implicitly showed campaigns that had
-- at least one saved cms_pages row. That confused the workflow: simply
-- editing a campaign's brief in /signup-control was enough to make it
-- live, with no separate "publish to creator chooser" step.
--
-- This migration adds a dedicated boolean so the workflow is explicit:
--   1. Admin adds a campaign via /campaigns/new → row inserted, but
--      show_on_chooser stays FALSE so the campaign is invisible to
--      creators.
--   2. Admin edits content in /signup-control → still invisible until
--      they explicitly toggle the "Show on chooser" switch.
--   3. Admin clicks the toggle → show_on_chooser becomes TRUE → the
--      campaign appears on /welcome/campaign.
--
-- The three originally-shipped apps (minutewise, roastai, call-recorder)
-- are backfilled to TRUE so a fresh project still has a working
-- creator funnel without any extra clicks.
--
-- Purely additive + a default-value backfill. Idempotent.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS show_on_chooser boolean NOT NULL DEFAULT false;

-- Backfill the three default campaigns as visible. This is safe to
-- re-run; non-matching rows simply aren't touched.
UPDATE public.campaigns
   SET show_on_chooser = true
 WHERE slug IN ('minutewise', 'roastai', 'call-recorder')
   AND show_on_chooser = false;

-- Rollback:
--   ALTER TABLE public.campaigns DROP COLUMN show_on_chooser;
