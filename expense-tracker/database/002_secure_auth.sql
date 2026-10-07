-- Apply after schema.sql. Run the entire migration in Supabase SQL Editor.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.auth_security_config (
  singleton boolean primary key default true check(singleton),
  secret_hash text not null check(secret_hash ~ '^[a-f0-9]{64}$')
);
create table if not exists private.auth_request_budgets (
  key_hash text primary key check(key_hash ~ '^[a-f0-9]{64}$'),
  hits integer not null,
  expires_at timestamptz not null
);
create index if not exists auth_budgets_expiry_idx on private.auth_request_budgets(expires_at);
revoke all on all tables in schema private from public, anon, authenticated;

create or replace function public.consume_auth_budget(p_secret text,p_keys text[],p_limits integer[],p_windows integer[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k text; lim integer; win integer; n integer; expiry timestamptz; allowed boolean := true; retry integer := 0;
  now_time timestamptz := clock_timestamp();
begin
  if p_secret is null or length(p_secret)<32 or not exists (
    select 1 from private.auth_security_config where secret_hash=encode(sha256(convert_to(p_secret,'UTF8')),'hex')
  ) then raise exception 'Security configuration unavailable' using errcode='42501'; end if;
  if coalesce(array_length(p_keys,1),0) not between 1 and 3 or array_length(p_keys,1) is distinct from array_length(p_limits,1) or array_length(p_keys,1) is distinct from array_length(p_windows,1) then raise exception 'Invalid budgets'; end if;
  -- Consistent lock order prevents conflicting requests from deadlocking.
  for k,lim,win in select x,y,z from unnest(p_keys,p_limits,p_windows) as t(x,y,z) order by x loop
    if k is null or k !~ '^[a-f0-9]{64}$' or lim is null or lim not between 1 and 1000 or win is null or win not between 1 and 3600 then raise exception 'Invalid budget';end if;
    insert into private.auth_request_budgets as budget(key_hash,hits,expires_at)
      values(k,1,now_time+make_interval(secs=>win))
    on conflict(key_hash) do update set
      hits=case when budget.expires_at<=now_time then 1 else least(budget.hits+1,100000) end,
      expires_at=case when budget.expires_at<=now_time then now_time+make_interval(secs=>win) else budget.expires_at end
    returning hits,expires_at into n,expiry;
    if n>lim then allowed:=false;retry:=greatest(retry,ceil(extract(epoch from expiry-now_time))::integer);end if;
  end loop;
  delete from private.auth_request_budgets where expires_at<now_time-interval '1 day';
  return jsonb_build_object('allowed',allowed,'retry_after',retry);
end $$;
revoke all on function public.consume_auth_budget(text,text[],integer[],integer[]) from public;
grant execute on function public.consume_auth_budget(text,text[],integer[],integer[]) to anon,authenticated;

create or replace function public.session_is_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    where s.user_id=(select auth.uid())
      and s.id::text=(select auth.jwt()->>'session_id')
      and (s.not_after is null or s.not_after>now())
      and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=now())
  );
$$;
revoke all on function public.session_is_active() from public;
grant execute on function public.session_is_active() to authenticated;

-- Restrictive ownership remains effective even if permissive policies are added later.
drop policy if exists "Require owner and secure session" on public.transactions;
create policy "Require owner and secure session" on public.transactions as restrictive for all to authenticated
  using ((select auth.uid())=user_id and (select auth.jwt()->>'aal')='aal2' and (select public.session_is_active()))
  with check ((select auth.uid())=user_id and (select auth.jwt()->>'aal')='aal2' and (select public.session_is_active()));
revoke all on public.transactions from public,anon;
-- The application has no edit endpoint, so restrict the unused update privilege.
revoke update on public.transactions from authenticated;
commit;

-- Configure the limiter separately using the hash produced by npm run security:keys.
-- Never paste the plain secret into this file or commit it.
-- insert into private.auth_security_config(singleton,secret_hash)
-- values(true,'REPLACE_WITH_GENERATED_RATE_LIMIT_SECRET_SHA256')
-- on conflict(singleton) do update set secret_hash=excluded.secret_hash;
