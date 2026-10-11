// Local SQLite rehearsal driven by the actual schema declarations, not the tgcloud migrator.
import {registerHooks} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const definitions=[];
const shim=`export const tables=[];
const column=(name,type)=>({name,type,notNull(){this.required=true;return this;},unique(){this.distinct=true;return this;},primaryKey(options={}){this.pk=true;this.auto=!!options.autoIncrement;return this;},default(value){this.value=value;return this;}});
export const integer=n=>column(n,'INTEGER'),text=n=>column(n,'TEXT'),json=n=>column(n,'TEXT');
export const sql=(strings,...args)=>strings.reduce((s,x,i)=>s+x+(args[i]??''),'');
const idx=(name,unique)=>({name,unique,on(...cols){this.cols=cols.map(x=>x.name);return this;},where(condition){this.condition=condition;return this;}});
export const index=n=>idx(n,false),uniqueIndex=n=>idx(n,true);
export function table(name,columns,indexes){const t={name,columns,...columns};tables.push({name,columns:Object.values(columns),indexes:indexes?Object.values(indexes(columns)):[]});return t;}`;
const uri='data:text/javascript,'+encodeURIComponent(shim);
registerHooks({resolve(spec,ctx,next){return spec==='sdk/db'?{url:uri,shortCircuit:true}:next(spec,ctx);}});
const {tables}=await import(uri);
await import('../tests/fixtures/legacy-shift-schema.js');definitions.push(JSON.parse(JSON.stringify(tables)));tables.length=0;
await import('../tgcloud/schema.js');definitions.push(JSON.parse(JSON.stringify(tables)));
const result=spawnSync('python3',[fileURLToPath(new URL('./check_shift_migration.py',import.meta.url))],{input:JSON.stringify(definitions),encoding:'utf8'});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');if(result.error)throw result.error;process.exitCode=result.status;
