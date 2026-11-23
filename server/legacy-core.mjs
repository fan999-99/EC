
'use strict';
const ELEMENTS=['金','木','水','火','土'];
const BEATS={金:'木',木:'土',土:'水',水:'火',火:'金'};
const COUNTER={金:'火',木:'金',土:'木',水:'土',火:'水'};
const TOOLS={掠夺:5,恢复:10,揽月:10,护盾:5};
const clone=x=>JSON.parse(JSON.stringify(x));
function catalogue(){
 const a=[];
 for(const e of ELEMENTS)for(let i=0;i<15;i++)a.push({id:`e-${e}-${i}`,type:'element',name:e,element:e});
 for(const [name,n]of Object.entries(TOOLS))for(let i=0;i<n;i++)a.push({id:`t-${name}-${i}`,type:'tool',name});
 for(const e of ELEMENTS)for(let i=0;i<2;i++)a.push({id:`i-${e}-${i}`,type:'identity',name:e,element:e});
 for(let i=0;i<6;i++)a.push({id:`h-${i}`,type:'health',name:'血量'});
 return a;
}
class Game{
 constructor(config,options={}){
  if(config.length<2||config.length>5)throw Error('请选择2—5名玩家');
  if(!options.testing&&!config.some(p=>p.type==='human'))throw Error('至少需要1名真人');
  const seed=(options.seed??Math.floor(Math.random()*4294967295))>>>0;
  this.s={version:1,rng:seed||17,rev:0,phase:'identity',choiceIndex:0,turn:0,starter:0,turnCount:0,
   used:{attack:false,tool:false},pending:null,deck:[],discard:[],out:[],players:[],dist:[],logs:[],winners:[],reason:'',setup:clone(config)};
  const cards=catalogue(),ids=this.shuffle(cards.filter(c=>c.type==='identity'));
  const hp=cards.filter(c=>c.type==='health');
  this.s.deck=this.shuffle(cards.filter(c=>c.type==='element'||c.type==='tool').filter(c=>!(config.length===2&&c.name==='揽月')));
  if(config.length===2)this.s.out.push(...cards.filter(c=>c.name==='揽月'));
  this.s.players=config.map((p,i)=>({id:i,name:String(p.name||`玩家${i+1}`).slice(0,16),type:p.type==='bot'?'bot':'human',level:p.level||'medium',
   hp:4,alive:true,hand:[],shield:null,element:null,identityCard:null,healthCard:hp[i],candidates:ids.splice(0,2)}));
  this.s.out.push(...ids,...hp.slice(config.length));
  this.s.dist=config.map((_,i)=>config.map((_,j)=>i===j?0:1));
  this.log('五行归位。每人从两张人物卡中选择身份。');
  this.advanceIdentity();
 }
 static restore(data){
  if(!data||data.version!==1||!Array.isArray(data.players))throw Error('存档版本不兼容');
  const g=Object.create(Game.prototype);g.s=clone(data);g.assert();return g;
 }
 random(){let x=this.s.rng;x^=x<<13;x^=x>>>17;x^=x<<5;this.s.rng=x>>>0;return this.s.rng/4294967296;}
 shuffle(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
 log(text){this.s.logs.push({text,turn:this.s.turnCount});if(this.s.logs.length>70)this.s.logs.shift();}
 actor(){const s=this.s;if(s.phase==='identity')return s.players[s.choiceIndex];if(s.phase==='response')return s.players[s.pending.target];if(s.phase==='action'||s.phase==='discard')return s.players[s.turn];return null;}
 advanceIdentity(){
  while(this.s.choiceIndex<this.s.players.length){
   const p=this.s.players[this.s.choiceIndex];if(p.type==='human')return;
   this.setIdentity(p,p.candidates[Math.floor(this.random()*p.candidates.length)].id);this.s.choiceIndex++;
  }
  this.begin();
 }
 setIdentity(p,id){const c=p.candidates.find(c=>c.id===id);if(!c)throw Error('请选择获得的人物卡');p.identityCard=c;p.element=c.element;this.s.out.push(...p.candidates.filter(c=>c.id!==id));p.candidates=[];this.log(`${p.name}选择了「${p.element}」身份。`);}
 begin(){
  const s=this.s;s.starter=Math.floor(this.random()*s.players.length);s.turn=s.starter;
  for(const p of s.players)this.draw(p,p.id===s.starter?7:5);
  s.turnCount=1;s.phase='action';this.log(`${s.players[s.starter].name}为起始玩家，初始7张手牌，首回合跳过摸牌。`);
 }
 draw(p,n){
  for(let i=0;i<n;i++){
   if(!this.s.deck.length&&this.s.discard.length){this.s.deck=this.shuffle(this.s.discard);this.s.discard=[];this.log('牌库用尽，弃牌堆重新洗入牌库。');}
   if(!this.s.deck.length){this.finishByRank();return false;}
   p.hand.push(this.s.deck.pop());
  }
  return true;
 }
 dispatch(a){
  const s=this.s,p=this.actor();
  try{
   if(a.rev!==undefined&&a.rev!==s.rev)throw Error('操作已过期，请重新选择');
   if(!p||a.actor!==p.id)throw Error('现在不是你的操作阶段');
   if(a.kind==='identity'){
    if(s.phase!=='identity')throw Error('身份已经确定');
    this.setIdentity(p,a.card);s.choiceIndex++;this.advanceIdentity();
   }else if(a.kind==='respond')this.respond(a,p);
   else if(a.kind==='discard')this.discardCards(a,p);
   else{
    if(s.phase!=='action'||!p.alive)throw Error('现在不能进行行动');
    if(a.kind==='attack')this.attack(a,p);
    else if(a.kind==='tool')this.tool(a,p);
    else if(a.kind==='end')this.endTurn(p);
    else throw Error('未知操作');
   }
   s.rev++;return {ok:true};
  }catch(e){return {ok:false,error:e.message};}
 }
 card(p,id){const c=p.hand.find(c=>c.id===id);if(!c)throw Error('这张牌不在你的手牌中');return c;}
 take(p,id){const i=p.hand.findIndex(c=>c.id===id);return p.hand.splice(i,1)[0];}
 target(id,p,allowSelf=false){const t=this.s.players[id];if(!t||!t.alive||(!allowSelf&&t.id===p.id))throw Error('请选择合法的存活目标');return t;}
 damage(c,t){return BEATS[c.element]===t.element?2:1;}
 attack(a,p){
  const s=this.s;if(s.used.attack)throw Error('本回合已攻击过');
  const c=this.card(p,a.card);if(c.type!=='element')throw Error('攻击需要基础元素牌');
  const t=this.target(a.target,p);if(s.dist[p.id][t.id]!==1)throw Error('只能攻击距离为1的玩家');
  const damage=this.damage(c,t);s.pending={card:this.take(p,c.id),attacker:p.id,target:t.id,element:c.element,damage};s.used.attack=true;s.phase='response';
  this.log(`${p.name}以「${c.element}」攻击${t.name}，伤害${damage}${damage===2?'（身份克制）':''}。`);
 }
 respond(a,p){
  const s=this.s;if(s.phase!=='response'||!s.pending)throw Error('没有等待结算的攻击');
  const hit=s.pending;let remaining=hit.damage;
  if(a.mode==='counter'){
   const ids=a.cards||[];
   if(!ids.length||ids.length>hit.damage||new Set(ids).size!==ids.length)throw Error('请选择正确数量的反制牌');
   const cards=ids.map(id=>this.card(p,id));
   if(cards.some(c=>c.type!=='element'||c.element!==COUNTER[hit.element]))throw Error(`本次只能用「${COUNTER[hit.element]}」反制`);
   for(const c of cards)s.discard.push(this.take(p,c.id));remaining-=cards.length;
   this.log(`${p.name}打出${cards.length}张「${COUNTER[hit.element]}」反制，抵消${cards.length}点伤害。`);
  }else if(a.mode==='shield'){
   if(!p.shield)throw Error('没有已经预置的护盾');s.discard.push(p.shield);p.shield=null;remaining=0;this.log(`${p.name}消耗护盾，抵消本次全部伤害。`);
  }else if(a.mode!=='take')throw Error('请选择防守方式');
  s.discard.push(hit.card);s.pending=null;p.hp=Math.max(0,p.hp-remaining);
  if(remaining)this.log(`${p.name}受到${remaining}点伤害，剩余${p.hp}血。`);
  else this.log(`${p.name}成功抵消伤害。`);
  if(p.hp===0)this.kill(p);
  if(this.checkVictory())return;
  this.unlockDistances();s.phase='action';
 }
 tool(a,p){
  const s=this.s,c=this.card(p,a.card);if(c.type!=='tool')throw Error('请选择道具牌');
  if(c.name==='护盾'){
   if(p.shield)throw Error('最多同时拥有1个护盾');p.shield=this.take(p,c.id);this.log(`${p.name}预置了护盾。`);return;
  }
  if(s.used.tool)throw Error('本回合已使用主动道具');
  const t=this.target(a.target,p,c.name==='恢复');
  if(c.name==='恢复'&&t.hp>=4)throw Error('满血玩家不需要恢复');
  if(c.name==='揽月'&&(s.setup.length===2||s.dist[p.id][t.id]!==1))throw Error('该目标不能再次使用揽月');
  s.discard.push(this.take(p,c.id));s.used.tool=true;
  if(c.name==='恢复'){t.hp++;this.log(`${p.name}使用恢复，${t.name}恢复至${t.hp}血。`);}
  if(c.name==='掠夺'){
   const n=Math.min(2,t.hand.length);for(let i=0;i<n;i++){const k=Math.floor(this.random()*t.hand.length);p.hand.push(t.hand.splice(k,1)[0]);}
   this.log(`${p.name}从${t.name}随机掠夺了${n}张手牌。`);
  }
  if(c.name==='揽月'){s.dist[p.id][t.id]=s.dist[t.id][p.id]=2;this.log(`${p.name}对${t.name}使用揽月，双方距离变为2。`);this.unlockDistances();}
 }
 kill(p){
  const s=this.s;p.alive=false;s.discard.push(...p.hand);p.hand=[];
  if(p.shield){s.discard.push(p.shield);p.shield=null;}
  if(p.identityCard){s.out.push(p.identityCard);p.identityCard=null;}
  if(p.healthCard){s.out.push(p.healthCard);p.healthCard=null;}
  for(let i=0;i<s.players.length;i++)s.dist[p.id][i]=s.dist[i][p.id]=0;
  this.log(`${p.name}血量归零，退出对局。`);
 }
 unlockDistances(){
  const living=this.s.players.filter(p=>p.alive);if(living.length<2)return;
  if(living.some(p=>living.some(t=>p.id!==t.id&&this.s.dist[p.id][t.id]===1)))return;
  for(const p of living)for(const t of living)if(p.id!==t.id)this.s.dist[p.id][t.id]=1;
  this.log('无可攻击的玩家对，揽月结界解除。');
 }
 endTurn(p){if(p.hand.length>p.hp*2){this.s.phase='discard';return;}this.nextTurn();}
 discardCards(a,p){
  if(this.s.phase!=='discard')throw Error('现在不是弃牌阶段');
  const n=Math.max(0,p.hand.length-p.hp*2),ids=a.cards||[];
  if(ids.length!==n||new Set(ids).size!==n)throw Error(`必须弃置${n}张牌`);
  ids.forEach(id=>this.card(p,id));for(const id of ids)this.s.discard.push(this.take(p,id));this.log(`${p.name}弃置${n}张牌，手牌回到上限${p.hp*2}。`);this.nextTurn();
 }
 nextTurn(){
  if(this.checkVictory())return;const s=this.s;
  do{s.turn=(s.turn+1)%s.players.length;}while(!s.players[s.turn].alive);
  s.turnCount++;s.used={attack:false,tool:false};s.phase='draw';const p=s.players[s.turn];
  if(!this.draw(p,2))return;s.phase='action';this.log(`第${s.turnCount}回合 · ${p.name}摸2张牌。`);
 }
 checkVictory(){const live=this.s.players.filter(p=>p.alive);if(live.length===1){this.finish([live[0].id],'最后一名存活玩家');return true;}return this.s.phase==='over';}
 finishByRank(){
  const p=this.s.players.filter(p=>p.alive);const hp=Math.max(...p.map(p=>p.hp));const a=p.filter(p=>p.hp===hp);const n=Math.max(...a.map(p=>p.hand.length));
  this.finish(a.filter(p=>p.hand.length===n).map(p=>p.id),'牌库与弃牌堆均为空，依血量与手牌数判定');
 }
 finish(winners,reason){this.s.winners=winners;this.s.reason=reason;this.s.phase='over';this.log(`${winners.map(i=>this.s.players[i].name).join('、')}${winners.length>1?'并列':'获得'}胜利。`);}
 publicView(id){
  const s=this.s,p=s.players[id];return {rev:s.rev,phase:s.phase,turn:s.turn,turnCount:s.turnCount,used:{...s.used},
   self:{id:p.id,name:p.name,hp:p.hp,element:p.element,alive:p.alive,hand:p.hand.map(c=>({...c})),hasShield:!!p.shield,level:p.level},
   players:s.players.map(t=>({id:t.id,name:t.name,hp:t.hp,element:t.element,alive:t.alive,handCount:t.hand.length,hasShield:!!t.shield})),
   dist:s.dist.map(a=>a.slice()),pending:s.pending?{attacker:s.pending.attacker,target:s.pending.target,element:s.pending.element,damage:s.pending.damage}:null};
 }
 assert(){
  const s=this.s,all=[...s.deck,...s.discard,...s.out];
  for(const p of s.players){all.push(...p.hand,...p.candidates);if(p.identityCard)all.push(p.identityCard);if(p.healthCard)all.push(p.healthCard);if(p.shield)all.push(p.shield);}
  if(s.pending)all.push(s.pending.card);
  const expected=catalogue(),names=new Map(expected.map(c=>[c.id,c]));
  if(all.length!==121||new Set(all.map(c=>c.id)).size!==121||all.some(c=>!names.has(c.id)))throw Error('卡牌数量或编号异常');
  if(all.some(c=>{const e=names.get(c.id);return c.type!==e.type||c.name!==e.name||c.element!==e.element;}))throw Error('卡牌内容异常');
  if(s.players.length<2||s.players.length>5)throw Error('玩家人数异常');
  if(!['identity','action','response','discard','draw','over'].includes(s.phase))throw Error('对局阶段异常');
  for(const p of s.players){
   if(p.hp<0||p.hp>4||p.alive!==(p.hp>0))throw Error('血量异常');
   if(p.hand.some(c=>!['element','tool'].includes(c.type)))throw Error('人物或血量牌进入手牌');
   if(p.shield&&p.shield.name!=='护盾')throw Error('护盾异常');
   for(const t of s.players){const d=s.dist[p.id]?.[t.id];if(d!==s.dist[t.id]?.[p.id]||![0,1,2].includes(d))throw Error('距离异常');}
  }
  if(s.deck.some(c=>!['element','tool'].includes(c.type)))throw Error('牌库类型异常');
  if(s.setup.length===2&&[...s.deck,...s.discard,...s.players.flatMap(p=>p.hand)].some(c=>c.name==='揽月'))throw Error('双人局出现揽月');
  if(s.phase==='response'&&!s.pending)throw Error('缺失待结算攻击');
  return true;
 }
}
function cardValue(c,v){
 const p=v.self,h=p.hand;
 if(c.type==='tool'){
  if(c.name==='恢复')return p.hp<3?36:22;
  if(c.name==='护盾')return p.hasShield?7:29;
  if(c.name==='掠夺')return 24;
  return p.hp<=2?18:9;
 }
 const danger=ELEMENTS.find(e=>BEATS[e]===p.element),counter=COUNTER[danger];
 const n=h.filter(a=>a.element===c.element).length;
 return 13+(c.element===counter?9:0)+(n<=2?6:0)+v.players.some(t=>t.alive&&t.id!==p.id&&v.dist[p.id][t.id]===1&&BEATS[c.element]===t.element)*5;
}
const Bot={
 choose(v,random=Math.random){
  const p=v.self,base={actor:p.id,rev:v.rev},easy=p.level==='easy',hard=p.level==='hard';
  if(v.phase==='response'){
   const hit=v.pending,correct=p.hand.filter(c=>c.element===COUNTER[hit.element]).slice(0,hit.damage);
   if(easy&&p.hp>hit.damage&&random()<.15)return {...base,kind:'respond',mode:'take'};
   const costly=hard&&correct.reduce((n,c)=>n+cardValue(c,v),0)>34;
   if(p.hasShield&&(hit.damage===2||correct.length<hit.damage||costly))return {...base,kind:'respond',mode:'shield'};
   if(correct.length)return {...base,kind:'respond',mode:'counter',cards:correct.map(c=>c.id)};
   if(p.hasShield)return {...base,kind:'respond',mode:'shield'};
   return {...base,kind:'respond',mode:'take'};
  }
  if(v.phase==='discard'){
   const n=p.hand.length-p.hp*2;
   const cards=easy?p.hand.map(c=>({c,value:random()})):p.hand.map(c=>({c,value:cardValue(c,v)+random()*.1}));
   return {...base,kind:'discard',cards:cards.sort((a,b)=>a.value-b.value).slice(0,n).map(a=>a.c.id)};
  }
  if(v.phase!=='action')return null;
  const live=v.players.filter(t=>t.alive&&t.id!==p.id),options=[],attacks=[];
  if(!v.used.attack){
   const used=new Set();
   for(const c of p.hand.filter(c=>c.type==='element')){
    if(used.has(c.element))continue;used.add(c.element);
    for(const t of live.filter(t=>v.dist[p.id][t.id]===1)){
     const damage=BEATS[c.element]===t.element?2:1;
     const likelyKill=t.hp<=damage&&!t.hasShield;
     let score=damage*15+(likelyKill?75:0)+(4-t.hp)*3-(t.hasShield?17:0);
     if(hard)score-=Math.min(t.handCount,7)*(likelyKill?5:1)+cardValue(c,v)*.16;
     const o={score,kind:'attack',card:c.id,target:t.id,damage,likelyKill};options.push(o);attacks.push(o);
    }
   }
  }
  const shields=p.hand.filter(c=>c.name==='护盾');if(!p.hasShield&&shields.length)options.push({score:p.hp<=2?67:37,kind:'tool',card:shields[0].id});
  if(!v.used.tool){
   for(const name of ['恢复','掠夺','揽月']){
    const c=p.hand.find(c=>c.name===name);if(!c)continue;
    if(name==='恢复'){
     if(p.hp<4)options.push({score:p.hp<=2?91:29,kind:'tool',card:c.id,target:p.id});
     if(easy)for(const t of live.filter(t=>t.hp<4))options.push({score:8,kind:'tool',card:c.id,target:t.id});
    }
    if(name==='掠夺')for(const t of live.filter(t=>t.handCount)){
     let score=22+Math.min(2,t.handCount)*8+(p.hand.length<4?13:0);
     if(hard&&t.handCount<=2&&attacks.some(a=>a.target===t.id&&a.likelyKill))score+=72;
     options.push({score,kind:'tool',card:c.id,target:t.id});
    }
    if(name==='揽月'&&live.length>1)for(const t of live.filter(t=>v.dist[p.id][t.id]===1)){
     const best=attacks.filter(a=>a.target===t.id).reduce((n,a)=>Math.max(n,a.score),0);
     const score=(p.hp<=2?33:8)+Math.min(7,t.handCount)*2-(hard?best*.6:best*.4);
     if(score>0||easy)options.push({score,kind:'tool',card:c.id,target:t.id});
    }
   }
  }
  if(!options.length||(easy&&random()<.12))return {...base,kind:'end'};
  const pick=easy?options[Math.floor(random()*options.length)]:options.map(o=>({...o,score:o.score+random()*.5})).sort((a,b)=>b.score-a.score)[0];
  return {...base,kind:pick.kind,card:pick.card,target:pick.target};
 }
};

export {Game,Bot,ELEMENTS,BEATS,COUNTER,TOOLS,catalogue};
