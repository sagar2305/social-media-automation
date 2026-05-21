-- Add columns to public.creators for the internship application data
-- captured at /creator/signup. Plaintext columns hold usernames /
-- emails / URLs; *_enc columns hold base64-encoded ciphertext produced
-- by encryptSecret() in dashboard/src/lib/credential-vault.ts.
--
-- Run once, e.g. via Supabase Studio → SQL Editor. Idempotent.

ALTER TABLE creators
  ADD COLUMN IF NOT EXISTS phone                       text,
  ADD COLUMN IF NOT EXISTS whatsapp                    text,
  ADD COLUMN IF NOT EXISTS tiktok_username             text,
  ADD COLUMN IF NOT EXISTS tiktok_password_enc         text,
  ADD COLUMN IF NOT EXISTS tiktok_email                text,
  ADD COLUMN IF NOT EXISTS tiktok_email_password_enc   text,
  ADD COLUMN IF NOT EXISTS youtube_gmail               text,
  ADD COLUMN IF NOT EXISTS youtube_password_enc        text,
  ADD COLUMN IF NOT EXISTS instagram_username          text,
  ADD COLUMN IF NOT EXISTS instagram_password_enc      text,
  ADD COLUMN IF NOT EXISTS facebook_url                text;

-- Optional: index handle/email-style columns if you'll search by them.
-- Skipped by default since the admin profile page is keyed by id.
