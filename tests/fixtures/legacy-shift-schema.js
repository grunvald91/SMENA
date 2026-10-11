// Baseline: GitHub d82c603a802606525581faa7006d00ed5f025e1f. Test-only schema.
import { table,integer,text,json,index,uniqueIndex,sql } from 'sdk/db';
export const organizations=table('organizations',{
 id:integer('id').primaryKey({autoIncrement:true}),ownerTgId:integer('owner_tg_id').notNull().unique(),
 name:text('name').notNull(),timezone:text('timezone').notNull().default('Europe/Moscow'),createdAt:integer('created_at').notNull()
});
export const locations=table('locations',{
 id:integer('id').primaryKey({autoIncrement:true}),orgId:integer('org_id').notNull(),
 name:text('name').notNull(),chatId:integer('chat_id').unique(),
 plannedStartTime:text('planned_start_time'),plannedEndTime:text('planned_end_time'),closeGraceMinutes:integer('close_grace_minutes').notNull().default(5)
},t=>({org:index('idx_locations_org').on(t.orgId)}));
export const employees=table('employees',{
 id:integer('id').primaryKey({autoIncrement:true}),orgId:integer('org_id').notNull(),tgId:integer('tg_id').notNull(),
 name:text('name').notNull(),hourlyKopeks:integer('hourly_kopeks').notNull().default(0),shiftBonusKopeks:integer('shift_bonus_kopeks').notNull().default(0),active:integer('active').notNull().default(1)
},t=>({uniq:uniqueIndex('uq_employee_org_tg').on(t.orgId,t.tgId)}));
// Named morning/evening/etc shifts per work location. The date is the START date for overnight shifts.
export const shiftTemplates=table('shift_templates',{
 id:integer('id').primaryKey({autoIncrement:true}),orgId:integer('org_id').notNull(),locationId:integer('location_id').notNull(),
 name:text('name').notNull(),startTime:text('start_time').notNull(),endTime:text('end_time').notNull(),
 graceMinutes:integer('grace_minutes').notNull().default(5),active:integer('active').notNull().default(1)
},t=>({location:index('idx_templates_location').on(t.locationId)}));
export const shiftAssignments=table('shift_assignments',{
 id:integer('id').primaryKey({autoIncrement:true}),orgId:integer('org_id').notNull(),locationId:integer('location_id').notNull(),
 employeeId:integer('employee_id').notNull(),templateId:integer('template_id').notNull(),workDate:text('work_date').notNull(),
 createdBy:integer('created_by').notNull(),createdAt:integer('created_at').notNull()
},t=>({day:index('idx_assignment_day').on(t.orgId,t.workDate),
 employee:uniqueIndex('uq_assignment_employee_day_template').on(t.employeeId,t.workDate,t.templateId)}));
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
 sourceIn:text('source_in').notNull(),sourceOut:text('source_out'),createdAt:integer('created_at').notNull(),
 plannedStartAt:integer('planned_start_at'),plannedEndAt:integer('planned_end_at'),closeGraceMinutes:integer('close_grace_minutes'),closeComment:text('close_comment'),
 templateId:integer('template_id'),assignmentId:integer('assignment_id')
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
 photoFileId:text('photo_file_id'),photoMessageId:integer('photo_message_id'),shiftId:integer('shift_id'),
 closeComment:text('close_comment')
},t=>({employee:index('idx_photo_intent_actor').on(t.actorTgId,t.createdAt)}));

// Control tasks snapshot recipients. Images remain in Telegram, never in SQLite.
export const controlRequests=table('control_requests',{
 id:text('id').primaryKey(),orgId:integer('org_id').notNull(),locationId:integer('location_id').notNull(),
 instruction:text('instruction').notNull(),deadlineAt:integer('deadline_at').notNull(),
 targets:json('targets').notNull(),createdBy:integer('created_by').notNull(),createdAt:integer('created_at').notNull(),
 notificationState:text('notification_state').notNull().default('pending'),messageId:integer('message_id')
},t=>({org:index('idx_control_requests_org').on(t.orgId,t.createdAt)}));
export const controlSubmissions=table('control_submissions',{
 id:text('id').primaryKey(),requestId:text('request_id').notNull(),orgId:integer('org_id').notNull(),
 employeeId:integer('employee_id').notNull(),deviceId:integer('device_id').notNull(),createdAt:integer('created_at').notNull(),expiresAt:integer('expires_at').notNull(),
 status:text('status').notNull().default('pending'),comment:text('comment'),completedAt:integer('completed_at'),
 photos:json('photos')
},t=>({recipient:uniqueIndex('uq_control_recipient').on(t.requestId,t.employeeId)}));

 
// Additive transitional membership table; existing owner_tg_id remains authoritative.
export const organizationMemberships=table('organization_memberships',{
 id:integer('id').primaryKey({autoIncrement:true}),
 orgId:integer('org_id').notNull(),
 userTgId:integer('user_tg_id').notNull(),
 role:text('role').notNull(),
 status:text('status').notNull().default('active'),
 createdBy:integer('created_by').notNull(),
 createdAt:integer('created_at').notNull()
},t=>({
 member:uniqueIndex('uq_org_membership_org_user').on(t.orgId,t.userTgId),
 actor:index('idx_org_membership_actor').on(t.userTgId,t.status)
}));

// Additive user preference. NOT a permission grant: always re-check active memberships.
export const userOrganizationSelections=table('user_organization_selections',{
 userTgId:integer('user_tg_id').primaryKey(),
 orgId:integer('org_id').notNull(),
 updatedAt:integer('updated_at').notNull()
});

 // One active onboarding dialogue for each Telegram user. Never trust chat_shared without matching request ID.
export const onboardingSessions=table('onboarding_sessions',{
 userTgId:integer('user_tg_id').primaryKey(),
 phase:text('phase').notNull(),
 requestId:integer('request_id'),
 expiresAt:integer('expires_at').notNull(),
 updatedAt:integer('updated_at').notNull()
});

// Shareable, time-limited Telegram invitations. Tokens are cryptographically random.
export const employeeJoinInvites=table('employee_join_invites',{
 token:text('token').primaryKey(),orgId:integer('org_id').notNull(),
 createdBy:integer('created_by').notNull(),createdAt:integer('created_at').notNull(),
 expiresAt:integer('expires_at').notNull(),revokedAt:integer('revoked_at')
},t=>({org:index('idx_join_invite_org').on(t.orgId)}));
export const employeeJoinRequests=table('employee_join_requests',{
 id:integer('id').primaryKey({autoIncrement:true}),orgId:integer('org_id').notNull(),
 userTgId:integer('user_tg_id').notNull(),name:text('name').notNull().default(''),
 status:text('status').notNull().default('draft'),
 createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),
 reviewedBy:integer('reviewed_by'),reviewedAt:integer('reviewed_at')
},t=>({
 uniq:uniqueIndex('uq_join_org_user').on(t.orgId,t.userTgId),
 pending:index('idx_join_org_status').on(t.orgId,t.status)
}));
