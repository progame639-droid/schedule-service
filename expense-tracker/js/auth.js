(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  // Remove tokens persisted by the previous browser-based Supabase integration.
  try {for(const key of Object.keys(localStorage))if(/^sb-[a-z0-9-]+-auth-token(?:-code-verifier)?$/i.test(key))localStorage.removeItem(key);}catch{}
  let csrf='',siteKey='',captchaToken='',widget=null,factorId=null,view='login',state={user:null},queue=Promise.resolve(),configured=false,confirmation=null;
  const emit=()=>window.dispatchEvent(new CustomEvent('potok-auth',{detail:state}));
  function message(text,error=false){$('auth-message').textContent=text;$('auth-message').hidden=!text;$('auth-message').classList.toggle('auth__message--error',error);}
  async function perform(path,body,method=body?'POST':'GET') {
    if(!['http:','https:'].includes(location.protocol))throw new Error('Для входа запустите сервер по инструкции README.md.');
    const response=await fetch(`/api/${path}`,{method,credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{},body:body?JSON.stringify(body):undefined});
    const result=await response.json();
    if(result.csrf)csrf=result.csrf;
    if(!response.ok){const error=new Error(result.message||'Сервис временно недоступен.');error.code=result.error;error.status=response.status;
      if(response.status===401&&result.error!=='invalid_login'){state={user:null};emit();}
      if((response.status===401&&result.error!=='invalid_login')||result.error==='csrf')setTimeout(()=>init(),0);
      throw error;
    }
    return result;
  }
  function request(...args){const result=queue.then(()=>perform(...args));queue=result.catch(()=>{});return result;}
  async function loadCaptcha() {
    if(!configured||!siteKey||!['login','register','recovery'].includes(view))return;
    if(!window.turnstile){
      try{await new Promise((resolve,reject)=>{const previous=document.querySelector('script[data-turnstile]');if(previous){previous.addEventListener('load',resolve,{once:true});previous.addEventListener('error',reject,{once:true});return;}
        const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.dataset.turnstile='true';script.onload=resolve;script.onerror=()=>{script.remove();reject(new Error('CAPTCHA недоступна. Попробуйте позже.'));};document.head.append(script);
      });}catch(error){message(error.message,true);return;}
    }
    if(!['login','register','recovery'].includes(view)||!$('auth-modal').open)return;
    if(widget!==null)window.turnstile.remove(widget);
    captchaToken='';
    widget=window.turnstile.render('#captcha',{sitekey:siteKey,theme:'dark',size:'flexible',callback:token=>{captchaToken=token;},'expired-callback':()=>{captchaToken='';},'error-callback':()=>{captchaToken='';message('CAPTCHA не загрузилась. Проверьте соединение.',true);}});
  }
  function switchView(next) {
    view=next;message('');$('auth-form').reset();captchaToken='';$('auth-qr').removeAttribute('src');$('auth-secret').textContent='';
    const titles={login:'С возвращением',register:'Создать аккаунт',recovery:'Восстановить пароль',mfa:'Подтвердите вход',enroll:'Подключите защиту',password:'Новый пароль',confirm:'Подтверждение почты'};
    $('auth-title').textContent=titles[view];
    const text={login:'Войдите по email и паролю. Затем подтвердите вход кодом.',register:'Ваш email будет логином. Подтвердите почту и подключите второй фактор.',recovery:'Отправим ссылку на почту. Для изменения пароля понадобится второй фактор.',mfa:'Введите код из приложения-аутентификатора.',enroll:'Добавьте этот аккаунт в приложение-аутентификатор и введите шестизначный код.',password:'Восстановление подтверждено. Установите новый уникальный пароль.',confirm:'Нажмите кнопку, чтобы подтвердить действие из письма. Если вы не запрашивали это письмо, закройте окно.'};
    $('auth-description').textContent=text[view];
    $('auth-tabs').hidden=!['login','register'].includes(view);
    document.querySelectorAll('[data-auth-view]').forEach(button=>{button.classList.toggle('auth__tab--active',button.dataset.authView===view);button.setAttribute('aria-pressed',String(button.dataset.authView===view));});
    const email=['login','register','recovery'].includes(view),password=['login','register','password'].includes(view),repeat=['register','password'].includes(view),code=['mfa','enroll'].includes(view);
    for(const [field,visible] of [['auth-email-field',email],['auth-password-field',password],['auth-confirm-field',repeat],['auth-code-field',code]])$(field).hidden=!visible;
    $('auth-email').required=email;$('auth-password').required=password;$('auth-confirm').required=repeat;$('auth-code').required=code;
    $('auth-email').disabled=!email;$('auth-password').disabled=!password;$('auth-confirm').disabled=!repeat;$('auth-code').disabled=!code;
    $('auth-password').autocomplete=view==='login'?'current-password':'new-password';$('auth-password').minLength=view==='login'?1:14;
    $('auth-password-hint').hidden=!repeat;
    $('auth-enrollment').hidden=view!=='enroll';$('auth-forgot').hidden=view!=='login';$('auth-back').hidden=!['recovery','password'].includes(view);$('captcha').hidden=!email;
    $('auth-submit').textContent={login:'Войти',register:'Зарегистрироваться',recovery:'Отправить письмо',mfa:'Подтвердить код',enroll:'Подключить и продолжить',password:'Сохранить пароль',confirm:'Подтвердить действие'}[view];
    $('auth-account').hidden=!state.user;$('auth-account').textContent=state.user?.email||'';
    $('auth-logout').hidden=!state.user;
    $('auth-submit').disabled=!configured;
    loadCaptcha();
  }
  function open(next) {
    if(!$('auth-modal').open)$('auth-modal').showModal();
    switchView(next||'login');
    if(!configured)message('Сервер авторизации ещё не настроен. В README.md есть инструкция для Vercel и Supabase.',true);
  }
  async function update(next,autoOpen=true) {
    const hadUser=Boolean(state.user);
    const keepCurrentStep=state.user?.id===next.user?.id&&Boolean(next.user)&&$('auth-modal').open&&
      ((view==='enroll'&&factorId&&next.mfaRequired)||(view==='mfa'&&factorId===next.factorId&&next.mfaRequired)||(view==='password'&&next.recovery&&!next.mfaRequired));
    state=next;if(!keepCurrentStep)factorId=next.factorId||null;emit();
    if(hadUser&&!next.user&&$('auth-modal').open)$('auth-modal').close();
    if(keepCurrentStep)return;
    if(next.user&&next.mfaRequired){
      open(factorId?'mfa':'enroll');
      if(!factorId){
        $('auth-submit').disabled=true;
        try{const enrolled=await request('auth/mfa/enroll',{});factorId=enrolled.factorId;
          const qr=enrolled.qrCode;
          if(typeof qr==='string'&&qr.startsWith('data:image/svg+xml'))$('auth-qr').src=qr;
          else if(typeof qr==='string'&&qr.startsWith('<svg'))$('auth-qr').src='data:image/svg+xml,'+encodeURIComponent(qr);
          $('auth-secret').textContent=enrolled.secret;
        }catch(error){message(error.message,true);}finally{$('auth-submit').disabled=!factorId;}
      }
    }else if(next.user&&next.recovery)open('password');
    else if(next.user){$('auth-modal').close();$('auth-form').reset();$('auth-secret').textContent='';$('auth-qr').removeAttribute('src');}
    else if(autoOpen&&next.message){open('login');message(next.message);}
  }
  async function init() {
    if(!['http:','https:'].includes(location.protocol))return state;
    try {const result=await request('session');configured=result.configured;siteKey=result.siteKey||'';await update(result,false);
      const current=new URL(location.href),token=current.searchParams.get('confirm'),type=current.searchParams.get('type');
      if(token){confirmation={tokenHash:token,type};current.searchParams.delete('confirm');current.searchParams.delete('type');history.replaceState(null,'',current);open('confirm');}
    } catch(error){configured=false;$('auth-submit').disabled=true;}
    return state;
  }
  async function logout(){await request('auth/logout',{});csrf='';state={user:null};emit();$('auth-form').reset();$('auth-secret').textContent='';$('auth-qr').removeAttribute('src');if($('auth-modal').open)$('auth-modal').close();await init();}
  document.querySelectorAll('[data-auth-view]').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.authView)));
  $('auth-forgot').addEventListener('click',()=>switchView('recovery'));
  $('auth-back').addEventListener('click',()=>switchView('login'));
  $('auth-show-password').addEventListener('click',()=>{const visible=$('auth-password').type==='password';$('auth-password').type=visible?'text':'password';$('auth-show-password').textContent=visible?'Скрыть':'Показать';$('auth-show-password').setAttribute('aria-pressed',String(visible));});
  $('auth-modal').addEventListener('close',()=>{const form=$('auth-form');form.reset();$('auth-password').type='password';$('auth-show-password').textContent='Показать';$('auth-show-password').setAttribute('aria-pressed','false');$('auth-secret').textContent='';$('auth-qr').removeAttribute('src');captchaToken='';if(widget!==null&&window.turnstile){window.turnstile.remove(widget);widget=null;}});
  $('auth-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!configured||!$('auth-form').reportValidity())return;
    $('auth-submit').disabled=true;message('');
    const body={email:$('auth-email').value,password:$('auth-password').value,passwordConfirm:$('auth-confirm').value,captchaToken};
    try{
      let result;
      if(['login','register','recovery'].includes(view)){
        if(!captchaToken)throw new Error('Пройдите проверку CAPTCHA.');
        if(view==='register'&&body.password!==body.passwordConfirm)throw new Error('Пароли не совпадают.');
        result=await request(`auth/${view==='login'?'login':view==='register'?'register':'recovery'}`,body);
        $('auth-password').value='';$('auth-confirm').value='';
        if(view==='login')await update(result);
        else {const resultMessage=result.message;switchView('login');message(resultMessage);}
      }else if(['mfa','enroll'].includes(view)){
        result=await request('auth/mfa/verify',{factorId,code:$('auth-code').value});$('auth-code').value='';await update(result);
      }else if(view==='confirm'){
        result=await request('auth/confirm',confirmation);confirmation=null;
        if(result.user)await update(result);else {await init();open('login');message(result.message);}
      }else if(view==='password'){
        result=await request('auth/password',{password:body.password,passwordConfirm:body.passwordConfirm});await init();open('login');message(result.message);
      }
    }catch(error){message(error.message,true);$('auth-password').value='';$('auth-confirm').value='';$('auth-code').value='';}
    finally{$('auth-submit').disabled=!configured||(view==='enroll'&&!factorId);captchaToken='';if(widget!==null&&window.turnstile&&['login','register','recovery'].includes(view))window.turnstile.reset(widget);}
  });
  $('auth-logout').addEventListener('click',()=>logout().catch(error=>message(error.message,true)));
  window.PotokAuth={init,open,logout,request,getState:()=>state};
})();
