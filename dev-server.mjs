import http from 'node:http';
import { existsSync, statSync, createReadStream } from 'node:fs';
import { join, extname, normalize, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(fileURLToPath(new URL('.',import.meta.url)));const host='0.0.0.0';const port=Number(process.env.PORT||5173);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.wav':'audio/wav','.mp3':'audio/mpeg'};
function safePath(urlPath){const decoded=decodeURIComponent((urlPath||'/').split('?')[0]);const rel=decoded==='/'?'index.html':decoded.replace(/^\/+/, '');const full=normalize(join(root,rel));const outside=relative(root,full);return !outside.startsWith('..')&&!isAbsolute(outside)?full:join(root,'index.html');}
const server=http.createServer((req,res)=>{try{let file=safePath(req.url);if(!existsSync(file)||!statSync(file).isFile())file=join(root,'index.html');const type=mime[extname(file).toLowerCase()]||'application/octet-stream';res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','Service-Worker-Allowed':'/'});createReadStream(file).pipe(res);}catch(err){res.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});res.end(`SonicStage Pro dev server error: ${err.message}`);}});
server.listen(port,host,()=>{console.log(`SonicStage Pro running at http://localhost:${port}/`);console.log(`LAN access is enabled on port ${port}.`);});
