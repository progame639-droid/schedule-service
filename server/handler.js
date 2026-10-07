import { createClient } from '@supabase/supabase-js';
import {settings,securityHeaders,HttpError,fail,readCookie,newState,writeCookie,clearCookie,requireCsrf,jsonBody,credentials,captcha,digest,passwordStrong,uuid,transaction} from './security.js';
const json=(res,status,value)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(value));};
function sdk(config){return createClient(config.supabaseUrl,config.publicKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});}
function attachSession(state,session,purpose=state.purpose) {
  if(!session?.access_token||!session?.refresh_token)fail(401,'unauthorized','Войдите в аккаунт.');
  return {...state,access:session.access_token,refresh:session.refresh_token,purpose,csrf:state.csrf};
}
function authFailure(error,kind='login') {
  if(error?.status===429)fail(429,'rate_limited','Слишком много попыток. Подождите и попробуйте снова.');
  if(error?.code?.includes('captcha'))fail(400,'captcha_required','Проверка CAPTCHA не пройдена. Повторите её.');
  if(kind==='mfa')fail(400,'invalid_code','Код не подходит или истёк. Попробуйте новый код.');
  if(kind==='password')fail(400,'weak_password','Не удалось изменить пароль. Проверьте требования к паролю и срок ссылки.');
  fail(401,'invalid_login','Не удалось войти. Проверьте email, пароль и подтверждение почты.');
}
export function createHandler({clientFactory=sdk,env=process.env}={}) {
  return async function handler(req,res) {
    let config;
    try {
      config=settings(env);securityHeaders(res,config.secure);
      const url=new URL(req.url,config.origin);
      const route=typeof req.query?.route==='string'?req.query.route:url.pathname.replace(/^\/api\//,'');
      if(route!=='auth/confirm'&&req.headers['sec-fetch-site']==='cross-site')fail(403,'cross_site','Запрос отклонён.');
      const client=clientFactory(config);
      let state=readCookie(req,config);
      const ip=env.VERCEL?String(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||'').split(',')[0].trim():String(req.socket?.remoteAddress||'local');
      const limit=async(bucket,subject='',max=5,window=600)=>{
        const {data,error}=await clientFactory(config).rpc('consume_auth_budget',{p_secret:config.rateSecret,p_keys:[digest(`${bucket}:ip:${ip}`,config.rateSecret),digest(`${bucket}:subject:${subject||ip}`,config.rateSecret)],p_limits:[bucket==='data'?150:20,max],p_windows:[bucket==='data'?60:600,window]});
        if(error||!data||typeof data.allowed!=='boolean')fail(503,'security_unavailable','Защита входа временно недоступна. Попробуйте позже.');
        if(!data.allowed){res.setHeader('Retry-After',String(Math.min(Math.max(Number(data.retry_after)||60,1),3600)));fail(429,'rate_limited','Слишком много попыток. Подождите и попробуйте снова.');}
      };
      const restore=async()=>{
        if(!state?.access||!state.refresh)fail(401,'unauthorized','Войдите в аккаунт.');
        if(state.born+8*60*60*1000<=Date.now()){clearCookie(res,config);fail(401,'unauthorized','Сессия закончилась. Войдите снова.');}
        const {data,error}=await client.auth.setSession({access_token:state.access,refresh_token:state.refresh});
        if(error||!data.session){clearCookie(res,config);fail(401,'unauthorized','Сессия закончилась. Войдите снова.');}
        state=attachSession(state,data.session);
        const result=await client.auth.getUser();
        if(result.error||!result.data.user?.email_confirmed_at){clearCookie(res,config);fail(401,'unauthorized','Подтвердите почту и войдите снова.');}
        const active=await client.rpc('session_is_active');
        if(active.error)fail(503,'security_unavailable','Проверка сессии временно недоступна.');
        if(active.data!==true){clearCookie(res,config);fail(401,'unauthorized','Сессия закончилась. Войдите снова.');}
        const assurance=await client.auth.mfa.getAuthenticatorAssuranceLevel();
        if(assurance.error)fail(503,'security_unavailable','Не удалось проверить второй фактор.');
        return {user:result.data.user,aal:assurance.data.currentLevel};
      };
      const responseState=async()=>{
        const auth=await restore();
        const factors=await client.auth.mfa.listFactors();if(factors.error)fail(503,'security_unavailable','Не удалось проверить второй фактор.');
        const verified=(factors.data.totp||[]).filter(f=>f.status==='verified');
        writeCookie(res,config,state);
        return {csrf:state.csrf,user:{id:auth.user.id,email:auth.user.email,user_metadata:{full_name:auth.user.user_metadata?.full_name||''}},aal:auth.aal,mfaRequired:auth.aal!=='aal2',factorId:verified[0]?.id||null,recovery:state.purpose==='recovery',expiresAt:state.until};
      };
      const dataAuth=async()=>{
        const auth=await restore();
        if(state.purpose!=='normal'||auth.aal!=='aal2')fail(403,'mfa_required','Подтвердите вход кодом второго фактора.');
        await limit('data',auth.user.id,120,60);return auth;
      };
      if(route==='session'&&req.method==='GET') {
        if(state?.access) {
          try{return json(res,200,{configured:true,siteKey:config.siteKey,...await responseState()});}
          catch(error){if(!(error instanceof HttpError)||error.status!==401)throw error;}
        }
        state=newState();writeCookie(res,config,state);return json(res,200,{configured:true,siteKey:config.siteKey,csrf:state.csrf,user:null});
      }
      if(route==='events'&&req.method==='GET') {
        const auth=await dataAuth();
        const knownIds=new Set();
        for(let offset=0;offset<100000;offset+=1000){const result=await client.from('transactions').select('id').eq('user_id',auth.user.id).range(offset,offset+999);if(result.error)fail(503,'data_failed','Не удалось подключить синхронизацию.');result.data.forEach(t=>knownIds.add(t.id));if(result.data.length<1000)break;}
        writeCookie(res,config,state);res.statusCode=200;res.setHeader('Content-Type','text/event-stream; charset=utf-8');res.setHeader('X-Accel-Buffering','no');res.flushHeaders?.();res.write(': connected\n\n');
        let closed=false,channel,timer,heartbeat;
        const close=()=>{if(closed)return;closed=true;clearTimeout(timer);clearInterval(heartbeat);if(channel)client.removeChannel(channel).catch(()=>{});res.end();};
        const send=(event)=>{if(!closed)res.write(`event: ${event}\ndata: {}\n\n`);};
        channel=client.channel(`potok-${auth.user.id}-${state.csrf.slice(0,8)}`)
          .on('postgres_changes',{event:'INSERT',schema:'public',table:'transactions',filter:`user_id=eq.${auth.user.id}`},payload=>{if(payload.new?.user_id!==auth.user.id)return;if(payload.new.id)knownIds.add(payload.new.id);send('update');})
          .on('postgres_changes',{event:'UPDATE',schema:'public',table:'transactions',filter:`user_id=eq.${auth.user.id}`},payload=>{if(payload.new?.user_id===auth.user.id)send('update');})
          .on('postgres_changes',{event:'DELETE',schema:'public',table:'transactions'},payload=>{if(knownIds.delete(payload.old?.id))send('update');})
          .subscribe(status=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')close();});
        heartbeat=setInterval(async()=>{try{const active=await client.rpc('session_is_active');if(active.error||active.data!==true||Date.now()>=state.until){send('expired');close();}else if(!closed)res.write(': heartbeat\n\n');}catch{close();}},15000);
        timer=setTimeout(()=>{if(Date.now()>=state.until)send('expired');close();},Math.min(50000,state.until-Date.now()));
        res.on('close',close);return;
      }
      if(route==='auth/confirm'&&req.method==='GET') {
        const token=url.searchParams.get('token_hash'),type=url.searchParams.get('type');
        if(!token||!/^[a-f0-9]{32,128}$/i.test(token)||!['email','recovery'].includes(type))fail(400,'invalid_link','Ссылка недействительна.');
        // The GET does not consume the one-time link: email scanners cannot sign users in.
        res.statusCode=303;res.setHeader('Location',config.origin+'/?confirm='+encodeURIComponent(token)+'&type='+type);res.end();return;
      }
      const methods={'auth/confirm':'POST','auth/login':'POST','auth/register':'POST','auth/recovery':'POST','auth/logout':'POST','auth/mfa/enroll':'POST','auth/mfa/verify':'POST','auth/password':'POST'};
      if(route!=='transactions'&&(!methods[route]||req.method!==methods[route])){res.setHeader('Allow',methods[route]||'GET');fail(405,'method_not_allowed','Метод не поддерживается.');}
      if(route==='transactions'&&!['GET','POST','DELETE'].includes(req.method)){res.setHeader('Allow','GET, POST, DELETE');fail(405,'method_not_allowed','Метод не поддерживается.');}
      if(req.method!=='GET')requireCsrf(req,state,config);
      const body=req.method==='GET'?{}:await jsonBody(req);
      if(route==='auth/confirm') {
        if(typeof body.tokenHash!=='string'||!/^[a-f0-9]{32,128}$/i.test(body.tokenHash)||!['email','recovery'].includes(body.type))fail(400,'invalid_link','Ссылка недействительна.');
        await limit('confirm',ip,12,600);
        const {data,error}=await client.auth.verifyOtp({token_hash:body.tokenHash,type:body.type});
        if(error||!data.session)fail(400,'invalid_link','Ссылка истекла или уже использована. Запросите новую.');
        if(body.type==='email') {
          const result=await client.auth.signOut({scope:'local'});if(result.error)fail(503,'confirmation_failed','Почта подтверждена. Не удалось завершить временную сессию. Попробуйте позже.');
          state=newState();writeCookie(res,config,state);return json(res,200,{csrf:state.csrf,message:'Почта подтверждена. Войдите по email и паролю.'});
        }
        state=attachSession(newState(),data.session,'recovery');return json(res,200,await responseState());
      }
      if(route==='auth/login') {
        const {email,password}=credentials(body);await limit('login',email,8,900);const captchaToken=captcha(body);
        const {data,error}=await client.auth.signInWithPassword({email,password,options:{captchaToken}});if(error)authFailure(error);
        if(!data.user?.email_confirmed_at||!data.session)authFailure(null);
        state=attachSession(newState(),data.session);return json(res,200,await responseState());
      }
      if(route==='auth/register') {
        const {email,password}=credentials(body,true);await limit('register',email,3,3600);const captchaToken=captcha(body);
        const {data,error}=await client.auth.signUp({email,password,options:{captchaToken,emailRedirectTo:config.origin+'/'}});
        if(error && !['user_already_exists','email_exists'].includes(error.code)){if(error.code==='weak_password')fail(400,'weak_password','Выберите более надёжный пароль.');if(error.status===429||error.code?.includes('captcha'))authFailure(error);fail(503,'registration_failed','Не удалось отправить письмо. Попробуйте позже.');}
        if(data?.session){await client.auth.signOut({scope:'local'});fail(503,'confirmation_required','Включите подтверждение email в настройках Supabase.');}
        return json(res,202,{message:'Если адрес можно зарегистрировать, письмо с подтверждением уже отправлено. Проверьте почту и папку «Спам».'});
      }
      if(route==='auth/recovery') {
        const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
        if(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'invalid_email','Введите корректный email.');
        await limit('recovery',email,3,3600);const captchaToken=captcha(body);
        const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:config.origin+'/',captchaToken});
        if(error && (error.status===429||error.code?.includes('captcha')))authFailure(error);
        if(error)fail(503,'recovery_failed','Не удалось отправить письмо. Попробуйте позже.');
        return json(res,202,{message:'Если аккаунт существует, письмо для восстановления отправлено. Проверьте почту.'});
      }
      if(route==='auth/logout') {
        if(state?.access){await restore();const {error}=await client.auth.signOut({scope:'global'});if(error)fail(503,'logout_failed','Не удалось завершить сессии. Повторите выход.');}
        clearCookie(res,config);return json(res,200,{message:'Вы вышли на всех устройствах.'});
      }
      if(route==='auth/mfa/enroll') {
        const auth=await restore();await limit('mfa-enroll',auth.user.id,4,3600);
        const {data,error}=await client.auth.mfa.listFactors();if(error)fail(503,'mfa_failed','Не удалось загрузить второй фактор.');
        if((data.totp||[]).some(f=>f.status==='verified'))fail(409,'mfa_exists','Второй фактор уже подключён. Введите код.');
        for(const factor of data.all||[])if(factor.status==='unverified'&&factor.factor_type==='totp'){const result=await client.auth.mfa.unenroll({factorId:factor.id});if(result.error)fail(503,'mfa_failed','Не удалось начать подключение.');}
        const enrolled=await client.auth.mfa.enroll({factorType:'totp',friendlyName:'Поток',issuer:'Поток'});if(enrolled.error)fail(503,'mfa_failed','Не удалось подключить второй фактор.');
        writeCookie(res,config,state);return json(res,200,{factorId:enrolled.data.id,qrCode:enrolled.data.totp.qr_code,secret:enrolled.data.totp.secret});
      }
      if(route==='auth/mfa/verify') {
        const auth=await restore();await limit('mfa-verify',auth.user.id,5,600);
        if(!uuid(body.factorId)||typeof body.code!=='string'||!/^\d{6}$/.test(body.code))fail(400,'invalid_code','Введите шестизначный код.');
        const factors=await client.auth.mfa.listFactors();if(factors.error||!(factors.data.all||[]).some(f=>f.id===body.factorId&&f.factor_type==='totp'))fail(400,'invalid_code','Второй фактор недоступен.');
        const verified=await client.auth.mfa.challengeAndVerify({factorId:body.factorId,code:body.code});if(verified.error)authFailure(verified.error,'mfa');
        state=attachSession({...state,until:Math.min(Date.now()+30*60*1000,state.born+8*60*60*1000)},verified.data);
        return json(res,200,await responseState());
      }
      if(route==='auth/password') {
        const auth=await restore();await limit('password',auth.user.id,3,600);
        if(state.purpose!=='recovery'||auth.aal!=='aal2')fail(403,'recovery_required','Подтвердите восстановление почтой и вторым фактором.');
        if(!passwordStrong(body.password)||body.password!==body.passwordConfirm)fail(400,'weak_password','Нужен пароль от 14 символов с буквами разного регистра, цифрой и символом. Пароли должны совпадать.');
        const result=await client.auth.updateUser({password:body.password});if(result.error)authFailure(result.error,'password');
        const logout=await client.auth.signOut({scope:'global'});clearCookie(res,config);
        if(logout.error)fail(503,'logout_failed','Пароль изменён. Завершение остальных сессий не подтверждено; выполните повторный вход и выход на всех устройствах.');
        return json(res,200,{message:'Пароль изменён. Войдите с новым паролем.'});
      }
      if(route==='transactions') {
        const auth=await dataAuth();
        if(req.method==='GET') {
          const records=[];
          for(let offset=0;offset<100000;offset+=1000){const {data,error}=await client.from('transactions').select('id,title,amount,type,category,created_at').eq('user_id',auth.user.id).order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+999);if(error)fail(503,'data_failed','Не удалось загрузить операции.');records.push(...data);if(data.length<1000){writeCookie(res,config,state);return json(res,200,{transactions:records});}}
          fail(413,'too_many_records','Слишком много операций для одного запроса.');
        }
        if(req.method==='POST') {
          const record=transaction(body);
          const {data,error}=await client.from('transactions').insert({...record,user_id:auth.user.id}).select('id,title,amount,type,category,created_at').single();if(error)fail(503,'data_failed','Не удалось сохранить операцию.');
          state.until=Math.min(Date.now()+30*60*1000,state.born+8*60*60*1000);writeCookie(res,config,state);return json(res,201,{transaction:data});
        }
        if(!uuid(body.id)||Object.keys(body).some(k=>k!=='id'))fail(400,'invalid_id','Некорректная операция.');
        const {data,error}=await client.from('transactions').delete().eq('id',body.id).eq('user_id',auth.user.id).select('id');if(error)fail(503,'data_failed','Не удалось удалить операцию.');if(!data.length)fail(404,'not_found','Операция не найдена.');
        state.until=Math.min(Date.now()+30*60*1000,state.born+8*60*60*1000);writeCookie(res,config,state);return json(res,200,{deleted:true});
      }
      fail(404,'not_found','Не найдено.');
    }catch(error){securityHeaders(res,config?.secure!==false);const known=error instanceof HttpError;json(res,known?error.status:500,{error:known?error.code:'internal_error',message:known?error.message:'Сервис временно недоступен. Попробуйте позже.'});}
  };
}
export default createHandler();
