create table if not exists public.app_store (
  collection text primary key
    check (collection in ('products', 'users', 'orders', 'sessions')),
  records jsonb not null default '[]'::jsonb
    check (jsonb_typeof(records) = 'array'),
  updated_at timestamptz not null default now()
);

alter table public.app_store enable row level security;
revoke all on table public.app_store from anon, authenticated;
grant select, insert, update, delete on table public.app_store to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
