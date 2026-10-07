import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
export const CSP = "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
export class HttpError extends Error { constructor(status, code, message) { super(message); this.status=status; this.code=code; } }
export const fail=(status,code,message)=>{throw new HttpError(status,code,message);};
export function settings(env=process.env) {
  let url, backend;
  try {url=new URL(env.APP_URL);backend=new URL(env.SUPABASE_URL);} catch {fail(503,'not_configured','Авторизация ещё не настроена.');}
  const local=['localhost','127.0.0.1'].includes(url.hostname)&&url.protocol==='http:'&&!env.VERCEL;
  const key=Buffer.from(env.SESSION_COOKIE_SECRET||'','base64');
  if((!local&&url.protocol!=='https:')||url.pathname!=='/'||url.search||url.hash||url.username||url.password||backend.protocol!=='https:'||key.length!==32||!env.AUTH_RATE_LIMIT_SECRET||env.AUTH_RATE_LIMIT_SECRET.length<32||!env.TURNSTILE_SITE_KEY||!env.SUPABASE_PUBLISHABLE_KEY)fail(503,'not_configured','Авторизация ещё не настроена.');
  if(env.SUPABASE_PUBLISHABLE_KEY.startsWith('sb_secret_'))fail(503,'not_configured','Ошибка конфигурации авторизации.');
  if(env.SUPABASE_PUBLISHABLE_KEY.split('.').length===3) {
    try { if(JSON.parse(Buffer.from(env.SUPABASE_PUBLISHABLE_KEY.split('.')[1],'base64url')).role!=='anon')fail(503,'not_configured','Ошибка конфигурации авторизации.'); }catch{fail(503,'not_configured','Ошибка конфигурации авторизации.');}
  }
  return {origin:url.origin,supabaseUrl:backend.origin,key,rateSecret:env.AUTH_RATE_LIMIT_SECRET,publicKey:env.SUPABASE_PUBLISHABLE_KEY,siteKey:env.TURNSTILE_SITE_KEY,secure:!local,cookieName:local?'potok_session':'__Host-potok_session'};
}
export function securityHeaders(res,secure=true) {
  for(const [key,value] of Object.entries({'Cache-Control':'no-store, private','Pragma':'no-cache','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':CSP,'Vary':'Cookie'}))res.setHeader(key,value);
  if(secure)res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
}
export function encrypt(payload,key) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const data=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');
}
export function decrypt(value,key) {
  try {if(typeof value!=='string'||value.length>3800)return null;const data=Buffer.from(value,'base64url');if(data.length<29)return null;const cipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));cipher.setAuthTag(data.subarray(12,28));const payload=JSON.parse(Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString('utf8'));if(!Number.isFinite(payload.until)||payload.until<=Date.now()||typeof payload.csrf!=='string')return null;return payload;}catch{return null;}
}
export function readCookie(req,config) {
  const parts=(req.headers.cookie||'').split(';');
  const value=parts.map(x=>x.trim()).find(x=>x.startsWith(config.cookieName+'='));
  return value?decrypt(value.slice(config.cookieName.length+1),config.key):null;
}
export function newState() {return {csrf:randomBytes(32).toString('base64url'),until:Date.now()+30*60*1000,born:Date.now(),purpose:'normal'};}
export function writeCookie(res,config,state) {
  const value=encrypt(state,config.key);if(value.length>3800)fail(500,'session_error','Не удалось создать сессию.');
  const age=Math.max(0,Math.floor((state.until-Date.now())/1000));
  res.setHeader('Set-Cookie',`${config.cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${config.secure?'; Secure':''}`);
}
export function clearCookie(res,config) {res.setHeader('Set-Cookie',`${config.cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${config.secure?'; Secure':''}`);}
export function safeEqual(a,b) {if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function requireCsrf(req,state,config) {
  if(req.headers.origin!==config.origin||req.headers['sec-fetch-site']==='cross-site'||!state||!safeEqual(req.headers['x-csrf-token'],state.csrf))fail(403,'csrf','Запрос отклонён. Обновите страницу.');
}
export function digest(value,secret) {return createHmac('sha256',secret).update(value).digest('hex');}
export async function jsonBody(req) {
  if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))fail(415,'invalid_body','Ожидается JSON.');
  const declared=Number(req.headers['content-length']);if(declared>8192)fail(413,'invalid_body','Слишком большой запрос.');
  let value=req.body;
  if(value===undefined) {
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>8192)fail(413,'invalid_body','Слишком большой запрос.');chunks.push(chunk);}value=Buffer.concat(chunks).toString('utf8');
  }
  if(Buffer.isBuffer(value))value=value.toString('utf8');
  if(typeof value==='string'){if(Buffer.byteLength(value)>8192)fail(413,'invalid_body','Слишком большой запрос.');try{value=JSON.parse(value);}catch{fail(400,'invalid_body','Некорректный запрос.');}}
  if(!value||Array.isArray(value)||typeof value!=='object'||Buffer.byteLength(JSON.stringify(value))>8192)fail(400,'invalid_body','Некорректный запрос.');
  return value;
}
export function credentials(body,registration=false) {
  const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
  const password=body.password;
  if(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||typeof password!=='string'||!password.length||Buffer.byteLength(password,'utf8')>72)fail(400,'invalid_credentials','Проверьте email и пароль. Пароль не должен превышать 72 байта.');
  if(registration&&(!passwordStrong(password)||password!==body.passwordConfirm))fail(400,'weak_password','Пароль: минимум 14 символов, заглавная и строчная буквы, цифра и символ. Пароли должны совпадать.');
  return {email,password};
}
export function passwordStrong(password) {return typeof password==='string'&&password.length>=14&&Buffer.byteLength(password,'utf8')<=72&&/[a-z]/.test(password)&&/[A-Z]/.test(password)&&/\d/.test(password)&&/[^A-Za-z0-9\s]/.test(password);}
export function captcha(body) {if(typeof body.captchaToken!=='string'||body.captchaToken.length<20||body.captchaToken.length>2048)fail(400,'captcha_required','Пройдите проверку CAPTCHA.');return body.captchaToken;}
export function uuid(value) {return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);}
export function transaction(body) {
  const allowed=['title','amount','type','category','created_at'];
  if(Object.keys(body).some(k=>!allowed.includes(k)))fail(400,'invalid_transaction','Недопустимые поля операции.');
  const title=typeof body.title==='string'?body.title.trim():'';
  const amount=body.amount,date=new Date(body.created_at);
  const categories=body.type==='income'?['salary','freelance','other']:['food','transport','entertainment','bills','shopping','health','other'];
  if(!title||title.length>100||typeof amount!=='number'||!Number.isFinite(amount)||amount<=0||amount>999999999||Math.abs(amount*100-Math.round(amount*100))>.0001||!['income','expense'].includes(body.type)||!categories.includes(body.category)||!Number.isFinite(date.getTime())||date.getTime()<Date.UTC(2000,0,1)||date.getTime()>Date.now()+24*60*60*1000)fail(400,'invalid_transaction','Проверьте название, сумму, категорию и дату.');
  return {title,amount:Math.round(amount*100)/100,type:body.type,category:body.category,created_at:date.toISOString()};
}
