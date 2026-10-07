import { mkdir,copyFile,rm } from 'node:fs/promises';
await rm('public',{recursive:true,force:true});
for(const dir of ['public/js','public/assets','public/dist/css'])await mkdir(dir,{recursive:true});
for(const file of ['index.html','js/app.js','js/auth.js','assets/favicon.svg','dist/css/style.css'])await copyFile(file,'public/'+file);
console.log('Собраны публичные файлы. Секреты и исходники сервера не включены.');
