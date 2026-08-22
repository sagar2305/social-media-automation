-- Cloud mirror for the file-backed Creddy Content Bank.
-- The Mac pipeline remains authoritative; authenticated dashboard users get
-- read-only access to the latest mirrored snapshot and its private media.

create table if not exists public.creddy_content_bank (
  id text primary key,
  item jsonb not null,
  assets jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  constraint creddy_content_bank_id_format
    check (id ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$')
);

alter table public.creddy_content_bank enable row level security;

drop policy if exists "Authenticated users can view Creddy cloud content" on public.creddy_content_bank;
create policy "Authenticated users can view Creddy cloud content"
  on public.creddy_content_bank
  for select
  to authenticated
  using (true);

revoke all on public.creddy_content_bank from anon;
grant select on public.creddy_content_bank to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'creddy-content',
  'creddy-content',
  false,
  10485760,
  array['image/png', 'video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Authenticated users can view Creddy media" on storage.objects;
create policy "Authenticated users can view Creddy media"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'creddy-content');

