-- Run once in the Supabase SQL Editor before signing in.
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 100),
  amount numeric(11,2) not null check (amount > 0 and amount <= 999999999),
  type text not null check (type in ('income', 'expense')),
  category text not null check (category in ('food','transport','entertainment','bills','shopping','health','salary','freelance','other')),
  created_at timestamptz not null default now()
);
create index if not exists transactions_user_date_idx on public.transactions(user_id, created_at desc);
alter table public.transactions enable row level security;
revoke all on public.transactions from anon;
grant select, insert, update, delete on public.transactions to authenticated;
drop policy if exists "Read own transactions" on public.transactions;
create policy "Read own transactions" on public.transactions for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Insert own transactions" on public.transactions;
create policy "Insert own transactions" on public.transactions for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Update own transactions" on public.transactions;
create policy "Update own transactions" on public.transactions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Delete own transactions" on public.transactions;
create policy "Delete own transactions" on public.transactions for delete to authenticated using ((select auth.uid()) = user_id);
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='transactions') then
    alter publication supabase_realtime add table public.transactions;
  end if;
end $$;
