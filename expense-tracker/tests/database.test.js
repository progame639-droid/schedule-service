import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

test('actual PostgreSQL RLS denies foreign rows, AAL1, unconfirmed, and revoked sessions; shared budgets enforce concurrency',async()=>{
  const db=new PGlite();
  await db.exec(`create role anon nologin;create role authenticated nologin;
    create schema auth;grant usage on schema auth,public to authenticated,anon;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz,banned_until timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    create publication supabase_realtime;`);
  await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../database/002_secure_auth.sql',import.meta.url),'utf8'));
  const a='a1111111-1111-4111-8111-111111111111',b='b1111111-1111-4111-8111-111111111111',sa='c1111111-1111-4111-8111-111111111111',sb='d1111111-1111-4111-8111-111111111111';
  await db.query('insert into auth.users values ($1,now(),null),($2,now(),null)',[a,b]);
  await db.query('insert into auth.sessions values ($1,$2,null),($3,$4,null)',[sa,a,sb,b]);
  await db.query("insert into public.transactions(user_id,title,amount,type,category)values($1,'A private',100,'income','salary'),($2,'B private',200,'income','salary')",[a,b]);
  async function asUser(sub,session,aal,fn){await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub,session_id:session,aal})]);await db.exec('set role authenticated');try{return await fn();}finally{await db.exec('reset role');}}
  const visible=await asUser(a,sa,'aal2',()=>db.query('select title from public.transactions'));assert.deepEqual(visible.rows,[{title:'A private'}]);
  await asUser(a,sa,'aal2',()=>assert.rejects(db.query("insert into public.transactions(user_id,title,amount,type,category)values($1,'Forged',100,'income','salary')",[b]),/row-level security/i));
  const removed=await asUser(a,sa,'aal2',()=>db.query('delete from public.transactions where user_id=$1 returning id',[b]));assert.equal(removed.rows.length,0);
  assert.equal((await asUser(a,sa,'aal1',()=>db.query('select * from public.transactions'))).rows.length,0);
  await db.query('update auth.users set email_confirmed_at=null where id=$1',[a]);assert.equal((await asUser(a,sa,'aal2',()=>db.query('select * from public.transactions'))).rows.length,0);
  await db.query('update auth.users set email_confirmed_at=now() where id=$1',[a]);await db.query('delete from auth.sessions where id=$1',[sa]);assert.equal((await asUser(a,sa,'aal2',()=>db.query('select * from public.transactions'))).rows.length,0);
  await db.exec('set role anon');await assert.rejects(db.query('select * from public.transactions'),/permission denied/i);await assert.rejects(db.query('select * from private.auth_request_budgets'),/permission denied/i);await db.exec('reset role');
  const secret='test-secret-'.repeat(4),hash=createHash('sha256').update(secret).digest('hex');await db.query('insert into private.auth_security_config values(true,$1)',[hash]);
  await db.exec('set role anon');await assert.rejects(db.query('select public.consume_auth_budget($1,$2,$3,$4)',['wrong-secret', ['a'.repeat(64)],[3],[600]]),/configuration unavailable/i);
  const results=await Promise.all(Array.from({length:8},()=>db.query('select public.consume_auth_budget($1,$2,$3,$4) as budget',[secret,['a'.repeat(64)],[3],[600]])));
  assert.equal(results.filter(r=>r.rows[0].budget.allowed).length,3);assert.ok(results.slice(3).every(r=>r.rows[0].budget.retry_after>0));await db.exec('reset role');
  await db.query('update private.auth_request_budgets set expires_at=now()-interval \'1 second\'');
  const renewed=await db.query('select public.consume_auth_budget($1,$2,$3,$4) as budget',[secret,['a'.repeat(64)],[3],[600]]);assert.equal(renewed.rows[0].budget.allowed,true);
  await db.close();
});
