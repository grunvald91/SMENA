import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const txt=(f)=>readFileSync(new URL('../'+f,import.meta.url),'utf8');

test('Telegram Serverless release keeps bot independent from ServGo VPS',()=>{
 const config=JSON.parse(txt('tgcloud.json'));
 assert.equal(config.static.source,'dist');
 assert.equal(config.static.spa,true);
 const entries=['tgcloud/handlers/message.js','tgcloud/lib/service.js','tgcloud/endpoints/ownerDashboard.js'];
 for(const path of entries){
   assert.doesNotMatch(txt(path), /https?:\/\/[^\s"'\x60]*servgo\.ru/i);
 }
 assert.match(txt('.gitignore'), /\.tgcloud\//);
});

test('release scripts require preflight and safe migrations',()=>{
 const preflight=txt('scripts/tgcloud_preflight.sh');
 const deploy=txt('scripts/tgcloud_deploy.sh');
 assert.match(preflight,/npm run check/);
 assert.match(preflight,/npm run build/);
 assert.match(preflight,/npm run build:kiosk/);
 assert.match(preflight,/check_additive_org_migration.py/);
 assert.match(preflight,/node --check/);
 assert.match(deploy,/migrate --dry-run --local/);
 assert.match(deploy,/migrate --local --safe/);
 assert.match(deploy,/SMENA_BACKUP_VERIFIED/);
 assert.match(deploy,/SMENA_MIGRATION_REVIEWED/);
 assert.ok(deploy.indexOf('migrate --local --safe') < deploy.indexOf('"$TG" push'),'Apply safe additive migrations before publishing handlers');
 assert.match(deploy,/webhook sync/);
 assert.doesNotMatch(deploy,/--force|--drop-pending|--yes/);
});
