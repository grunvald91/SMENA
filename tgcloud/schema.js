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


// Business memory is opt-in per already bound work chat. The data stays tenant-scoped.
export const aiChatSettings=table('ai_chat_settings',{
 chatId:integer('chat_id').primaryKey(),orgId:integer('org_id').notNull(),
 enabledAt:integer('enabled_at').notNull(),enabledBy:integer('enabled_by').notNull(),
 active:integer('active').notNull().default(1)
},t=>({org:index('idx_ai_settings_org').on(t.orgId)}));

export const aiMessages=table('ai_messages',{
 id:integer('id').primaryKey({autoIncrement:true}),
 orgId:integer('org_id').notNull(),chatId:integer('chat_id').notNull(),
 messageId:integer('message_id').notNull(),threadId:integer('thread_id'),
 authorTgId:integer('author_tg_id'),senderChatId:integer('sender_chat_id'),
 replyToMessageId:integer('reply_to_message_id'),sentAt:integer('sent_at').notNull(),
 editedAt:integer('edited_at'),kind:text('kind').notNull(),
 content:text('content').notNull().default(''),
 fileId:text('file_id'),mediaGroupId:text('media_group_id'),
 capturedAt:integer('captured_at').notNull()
},t=>({unique:uniqueIndex('uq_ai_message_chat_id').on(t.chatId,t.messageId),
 orgTime:index('idx_ai_msg_org_sent').on(t.orgId,t.sentAt)}));

export const aiReactions=table('ai_reactions',{
 id:integer('id').primaryKey({autoIncrement:true}),
 orgId:integer('org_id').notNull(),chatId:integer('chat_id').notNull(),
 messageId:integer('message_id').notNull(),actorKey:text('actor_key').notNull(),
 reactions:json('reactions').notNull(),updatedAt:integer('updated_at').notNull()
},t=>({unique:uniqueIndex('uq_ai_reaction_actor').on(t.chatId,t.messageId,t.actorKey)}));

export const aiReactionTotals=table('ai_reaction_totals',{
 id:integer('id').primaryKey({autoIncrement:true}),
 orgId:integer('org_id').notNull(),chatId:integer('chat_id').notNull(),
 messageId:integer('message_id').notNull(),reactions:json('reactions').notNull(),
 updatedAt:integer('updated_at').notNull()
},t=>({unique:uniqueIndex('uq_ai_reaction_total').on(t.chatId,t.messageId)}));

export const aiFindings=table('ai_findings',{
 id:integer('id').primaryKey({autoIncrement:true}),
 orgId:integer('org_id').notNull(),title:text('title').notNull(),
 statement:text('statement').notNull(),status:text('status').notNull().default('proposed'),
 evidence:json('evidence').notNull(),periodStart:integer('period_start').notNull(),
 periodEnd:integer('period_end').notNull(),
 reviewedBy:integer('reviewed_by'),reviewedAt:integer('reviewed_at'),
 correctedStatement:text('corrected_statement'),createdAt:integer('created_at').notNull(),
 origin:text('origin').notNull().default('rules'),modelBatchKey:text('model_batch_key')
},t=>({review:index('idx_ai_findings_org_status').on(t.orgId,t.status),
 batch:uniqueIndex('uq_ai_model_batch_key').on(t.orgId,t.modelBatchKey)}));


// Provider keys never enter Telegram Serverless. This per-organization *gateway*
// capability is revocable and limited by the ServGo gateway's allowlist/quota.
export const aiGatewaySettings=table('ai_gateway_settings',{
 orgId:integer('org_id').primaryKey(),
 capability:text('capability').notNull(),
 active:integer('active').notNull().default(0),
 configuredAt:integer('configured_at').notNull()
});
export const aiAnalysisProgress=table('ai_analysis_progress',{
 orgId:integer('org_id').primaryKey(),
 cursorId:integer('cursor_id').notNull().default(0),
 busyUntil:integer('busy_until').notNull().default(0),
 lockToken:text('lock_token'),
 updatedAt:integer('updated_at').notNull()
});


export const aiParticipants=table('ai_participants',{
 id:integer('id').primaryKey({autoIncrement:true}),
 orgId:integer('org_id').notNull(),actorKey:text('actor_key').notNull(),
 alias:text('alias').notNull()
},t=>({actor:uniqueIndex('uq_ai_participant_org').on(t.orgId,t.actorKey)}));


// One tenant-wide calibration clock. A due review is dispatched on the next
// observed event; a separate trusted scheduler is required for exact deadlines.
export const aiCalibrationSchedules=table('ai_calibration_schedules',{
 orgId:integer('org_id').primaryKey(),
 dueAt:integer('due_at').notNull(),
 lastSentAt:integer('last_sent_at'),
 busyUntil:integer('busy_until').notNull().default(0),
 claimToken:text('claim_token')
});
