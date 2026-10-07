import {randomBytes,createHash} from 'node:crypto';
const rate=randomBytes(32).toString('base64url');
console.log('Сохраните эти значения только в закрытых переменных окружения. Не отправляйте их в чат и не коммитьте.');
console.log('SESSION_COOKIE_SECRET='+randomBytes(32).toString('base64'));
console.log('AUTH_RATE_LIMIT_SECRET='+rate);
console.log('RATE_LIMIT_SECRET_SHA256='+createHash('sha256').update(rate).digest('hex'));
