-- One private journal document per signed-in user.
-- The browser client must use only the Supabase publishable/anon key.
-- Row Level Security below prevents users from reading or changing another user's state.

create table if not exists public.tradelog_user_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint tradelog_user_state_object check (jsonb_typeof(state) = 'object')
);

alter table public.tradelog_user_state enable row level security;
alter table public.tradelog_user_state force row level security;

revoke all on table public.tradelog_user_state from anon, authenticated;
grant select, insert, update, delete on table public.tradelog_user_state to authenticated;

drop policy if exists "Users can read their own TradeLog state" on public.tradelog_user_state;
create policy "Users can read their own TradeLog state"
  on public.tradelog_user_state for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own TradeLog state" on public.tradelog_user_state;
create policy "Users can insert their own TradeLog state"
  on public.tradelog_user_state for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own TradeLog state" on public.tradelog_user_state;
create policy "Users can update their own TradeLog state"
  on public.tradelog_user_state for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own TradeLog state" on public.tradelog_user_state;
create policy "Users can delete their own TradeLog state"
  on public.tradelog_user_state for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Read-only view links. Only the SHA-256 token hash is kept in the database;
-- viewers receive a state snapshot through the read-only RPC below.
create table if not exists public.tradelog_shares (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  label text not null default 'Journal viewer',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

alter table public.tradelog_shares enable row level security;
alter table public.tradelog_shares force row level security;

revoke all on table public.tradelog_shares from anon, authenticated;
grant select, insert, update, delete on table public.tradelog_shares to authenticated;

drop policy if exists "Owners can manage their TradeLog share links" on public.tradelog_shares;
create policy "Owners can manage their TradeLog share links"
  on public.tradelog_shares for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create or replace function public.get_shared_tradelog_state(p_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select s.state
  from public.tradelog_shares as link
  join public.tradelog_user_state as s on s.user_id = link.owner_id
  where link.token_hash = p_token_hash
    and link.revoked_at is null
    and (link.expires_at is null or link.expires_at > now())
  limit 1;
$$;

revoke all on function public.get_shared_tradelog_state(text) from public;
grant execute on function public.get_shared_tradelog_state(text) to anon, authenticated;
