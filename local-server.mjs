/* Optional standalone source runner. Hosted rooms still use Cloudflare D1. */
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleRooms } from './server/rooms.mjs';
const projectRoot=dirname(fileURLToPath(import.meta.url));
export function createLocalServer({root=projectRoot,filename=resolve(root,'.local-data/rooms.sqlite')}={}){
 if(filename!==':memory:')mkdirSync(dirname(filename),{recursive:true});
 const sqlite=new DatabaseSync(filename);sqlite.exec('PRAGMA journal_mode=WAL');
 for(const name of readdirSync(resolve(root,'drizzle')).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(resolve(root,'drizzle',name),'utf8').replace(/CREATE TABLE /g,'CREATE TABLE IF NOT EXISTS ').replace(/CREATE INDEX /g,'CREATE INDEX IF NOT EXISTS '));
 const db={prepare(sql){let values=[];return {bind(...args){values=args;return this;},async first(){return sqlite.prepare(sql).get(...values)||null;},async run(){const r=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(r.changes)}};}};}};
 const mime={'.html':'text/html; charset=utf-8','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
 const server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://'+req.headers.host);
   if(url.pathname==='/api/rooms'||url.pathname.startsWith('/api/rooms/')){
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16000){res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'请求过长'}));return;}chunks.push(chunk);}
    const response=await handleRooms(new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})}),{DB:db});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
   }
   if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
   const publicRoot=resolve(root,'public'),path=url.pathname==='/'?resolve(root,'client/game.html'):resolve(publicRoot,'.'+decodeURIComponent(url.pathname));
   if(url.pathname!=='/'&&!path.startsWith(publicRoot+sep)){res.writeHead(403);res.end('Forbidden');return;}
   let body;try{body=readFileSync(path);}catch{res.writeHead(404);res.end('Not found');return;}
   res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':extname(path)==='.html'?'no-cache':'public, max-age=86400','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'本地服务请求失败'}));}
 });
 server.on('close',()=>sqlite.close());return {server};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||4173),host=process.env.HOST||'127.0.0.1';if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT 必须为1—65535');
 const {server}=createLocalServer();server.listen(port,host,()=>console.log(`元素诀本地版：http://${host}:${port}\n局域网游玩可设置 HOST=0.0.0.0，使用电脑的局域网地址加入。`));for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close());
}
