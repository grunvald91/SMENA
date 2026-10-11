export const rows={},sent=[];
export let failure=null;
export function reset(){for(const k of Object.keys(rows))delete rows[k];sent.length=0;failure=null;}
export function failWith(e){failure=e;}
const names=['organizations','locations','employees','shifts','devices','deviceChallenges','qrPasses','shiftEvents','bonuses','auditLog','photoIntents','shiftTemplates','shiftAssignments','controlRequests','controlSubmissions','aiChatSettings','aiMessages'];
const make=name=>new Proxy({name},{get:(t,p)=>p==='name'?t.name:{table:name,key:p}});
export const [organizations,locations,employees,shifts,devices,deviceChallenges,qrPasses,shiftEvents,bonuses,auditLog,photoIntents,shiftTemplates,shiftAssignments,controlRequests,controlSubmissions,aiChatSettings,aiMessages]=names.map(make);
export const eq=(c,v)=>r=>r[c.key]===v;
export const lt=(c,v)=>r=>r[c.key]<v;
export const lte=(c,v)=>r=>r[c.key]<=v;
export const gt=(c,v)=>r=>r[c.key]>v;
export const gte=(c,v)=>r=>r[c.key]>=v;
export const isNull=c=>r=>r[c.key]==null;
export const and=(...fs)=>r=>fs.every(f=>f(r));
export const or=(...fs)=>r=>fs.some(f=>f(r));
export const inArray=(c,vs)=>r=>vs.includes(r[c.key]);
export const desc=c=>(a,b)=>b[c.key]-a[c.key];
export const db={
 select(){let table,condition=()=>true,sort,limit=Infinity;const result=()=>{let r=(rows[table.name]||[]).filter(condition);if(sort)r=r.toSorted(sort);return r.slice(0,limit).map(x=>({...x}));};return {from(t){table=t;return this;},where(f){condition=f;return this;},orderBy(f){sort=f;return this;},limit(n){limit=n;return this;},async all(){return result();},async get(){return result()[0];}};},
 insert(t){let value,ret=false;return {values(v){value=v;return this;},returning(){ret=true;return this;},async run(){const row={id:(rows[t.name]?.length||0)+1,...(t.name==='controlRequests'?{notificationState:'pending'}:{}),...(t.name==='controlSubmissions'?{status:'pending'}:{}),...value};(rows[t.name]??=[]).push(row);return ret?[{...row}]:{rowsAffected:1};}};},
 update(t){let value,condition=()=>true;return {set(v){value=v;return this;},where(f){condition=f;return this;},async run(){let n=0;for(const row of rows[t.name]||[])if(condition(row)){Object.assign(row,value);n++;}return {rowsAffected:n};}};}
};
export class InputFile{constructor(bytes,name){this.bytes=bytes;this.name=name;}}
export class BotApiError extends Error{constructor(code){super('Telegram rejected');this.code=code;}}
export class EndpointError extends Error{}
const send=(method,params)=>{sent.push({method,params});if(failure)throw failure;const files=params.media||[params];const msgs=files.map((_,i)=>({message_id:100+sent.length+i,photo:[{file_id:'file-'+i}]}));return method==='sendMediaGroup'?msgs:msgs[0];};
export const api={getMe:async()=>({username:'servgo_smena_bot'}),sendMessage:async p=>send('sendMessage',p),sendPhoto:async p=>send('sendPhoto',p),sendMediaGroup:async p=>send('sendMediaGroup',p)};
