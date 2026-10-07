import http from 'node:http';
import { readFile,stat } from 'node:fs/promises';
import { resolve,extname,sep } from 'node:path';
import { securityHeaders } from '../server/security.js';
try{process.loadEnvFile();}catch(error){if(error.code!=='ENOENT')throw error;}
const {default:handler}=await import('../server/handler.js');
const root=resolve(import.meta.dirname,'../public');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{
  try{
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(path.startsWith('/api/')){await handler(req,res);return;}
    securityHeaders(res,false);
    if(path.split('/').some(part=>part.startsWith('.'))){res.writeHead(404);res.end();return;}
    const file=resolve(root,'.'+(path==='/'?'/index.html':path));
    if(!file.startsWith(root+sep)||!(await stat(file)).isFile()){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':types[extname(file)]||'text/plain; charset=utf-8'});res.end(await readFile(file));
  }catch{if(!res.headersSent)res.writeHead(404);res.end('Not found');}
}).listen(3000,'127.0.0.1',()=>console.log('Поток: http://localhost:3000'));
