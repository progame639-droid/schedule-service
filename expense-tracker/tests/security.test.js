import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {settings,encrypt,decrypt,newState,passwordStrong,credentials,transaction,CSP} from '../server/security.js';
import {createHandler} from '../server/handler.js';
const env={APP_URL:'https://potok.example',SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SESSION_COOKIE_SECRET:randomBytes(32).toString('base64'),AUTH_RATE_LIMIT_SECRET:randomBytes(32).toString('base64url'),TURNSTILE_SITE_KEY:'test-site',VERCEL:'1'};
const cfg=settings(env),userId='a1111111-1111-4111-8111-111111111111',factorId='f1111111-1111-4111-8111-111111111111';
function fixture(options={}) {
  const calls=[],realtime=[];let access=options.aal==='aal2'?'access-a2':'access-a1';
  const user={id:userId,email:'a@example.com',email_confirmed_at:options.unconfirmed?null:new Date().toISOString(),user_metadata:{}};
  const session=()=>({access_token:access,refresh_token:'private-refresh-token',user});
  const auth={setSession:async input=>{access=input.access_token;return {data:{session:session()},error:options.invalidSession?{status:401}:null};},getUser:async()=>({data:{user},error:null}),signInWithPassword:async input=>{calls.push(['login',input]);return options.loginError?{data:{},error:options.loginError}:{data:{session:session(),user},error:null};},signUp:async()=>({data:{session:options.autoConfirm?session():null,user},error:options.signupError||null}),signOut:async input=>{calls.push(['logout',input]);return {error:null};},resetPasswordForEmail:async()=>({error:null}),verifyOtp:async()=>{calls.push(['verifyOtp']);return {data:{session:session()},error:null};},updateUser:async input=>{calls.push(['updatePassword',input]);return {data:{user},error:null};},mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:access==='access-a2'?'aal2':'aal1'},error:null}),listFactors:async()=>({data:{totp:[{id:factorId,status:'verified',factor_type:'totp'}],all:[{id:factorId,status:'verified',factor_type:'totp'}]},error:null}),challengeAndVerify:async()=>{access='access-a2';return {data:session(),error:null};}}};
  const chain={select(){return this},eq(key,value){calls.push(['eq',key,value]);return this},order(){return this},range:async()=>({data:[{id:'d1111111-1111-4111-8111-111111111111',amount:100,type:'income',title:'My income',category:'salary',created_at:new Date().toISOString()}],error:null}),insert(input){calls.push(['insert',input]);return {select:()=>({single:async()=>({data:{...input,id:'d1111111-1111-4111-8111-111111111111'},error:null})})}},delete(){calls.push(['delete']);return {...this,select:async()=>({data:options.notFound?[]:[{id:'d1111111-1111-4111-8111-111111111111'}],error:null})}}};
  const client={auth,channel:()=>({on(event,options,callback){realtime.push({options,callback});return this;},subscribe(){return this;}}),removeChannel:async()=>{},rpc:async(name,args)=>{calls.push(['rpc',name,args]);return name==='consume_auth_budget'?{data:options.limiterError?null:{allowed:!options.denied,retry_after:120},error:options.limiterError?{message:'not configured'}:null}:{data:!options.revoked,error:null};},from:()=>chain};
  return {handler:createHandler({env,clientFactory:()=>client}),calls,realtime};
}
function cookie(aal='aal2',purpose='normal'){return `${cfg.cookieName}=${encrypt({...newState(),access:aal==='aal2'?'access-a2':'access-a1',refresh:'private-refresh-token',purpose,csrf:'csrf-fixture'},cfg.key)}`;}
async function call(f,path,options={}) {
  const req={url:'/api/'+path,method:options.method||'GET',headers:{'x-vercel-forwarded-for':'203.0.113.8',...(options.body?{'content-type':'application/json'}:{}),...(options.cookie?{cookie:options.cookie}:{}),...(options.origin?{origin:options.origin}:{}),...(options.csrf?{'x-csrf-token':options.csrf}:{}),...options.headers},body:options.body,socket:{remoteAddress:'127.0.0.1'}};
  const res={statusCode:200,headers:{},written:'',listeners:{},write(text){this.written+=text;},on(name,fn){this.listeners[name]=fn;},flushHeaders(){},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(body){this.body=body||'';}};
  await f.handler(req,res);try{res.data=JSON.parse(res.body);}catch{}return res;
}
const post=(body={},extra={})=>({method:'POST',body,cookie:cookie(),origin:cfg.origin,csrf:'csrf-fixture',...extra});
const creds={email:'a@example.com',password:'Strong-Unique-Password-42!',passwordConfirm:'Strong-Unique-Password-42!',captchaToken:'turnstile-fixture-token-1234567890'};

test('authenticated encryption rejects altered and expired session cookies',()=>{
  const state=newState(),token=encrypt(state,cfg.key);assert.deepEqual(decrypt(token,cfg.key),state);
  const bytes=Buffer.from(token,'base64url');bytes[30]^=1;assert.equal(decrypt(bytes.toString('base64url'),cfg.key),null);
  assert.equal(decrypt(encrypt({...state,until:Date.now()-1},cfg.key),cfg.key),null);
  assert.equal(decrypt(token,randomBytes(32)),null);
});
test('production cannot use HTTP, privileged key, or missing secrets',()=>{
  assert.throws(()=>settings({...env,APP_URL:'http://potok.example'}));
  assert.throws(()=>settings({...env,SUPABASE_PUBLISHABLE_KEY:'sb_secret_invalid'}));
  assert.throws(()=>settings({...env,SESSION_COOKIE_SECRET:''}));
  assert.throws(()=>settings({...env,AUTH_RATE_LIMIT_SECRET:''}));
});
test('server enforces password length, complexity, bcrypt byte limit and confirmation',()=>{
  assert.equal(passwordStrong(creds.password),true);assert.equal(passwordStrong('Password1!'),false);
  assert.throws(()=>credentials({...creds,password:'short',passwordConfirm:'short'},true));
  assert.throws(()=>credentials({...creds,password:'a'.repeat(73)},false));
  assert.throws(()=>credentials({...creds,password:'Я'.repeat(40)+'Aa1!'},true));
  assert.throws(()=>credentials({...creds,passwordConfirm:'Different'},true));
});
test('transaction validation rejects client-supplied ownership and excessive precision',()=>{
  const value={title:' food ',amount:10.25,type:'expense',category:'food',created_at:new Date().toISOString()};
  assert.equal(transaction(value).title,'food');assert.throws(()=>transaction({...value,user_id:'someone-else'}));
  assert.throws(()=>transaction({...value,amount:.001}));assert.throws(()=>transaction({...value,amount:0}));
  assert.throws(()=>transaction({...value,type:'income',category:'food'}));
});
test('anonymous bootstrap exposes only CSRF and uses secure HttpOnly host cookie',async()=>{
  const result=await call(fixture(),'session');assert.equal(result.statusCode,200);assert.equal(result.data.user,null);
  assert.match(result.headers['set-cookie'],/^__Host-potok_session=/);assert.match(result.headers['set-cookie'],/HttpOnly; SameSite=Strict/);assert.match(result.headers['set-cookie'],/; Secure/);
  assert.equal(result.headers['cache-control'],'no-store, private');assert.match(CSP,/frame-ancestors 'none'/);
});
test('foreign Origin, absent CSRF and cross-site fetch are rejected before login',async()=>{
  for(const extra of [{origin:'https://evil.example'},{csrf:''},{headers:{'sec-fetch-site':'cross-site'}}]){
    const f=fixture(),result=await call(f,'auth/login',post(creds,extra));assert.equal(result.statusCode,403);assert.equal(f.calls.filter(c=>c[0]==='login').length,0);
  }
});
test('CAPTCHA cannot be omitted and persistent limiter fails closed',async()=>{
  const a=await call(fixture(),'auth/login',post({...creds,captchaToken:''}));assert.equal(a.statusCode,400);
  const denied=fixture({denied:true}),r=await call(denied,'auth/login',post(creds));assert.equal(r.statusCode,429);assert.equal(r.headers['retry-after'],'120');assert.equal(denied.calls.filter(c=>c[0]==='login').length,0);
  assert.equal((await call(fixture({limiterError:true}),'auth/login',post(creds))).statusCode,503);
});
test('wrong password and nonexistent account share the same public error',async()=>{
  const results=await Promise.all(['invalid_credentials','user_not_found'].map(code=>call(fixture({loginError:{code,status:400}}),'auth/login',post(creds))));
  assert.deepEqual(results[0].data,results[1].data);assert.equal(results[0].statusCode,401);
});
test('registration is neutral for duplicate addresses and rejects auto-confirm',async()=>{
  const newUser=await call(fixture(),'auth/register',post(creds));const duplicate=await call(fixture({signupError:{code:'user_already_exists'}}),'auth/register',post(creds));assert.equal(newUser.statusCode,202);assert.deepEqual(newUser.data,duplicate.data);
  assert.equal((await call(fixture({autoConfirm:true}),'auth/register',post(creds))).statusCode,503);
});
test('login and MFA never return Supabase tokens in JSON',async()=>{
  const f=fixture(),result=await call(f,'auth/login',post(creds));assert.equal(result.statusCode,200);assert.equal(result.data.mfaRequired,true);assert.equal(result.data.user.id,userId);
  assert.ok(!result.body.includes('access-a1'));assert.ok(!result.body.includes('private-refresh-token'));
  const verified=await call(f,'auth/mfa/verify',post({factorId,code:'123456'},{cookie:cookie('aal1')}));assert.equal(verified.statusCode,200);assert.equal(verified.data.aal,'aal2');assert.ok(!verified.body.includes('access-a2'));
});
test('finance endpoints require valid session, confirmed email and MFA; revoked sessions fail',async()=>{
  assert.equal((await call(fixture(),'transactions')).statusCode,401);
  assert.equal((await call(fixture(),'transactions',{cookie:cookie('aal1')})).statusCode,403);
  assert.equal((await call(fixture({revoked:true}),'transactions',{cookie:cookie()})).statusCode,401);
  assert.equal((await call(fixture({unconfirmed:true}),'transactions',{cookie:cookie()})).statusCode,401);
});
test('read and write queries use server-verified user ID, deletion returns neutral 404',async()=>{
  const f=fixture(),r=await call(f,'transactions',{cookie:cookie()});assert.equal(r.statusCode,200);assert.ok(f.calls.some(c=>c[0]==='eq'&&c[1]==='user_id'&&c[2]===userId));
  const body={title:'Income',amount:500,type:'income',category:'salary',created_at:new Date().toISOString()};assert.equal((await call(f,'transactions',post(body))).statusCode,201);assert.equal(f.calls.find(c=>c[0]==='insert')[1].user_id,userId);
  const denied=await call(f,'transactions',post({...body,user_id:'someone-else'}));assert.equal(denied.statusCode,400);
  const del=await call(fixture({notFound:true}),'transactions',post({id:'d1111111-1111-4111-8111-111111111111'},{method:'DELETE'}));assert.equal(del.statusCode,404);
});
test('GET confirmation does not consume OTP; POST confirmation signs out temporary session',async()=>{
  const f=fixture();const r=await call(f,'auth/confirm?token_hash='+'a'.repeat(64)+'&type=email');assert.equal(r.statusCode,303);assert.equal(f.calls.filter(c=>c[0]==='verifyOtp').length,0);
  const confirmed=await call(f,'auth/confirm',post({tokenHash:'a'.repeat(64),type:'email'}));assert.equal(confirmed.statusCode,200);assert.equal(confirmed.data.user,undefined);assert.ok(f.calls.some(c=>c[0]==='logout'&&c[1].scope==='local'));
});
test('password reset sessions cannot read finance and require MFA to change password',async()=>{
  assert.equal((await call(fixture(),'transactions',{cookie:cookie('aal2','recovery')})).statusCode,403);
  const body={password:creds.password,passwordConfirm:creds.password};
  assert.equal((await call(fixture(),'auth/password',post(body))).statusCode,403);
  assert.equal((await call(fixture(),'auth/password',post(body,{cookie:cookie('aal1','recovery')}))).statusCode,403);
  const f=fixture(),r=await call(f,'auth/password',post(body,{cookie:cookie('aal2','recovery')}));assert.equal(r.statusCode,200);assert.match(r.headers['set-cookie'],/Max-Age=0/);assert.ok(f.calls.some(c=>c[0]==='logout'&&c[1].scope==='global'));
});
test('logout revokes all sessions and removes the browser cookie',async()=>{
  const f=fixture(),r=await call(f,'auth/logout',post({}));assert.equal(r.statusCode,200);assert.match(r.headers['set-cookie'],/Max-Age=0/);assert.ok(f.calls.some(c=>c[0]==='logout'&&c[1].scope==='global'));
});

test('SSE does not expose foreign deletion events, row contents or tokens',async()=>{
  const f=fixture(),r=await call(f,'events',{cookie:cookie()});
  try {
    assert.equal(r.headers['content-type'],'text/event-stream; charset=utf-8');
    const del=f.realtime.find(x=>x.options.event==='DELETE');
    del.callback({old:{id:'foreign-id'}});assert.equal(r.written,': connected\n\n');
    del.callback({old:{id:'d1111111-1111-4111-8111-111111111111'}});assert.match(r.written,/event: update/);
    assert.ok(!r.written.includes('private-refresh-token'));assert.ok(!r.written.includes('My income'));
    const before=r.written;f.realtime.find(x=>x.options.event==='INSERT').callback({new:{id:'foreign-id',user_id:'someone-else'}});assert.equal(r.written,before);
  }finally{r.listeners.close();}
});
