import fs from 'node:fs';
import { applyMigration } from '../node_modules/@tgcloud/cli/src/api/endpoints.js';
import { loadCredentials } from '../node_modules/@tgcloud/cli/src/core/credentials.js';
import { changeId } from '../node_modules/@tgcloud/cli/src/core/db-changes.js';

if (process.env.SMENA_BACKUP_VERIFIED !== '1' || process.env.SMENA_MIGRATION_REVIEWED !== '1') {
  throw new Error('Verified backup and reviewed migration are required');
}
const token = process.env.TGCLOUD_TOKEN || loadCredentials()?.token;
if (!token) throw new Error('Telegram Serverless authorization is missing');
const schema = fs.readFileSync(new URL('../tgcloud/schema.js', import.meta.url), 'utf8');
// The platform may discover table indexes only after CREATE TABLE has completed.
// Publishing must wait for a confirmed empty diff, not merely a successful CLI exit.
for (let pass = 0; pass < 5; pass++) {
  const dry = await applyMigration(token, { schema, dry_run: true });
  if (!Array.isArray(dry.db_changes)) throw new Error('Unexpected migration response');
  if (!dry.db_changes.length) {
    console.log('Verified: database is fully in sync with the release schema.');
    process.exit(0);
  }
  if (dry.db_changes.some(c => c.status !== 'good' || !c.kind.startsWith('create_'))) {
    throw new Error('Remaining migration requires review; code was not published');
  }
  console.log(`Applying ${dry.db_changes.length} remaining additive changes (pass ${pass + 1}).`);
  await applyMigration(token, { schema, apply: dry.db_changes.map(changeId) });
}
throw new Error('Schema still differs after five passes; code was not published');
