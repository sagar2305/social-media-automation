-- Tighten storage policies for the cms-uploads bucket so only admins
-- can write to it. The previous policies allowed ANY authenticated
-- user (including creators) to upload directly to Supabase Storage,
-- bypassing the assertRole("admin") check in the server action.
--
-- Public read stays unchanged so the live creator pages can display
-- uploaded images via the bucket's public URL.
--
-- Rollback:
--   DROP POLICY IF EXISTS cms_uploads_admin_write  ON storage.objects;
--   DROP POLICY IF EXISTS cms_uploads_admin_update ON storage.objects;
--   CREATE POLICY cms_uploads_authenticated_write  ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'cms-uploads');
--   CREATE POLICY cms_uploads_authenticated_update ON storage.objects FOR UPDATE TO authenticated USING       (bucket_id = 'cms-uploads');

DROP POLICY IF EXISTS cms_uploads_authenticated_write  ON storage.objects;
DROP POLICY IF EXISTS cms_uploads_authenticated_update ON storage.objects;

CREATE POLICY cms_uploads_admin_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cms-uploads'
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

CREATE POLICY cms_uploads_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'cms-uploads'
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );
