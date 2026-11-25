alter table public.app_store drop constraint if exists app_store_collection_check;
alter table public.app_store add constraint app_store_collection_check
  check (collection in ('products', 'users', 'orders', 'sessions', 'riders', 'payout_requests', 'support', 'campaigns'));
