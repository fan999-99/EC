import { Game, Bot } from './core.mjs';

const TTL=24*60*60*1000,OFFLINE=90000,LEVELS=['easy','medium','hard'];
class RoomError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const fail=(message,status=400)=>{throw new RoomError(message,status);};
const cleanName=n=>String(n||'玩家').trim().slice(0,16)||'玩家';
const clone=x=>JSON.parse(JSON.stringify(x));
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function hash(token){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
function randomToken(){const a=crypto.getRandomValues(new Uint8Array(32));return Array.from(a,b=>b.toString(16).padStart(2,'0')).join('');}
function makeCode(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',a=crypto.getRandomValues(new Uint8Array(6));return Array.from(a,n=>chars[n%chars.length]).join('');}
function requireHost(r,m){if(r.host!==m.uid)fail('只有房主可以执行此操作',403);}
function bearer(req){const a=req.headers.get('Authorization')||'';return a.startsWith('Bearer ')?a.slice(7):'';}
const botDelay=()=>2000+Math.floor(Math.random()*2001);
function botActors(g){return (g.actors?g.actors():[g.actor()]).filter(p=>p?.type==='bot');}
function planBots(r,g,now){
 const actors=botActors(g),key='2-4:'+(g.s.phase==='negation'?'window:'+g.s.toolContext.id:g.s.phase+':'+g.s.rev);
 const before=JSON.stringify(r.botPlan||null);let plan=r.botPlan;
 if(!actors.length)plan=null;
 else{if(!plan||plan.key!==key)plan={key,deadlines:{}};const ids=actors.map(p=>String(p.id));for(const id of Object.keys(plan.deadlines))if(!ids.includes(id))delete plan.deadlines[id];for(const p of actors)if(plan.deadlines[p.id]===undefined)plan.deadlines[p.id]=now+botDelay();}
 r.botPlan=plan;r.nextBotAt=plan?Math.min(...Object.values(plan.deadlines)):null;return before!==JSON.stringify(plan);
}
function publicGame(s,seat){
 if(!s)return null;
 return {version:s.version,rulesRevision:s.rulesRevision||s.version,maxHp:s.maxHp||(s.version<3?4:7),moons:clone(s.moons||null),defeats:clone(s.defeats||[]),mode:s.mode||'ffa',limits:s.limits||{attack:1,tool:1},rev:s.rev,phase:s.phase,choiceIndex:s.choiceIndex,turn:s.turn,starter:s.starter,turnCount:s.turnCount,
  toolContext:s.toolContext?{...clone(s.toolContext),swapId:seat===s.toolContext.owner?s.toolContext.swapId:null,...(s.toolContext.prepareIds?{prepareIds:seat===s.toolContext.owner?clone(s.toolContext.prepareIds):null}:{})}:null,forced:s.forced?clone(s.forced):null,hitQueue:clone(s.hitQueue||[]),
  visualEvents:clone(s.visualEvents||[]),bounties:clone(s.bounties||{}),insights:seat!==null&&s.insights?.[seat]?{[seat]:clone(s.insights[seat])}:{},used:{...s.used},pending:s.pending?clone(s.pending):null,deck:[],deckCount:s.deck.length,discard:[],discardCount:s.discard.length,out:[],
  players:s.players.map((p,i)=>({id:p.id,name:p.name,type:p.type,level:p.level,hp:p.hp,alive:p.alive,element:p.element,team:p.team??null,bound:!!p.bound,attackRestricted:!!p.attackRestricted,
   hand:i===seat?clone(p.hand):[],handCount:p.hand.length,shield:p.shield?clone(p.shield):null,
   identityCard:p.identityCard?clone(p.identityCard):null,healthCard:p.healthCard?clone(p.healthCard):null,candidates:i===seat?clone(p.candidates):[]})),
  dist:clone(s.dist),logs:s.logs.slice(-35),winners:s.winners.slice(),reason:s.reason,setup:clone(s.setup)};
}
export function viewRoom(r,uid,now=Date.now()){
 const seat=r.members.findIndex(m=>m.uid===uid),me=r.members[seat];if(!me)fail('你的席位已经离开房间',403);
 return {code:r.code,status:r.status,mode:r.mode||'ffa',version:r.version,gameId:r.gameId||null,serverNow:now,playerId:seat,isHost:r.host===uid,
  members:r.members.map((m,i)=>({uid:m.uid,seat:i,name:m.name,type:m.type,level:m.level,team:m.team??i%2,ready:m.ready,isHost:r.host===m.uid,
   online:m.type==='bot'||now-m.lastSeen<30000,autopilot:m.type==='human'&&now-m.lastSeen>OFFLINE})),game:publicGame(r.game,seat)};
}
export function progressRoom(r,now){
 if(r.status!=='playing'||!r.game)return false;
 const g=Game.restore(r.game);g.nowFn=()=>now;let changed=g.tick?.(now)||false;
 for(const p of g.s.players){const m=r.members[p.id],type=m.type==='bot'||now-m.lastSeen>OFFLINE?'bot':'human';if(p.type!==type){p.type=type;changed=true;g.log(type==='bot'?`${p.name}离线，由中等人机暂时代打。`:`${p.name}已重连，恢复真人操作。`);}p.level=m.type==='bot'?m.level:'medium';}
 changed=planBots(r,g,now)||changed;
 const p=botActors(g).filter(p=>now>=r.botPlan?.deadlines[p.id]).sort((a,b)=>r.botPlan.deadlines[a.id]-r.botPlan.deadlines[b.id]||a.id-b.id)[0];
 if(p){
  if(g.s.phase==='identity'){g.advanceIdentity();g.s.rev++;changed=true;}
  else{const a=Bot.choose(g.publicView(p.id),()=>g.random());if(a){const result=g.dispatch(a);if(!result.ok)throw Error('Server bot: '+result.error);changed=true;}}
  planBots(r,g,now);
 }
 if(changed){g.assert();r.game=g.s;}
 if(g.s.phase==='over'&&r.status!=='over'){r.status='over';r.game=g.s;changed=true;}
 return changed;
}
async function rowFor(db,code,now){const row=await db.prepare('SELECT payload, version, expires_at FROM element_rooms WHERE code = ?').bind(code).first();if(!row||row.expires_at<now)fail('房间不存在或已过期，请检查房间码',404);return row;}
async function updateRoom(db,code,token,operate,now){
 if(!/^[A-Z2-9]{6}$/.test(code))fail('房间码为6位字母或数字');
 if(!/^[a-f0-9]{64}$/.test(token))fail('请重新加入房间',401);const digest=await hash(token);
 for(let attempt=0;attempt<6;attempt++){
  const row=await rowFor(db,code,now),r=JSON.parse(row.payload);r.version=row.version;
  const member=r.members.find(m=>m.tokenHash===digest&&m.type==='human');if(!member)fail('房间凭证无效，请重新加入',401);
  let changed=false;if(now-member.lastSeen>12000){member.lastSeen=now;changed=true;}
  changed=progressRoom(r,now)||changed;
  const result=operate?operate(r,member,now):{};if(operate)changed=true;
  if(!changed)return viewRoom(r,member.uid,now);
  r.version=row.version+1;r.updatedAt=now;
  const write=await db.prepare('UPDATE element_rooms SET payload = ?, version = ?, expires_at = ? WHERE code = ? AND version = ?').bind(JSON.stringify(r),r.version,now+TTL,code,row.version).run();
  if(write.meta?.changes===1)return result?.left?{left:true}:viewRoom(r,member.uid,now);
 }
 fail('房间正在同步，请稍后重试',409);
}
function operate(r,m,body,now){
 const kind=body.kind;
 if(kind==='leave'){
  if(r.status==='lobby'){
   r.members=r.members.filter(p=>p.uid!==m.uid);if(r.host===m.uid){const next=r.members.find(p=>p.type==='human');r.host=next?.uid||'';if(next)next.ready=true;}
  }else m.lastSeen=0;
  return {left:true};
 }
 if(kind==='rematch'){
  requireHost(r,m);if(r.status!=='over')fail('当前对局尚未结束');r.status='lobby';r.game=null;r.gameId=null;
  r.members.forEach(p=>p.ready=p.type==='bot'||p.uid===r.host);return;
 }
 if(r.status==='lobby'){
  if(kind==='ready'){m.ready=!!body.ready;return;}
  requireHost(r,m);
  if(kind==='mode'){if(!['ffa','team'].includes(body.mode))fail('玩法无效');if(body.mode==='team'&&r.members.length>4)fail('2v2最多4席，请先减少席位');r.mode=body.mode;r.members.forEach((p,i)=>p.team=i%2);return;}
  if(kind==='team'){if(r.mode!=='team'||![0,1].includes(body.team))fail('队伍无效');const p=r.members.find(p=>p.uid===body.uid);if(!p)fail('席位不存在');p.team=body.team;return;}
  if(kind==='add-bot'){
   if(r.members.length>=(r.mode==='team'?4:5))fail('房间已满');const level=LEVELS.includes(body.level)?body.level:'medium';
   const names=['青岚','听雨','赤霄','砚山','玄石'];r.members.push({uid:crypto.randomUUID(),name:names[r.members.length-1]+'·人机',type:'bot',level,team:r.members.length%2,ready:true,lastSeen:now});return;
  }
  if(kind==='remove-bot'){const i=r.members.findIndex(p=>p.uid===body.uid&&p.type==='bot');if(i<0)fail('该席位不是人机');r.members.splice(i,1);return;}
  if(kind==='bot-level'){const p=r.members.find(p=>p.uid===body.uid&&p.type==='bot');if(!p||!LEVELS.includes(body.level))fail('请选择合法的人机难度');p.level=body.level;return;}
  if(kind==='start'){
   if(r.members.length<2)fail('至少需要2名玩家，可以添加人机');if(r.members.some(p=>p.type==='human'&&!p.ready))fail('请等待所有真人准备');
   if(r.mode==='team'&&(r.members.length!==4||r.members.filter(p=>p.team===0).length!==2))fail('2v2需要4名玩家，A/B队各2人');
   const g=new Game(r.members.map(p=>({name:p.name,type:p.type,level:p.level||'medium',team:p.team})),{mode:r.mode,online:true,now:()=>now});r.game=g.s;r.gameId=crypto.randomUUID();r.status='playing';r.botPlan=null;planBots(r,g,now);r.commands=[];return;
  }
  fail('房间中暂时不能执行该操作');
 }
 if(r.status!=='playing')fail('本局已结束，请等待房主再开一局');
 if(kind!=='game')fail('对局中不能修改席位');
 if(body.gameId!==r.gameId)fail('对局已更新，请等待同步',409);
 if(typeof body.commandId!=='string'||body.commandId.length>80||!body.commandId)fail('缺少操作编号');
 const key=m.uid+':'+body.commandId;if((r.commands||[]).includes(key))return;
 const a=body.action;if(!a||!['identity','replace','recover','attack','tool','respond','discard','forcedDiscard','negate','passTool','end'].includes(a.kind))fail('未知游戏动作');
 if(a.cards&&(!Array.isArray(a.cards)||a.cards.length>176||a.cards.some(id=>typeof id!=='string'||id.length>64)))fail('选牌格式有误');
 const seat=r.members.findIndex(p=>p.uid===m.uid),g=Game.restore(r.game);
 g.nowFn=()=>now;const interrupt=g.s.phase==='negation'&&['negate','passTool'].includes(a.kind)&&a.contextId===g.s.toolContext?.id;
 if(g.s.rev!==body.rev&&!interrupt)fail('牌局已变化，正在刷新，请重新选择',409);
 const result=g.dispatch({...a,actor:seat,rev:body.rev});if(!result.ok)fail(result.error,409);g.assert();
 r.game=g.s;planBots(r,g,now);r.commands=[...(r.commands||[]),key].slice(-40);
 if(g.s.phase==='over')r.status='over';
}
export async function handleRooms(request,env,{now=Date.now()}={}){
 try{
  const url=new URL(request.url),parts=url.pathname.split('/').filter(Boolean),db=env.DB;
  if(!db)return json({error:'联机服务正在准备，请稍后再试'},503);
  if(request.method==='POST'){
   const origin=request.headers.get('Origin');if(origin&&origin!==url.origin)fail('请从游戏页面发起操作',403);
  }
  if(request.method==='GET'&&parts[2]==='health')return json({ok:true,protocol:1});
  let body={};if(request.method==='POST'){const raw=await request.text();if(raw.length>16000)fail('请求过长',413);try{body=JSON.parse(raw);}catch{fail('请求格式有误');}}
  if(parts.length===2&&request.method==='POST'){
   const token=randomToken(),uid=crypto.randomUUID(),name=cleanName(body.name),creator=await hash(request.headers.get('CF-Connecting-IP')||'shared-site');
   const recent=await db.prepare('SELECT COUNT(*) AS count FROM element_rooms WHERE creator_key = ? AND created_at > ?').bind(creator,now-600000).first();
   if(recent?.count>=12)fail('创建房间过于频繁，请稍后再试',429);
   for(let i=0;i<5;i++){
    const code=makeCode(),r={code,version:1,status:'lobby',mode:'ffa',host:uid,members:[{uid,name,type:'human',level:'medium',team:0,ready:true,lastSeen:now,tokenHash:await hash(token)}],game:null,gameId:null,createdAt:now,updatedAt:now,commands:[]};
    const result=await db.prepare('INSERT OR IGNORE INTO element_rooms (code, payload, version, expires_at, created_at, creator_key) VALUES (?, ?, ?, ?, ?, ?)').bind(code,JSON.stringify(r),1,now+TTL,now,creator).run();
    if(result.meta?.changes===1)return json({token,...viewRoom(r,uid,now)},201);
   }
   fail('暂时无法创建房间，请重试',503);
  }
  const code=String(parts[2]||'').toUpperCase();
  if(parts[3]==='join'&&request.method==='POST'){
   if(!/^[A-Z2-9]{6}$/.test(code))fail('请输入6位房间码');
   const token=randomToken(),digest=await hash(token),uid=crypto.randomUUID();
   for(let attempt=0;attempt<6;attempt++){
    const row=await rowFor(db,code,now),r=JSON.parse(row.payload);if(r.status!=='lobby')fail('对局已经开始，无法加入新席位',409);if(r.members.length>=(r.mode==='team'?4:5))fail('房间已满',409);
    r.members.push({uid,name:cleanName(body.name),type:'human',level:'medium',team:r.members.length%2,ready:false,lastSeen:now,tokenHash:digest});r.version=row.version+1;r.updatedAt=now;
    const out=await db.prepare('UPDATE element_rooms SET payload = ?, version = ?, expires_at = ? WHERE code = ? AND version = ?').bind(JSON.stringify(r),r.version,now+TTL,code,row.version).run();
    if(out.meta?.changes===1)return json({token,...viewRoom(r,uid,now)},201);
   }
   fail('房间正在同步，请重试',409);
  }
  if(parts.length===3&&request.method==='GET')return json(await updateRoom(db,code,bearer(request),null,now));
  if(parts.length===4&&parts[3]==='action'&&request.method==='POST')return json(await updateRoom(db,code,bearer(request),(r,m,t)=>operate(r,m,body,t),now));
  return json({error:'找不到此接口'},404);
 }catch(e){if(!(e instanceof RoomError))console.error('Element rooms:',e.message);return json({error:e instanceof RoomError?e.message:'房间同步失败，请稍后重试'},e.status||500);}
}
