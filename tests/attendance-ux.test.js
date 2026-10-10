import test from 'node:test';
import assert from 'node:assert/strict';
import {EMPLOYEE_EXAMPLE,EMPLOYEE_HELP,parseEmployeeCommand} from '../tgcloud/lib/employee-command.js';
import {shiftTokenFromQr,startTelegramQrScan} from '../web/qr-scan.js';
import {validateCloseComment} from '../tgcloud/lib/schedule.js';

test('employee help example is accepted; both common argument orders preserve names and exact cents',()=>{
 const expected={tgId:123456789,name:'Александр Петров',hourlyKopeks:35000};
 assert.deepEqual(parseEmployeeCommand(EMPLOYEE_EXAMPLE.slice('/employee '.length)),expected);
 assert.deepEqual(parseEmployeeCommand('123456789 Александр Петров 350'),expected);
 assert.deepEqual(parseEmployeeCommand(' 123456789\n350,25\nАлександр\tПетров '),{...expected,hourlyKopeks:35025});
 for(const value of ['TG_ID 350 Имя','123456789 Александр','0 350 Александр','9007199254740992 350 Александр','123456789 350.001 Александр','123456789 350 400']){
  assert.throws(()=>parseEmployeeCommand(value),e=>e.code==='BAD_COMMAND'&&e.message===EMPLOYEE_HELP);
 }
});
test('scanner accepts own bot QR and rejects foreign, spoofed, malformed and revocation links',()=>{
 const token='a'.repeat(32),link=`https://t.me/servgo_smena_bot?startapp=scan_${token}`;
 assert.equal(shiftTokenFromQr(link,'servgo_smena_bot'),token);
 assert.equal(shiftTokenFromQr(link.replace('servgo','ServGo'),'servgo_smena_bot'),token);
 for(const value of [link.replace('https:','http:'),link.replace('t.me','t.me.evil.test'),link.replace('servgo_smena_bot','other_bot'),link+'&startapp=scan_b',link+'#x',link.replace('scan_','kr1_'),`javascript:${link}`,token,link.replace(token,'short'),link.replace('t.me','user@t.me')]){
  assert.equal(shiftTokenFromQr(value,'servgo_smena_bot'),null,value);
 }
 assert.equal(shiftTokenFromQr(`https://t.me/servgo_smena_bot?startapp=scan_k1_${'a'.repeat(119)}`,'servgo_smena_bot'),'k1_'+'a'.repeat(119));
});
test('native scanner ignores foreign codes, consumes one own QR, detaches events and recovers after cancel',async()=>{
 let callback,closeListener,invalid=0,closed=0,tokens=[];
 const sdk={isVersionAtLeast:v=>v==='6.4',onEvent:(name,f)=>closeListener=f,offEvent:(name,f)=>{assert.equal(f,closeListener);closeListener=null;},showScanQrPopup:(params,f)=>callback=f};
 const handlers={onToken:t=>tokens.push(t),onInvalid:()=>invalid++,onClose:()=>closed++};
 startTelegramQrScan(sdk,'servgo_smena_bot',handlers);
 assert.equal(callback('https://example.com/'),false);assert.equal(invalid,1);assert.equal(closed,0);
 const token='b'.repeat(32);assert.equal(callback(`https://t.me/servgo_smena_bot?startapp=scan_${token}`),true);
 assert.equal(callback(`https://t.me/servgo_smena_bot?startapp=scan_${token}`),true);
 await Promise.resolve();assert.deepEqual(tokens,[token]);assert.equal(closed,1);assert.equal(closeListener,null);
 startTelegramQrScan(sdk,'servgo_smena_bot',handlers);closeListener();assert.equal(closed,2);
 assert.throws(()=>startTelegramQrScan({...sdk,isVersionAtLeast:()=>false},'servgo_smena_bot',handlers),/Обновите Telegram/);
});
test('optional comments are valid for arrival and ordinary departure; schedule reason remains required',()=>{
 assert.equal(validateCloseComment(' Задержка транспорта '),'Задержка транспорта');
 assert.equal(validateCloseComment(''),null);
 assert.equal(validateCloseComment('ОК',{required:false}),'ОК');
 assert.throws(()=>validateCloseComment('ОК',{required:true}),e=>e.code==='CLOSE_COMMENT_REQUIRED');
 assert.throws(()=>validateCloseComment('a'.repeat(501)),e=>e.code==='BAD_CLOSE_COMMENT');
});
