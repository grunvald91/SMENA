import { table,integer,text,json,index,uniqueIndex,sql } from 'sdk/db';
export const organizations=table('organizations',{
 id:integer('id').primaryKey({autoIncrement:true}),ownerTgId:integer('owner_tg_id').notNull().unique(),
 name:text('name').notNull(),timezone:text('timezone').notNull().default('Europe/Moscow'),createdAt:integer('created_at').notNull()
});
export const locations=table('locations',{
 id:integer('id').primaryKey({autoIncrement:true}),orgId:integer('org_id').notNull(),
 name:text('name').notNull(),chatId:integer('chat_id').unique()
},t=>({org:index('idx_locations_org').on(t.orgId)}));
export const employees=table('employees',{
 id:integer('id').primaryKey({autoIncrement:true}),orgId:integer('org_id').notNull(),tgId:integer('tg_id').notNull(),
 name:text('name').notNull(),hourlyKopeks:integer('hourly_kopeks').notNull().default(0),shiftBonusKopeks:integer('shift_bonus_kopeks').notNull().default(0),active:integer('active').notNull().default(1)
},t=>({uniq:uniqueIndex('uq_employee_org_tg').on(t.orgId,t.tgId)}));
export const devices=table('devices',{
 id:integer('id').primaryKey({autoIncrement:true}),orgId:integer('org_id').notNull(),locationId:integer('location_id').notNull(),
 publicJwk:json('public_jwk').notNull(),registeredBy:integer('registered_by').notNull(),
 createdAt:integer('created_at').notNull(),revokedAt:integer('revoked_at')
},t=>({active:uniqueIndex('uq_active_device_loc').on(t.locationId).where(sql`revoked_at IS NULL`)}));
export const deviceChallenges=table('device_challenges',{
 id:text('id').primaryKey(),deviceId:integer('device_id').notNull(),nonce:text('nonce').notNull(),
 expiresAt:integer('expires_at').notNull(),usedAt:integer('used_at')
});
export const qrPasses=table('qr_passes',{
 token:text('token').primaryKey(),deviceId:integer('device_id').notNull(),orgId:integer('org_id').notNull(),
 locationId:integer('location_id').notNull(),createdAt:integer('created_at').notNull(),expiresAt:integer('expires_at').notNull()
},t=>({loc:index('idx_qr_loc').on(t.locationId)}));
export const shifts=table('shifts',{
 id:integer('id').primaryKey({autoIncrement:true}),orgId:integer('org_id').notNull(),locationId:integer('location_id').notNull(),
 employeeId:integer('employee_id').notNull(),startedAt:integer('started_at').notNull(),endedAt:integer('ended_at'),
 hourlyKopeksSnapshot:integer('hourly_kopeks_snapshot').notNull(),shiftBonusKopeksSnapshot:integer('shift_bonus_kopeks_snapshot').notNull().default(0),
 sourceIn:text('source_in').notNull(),sourceOut:text('source_out'),createdAt:integer('created_at').notNull()
},t=>({employee:index('idx_shifts_employee_start').on(t.employeeId,t.startedAt),
 open:uniqueIndex('uq_employee_open_shift').on(t.employeeId).where(sql`ended_at IS NULL`)}));
export const shiftEvents=table('shift_events',{
 id:integer('id').primaryKey({autoIncrement:true}),shiftId:integer('shift_id').notNull(),actorTgId:integer('actor_tg_id').notNull(),
 action:text('action').notNull(),at:integer('at').notNull(),qrToken:text('qr_token'),photoFileId:text('photo_file_id'),note:text('note')
},t=>({shift:index('idx_events_shift').on(t.shiftId)}));
export const bonuses=table('bonuses',{
 id:integer('id').primaryKey({autoIncrement:true}),orgId:integer('org_id').notNull(),employeeId:integer('employee_id').notNull(),
 date:text('date').notNull(),amountKopeks:integer('amount_kopeks').notNull(),reason:text('reason').notNull(),
 actorTgId:integer('actor_tg_id').notNull()
},t=>({period:index('idx_bonuses_period').on(t.orgId,t.date)}));
export const auditLog=table('audit_log',{
 id:integer('id').primaryKey({autoIncrement:true}),orgId:integer('org_id').notNull(),actorTgId:integer('actor_tg_id').notNull(),
 action:text('action').notNull(),refId:text('ref_id'),data:json('data'),at:integer('at').notNull()
});

// One-time proof that a Telegram employee scanned a valid workplace QR BEFORE taking the selfie.
// No image bytes are stored in the database, only Telegram's file_id/message_id.
export const photoIntents=table('photo_intents',{
 id:text('id').primaryKey(),qrToken:text('qr_token').notNull(),
 orgId:integer('org_id').notNull(),locationId:integer('location_id').notNull(),
 employeeId:integer('employee_id').notNull(),actorTgId:integer('actor_tg_id').notNull(),
 action:text('action').notNull(),createdAt:integer('created_at').notNull(),
 expiresAt:integer('expires_at').notNull(),status:text('status').notNull().default('pending'),
 photoFileId:text('photo_file_id'),photoMessageId:integer('photo_message_id'),shiftId:integer('shift_id')
},t=>({employee:index('idx_photo_intent_actor').on(t.actorTgId,t.createdAt)}));
