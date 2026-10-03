import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, primaryKey, foreignKey, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';

export const aiLearningSessions = sqliteTable('ai_learning_sessions', {
  id: text('id').primaryKey(), workspaceId: text('workspace_id').notNull(), learnerId: text('learner_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id), lang: text('lang').notNull(), level: integer('level').notNull(),
  payload: text('payload').notNull(), updatedAt: integer('updated_at').notNull(),
}, t => [foreignKey({columns:[t.workspaceId,t.learnerId],foreignColumns:[learners.workspaceId,learners.id]}).onDelete('cascade'),
  index('idx_ai_learning_context').on(t.workspaceId,t.learnerId,t.userId,t.updatedAt)]);
export const aiLearningUsage = sqliteTable('ai_learning_usage', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), sessionId: text('session_id').notNull(),
  digest: text('digest').notNull(), status: text('status').notNull(), createdAt: integer('created_at').notNull(),
}, t => [index('idx_ai_learning_usage_user').on(t.userId,t.createdAt),index('idx_ai_learning_usage_time').on(t.createdAt),
  check('ai_learning_usage_status',sql`${t.status} IN ('pending','complete','failed')`)]);

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), email: text('email').notNull(), name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
  deviceRecoveryKey: text('device_recovery_key'),
});
export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(), name: text('name').notNull(),
  ownerId: text('owner_id').notNull().references(() => users.id),
  revision: integer('revision').notNull().default(0), lastMutation: text('last_mutation'),
  createdAt: integer('created_at').notNull(),
});
export const memberships = sqliteTable('memberships', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id), role: text('role').notNull(),
  status: text('status').notNull().default('active'), joinedAt: integer('joined_at').notNull(),
  accessVersion: integer('access_version').notNull().default(0),
}, t => [primaryKey({ columns: [t.workspaceId, t.userId] }),
  index('idx_memberships_user_status').on(t.userId, t.status),
  check('membership_role', sql`${t.role} IN ('admin','teacher','parent')`),
  check('membership_status', sql`${t.status} IN ('active','inactive')`)]);
export const learners = sqliteTable('learners', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  id: text('id').notNull(), code: text('code').notNull(), codeKey: text('code_key').notNull(),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, t => [primaryKey({ columns: [t.workspaceId, t.id] }),
  uniqueIndex('idx_learners_workspace_code').on(t.workspaceId, t.codeKey)]);
export const sessions = sqliteTable('sessions', {
  workspaceId: text('workspace_id').notNull(), id: text('id').notNull(), learnerId: text('learner_id').notNull(),
  payload: text('payload').notNull(), lang: text('lang').notNull(), level: integer('level').notNull(),
  mode: text('mode').notNull(), at: text('at').notNull(), createdAt: integer('created_at').notNull(),
  createdBy: text('created_by').notNull().references(() => users.id),
}, t => [primaryKey({ columns: [t.workspaceId, t.id] }),
  foreignKey({ columns: [t.workspaceId, t.learnerId], foreignColumns: [learners.workspaceId, learners.id] }).onDelete('cascade'),
  index('idx_sessions_workspace_learner_at').on(t.workspaceId, t.learnerId, t.at)]);
export const learnerAccess = sqliteTable('learner_access', {
  workspaceId: text('workspace_id').notNull(), userId: text('user_id').notNull(), learnerId: text('learner_id').notNull(),
}, t => [primaryKey({ columns: [t.workspaceId, t.userId, t.learnerId] }),
  foreignKey({ columns: [t.workspaceId, t.userId], foreignColumns: [memberships.workspaceId, memberships.userId] }).onDelete('cascade'),
  foreignKey({ columns: [t.workspaceId, t.learnerId], foreignColumns: [learners.workspaceId, learners.id] }).onDelete('cascade')]);
export const invitations = sqliteTable('invitations', {
  id: text('id').primaryKey(), workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email').notNull(), role: text('role').notNull(), learnerIds: text('learner_ids').notNull(),
  tokenHash: text('token_hash').notNull(), createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at').notNull(), expiresAt: integer('expires_at').notNull(),
  acceptedBy: text('accepted_by').references(() => users.id), acceptedAt: integer('accepted_at'), revokedAt: integer('revoked_at'),
  recipientVersion: integer('recipient_version'),
}, t => [uniqueIndex('idx_invitations_token').on(t.tokenHash), index('idx_invitations_workspace').on(t.workspaceId),
  check('invitation_role', sql`${t.role} IN ('admin','teacher','parent')`)]);
export const drafts = sqliteTable('drafts', {
  workspaceId: text('workspace_id').notNull(), userId: text('user_id').notNull(),
  id: text('id').notNull(), learnerId: text('learner_id').notNull(), payload: text('payload').notNull(),
  revision: text('revision').notNull(), updatedAt: integer('updated_at').notNull(),
}, t => [primaryKey({ columns: [t.workspaceId, t.userId] }),
  foreignKey({ columns: [t.workspaceId, t.userId], foreignColumns: [memberships.workspaceId, memberships.userId] }).onDelete('cascade'),
  foreignKey({ columns: [t.workspaceId, t.learnerId], foreignColumns: [learners.workspaceId, learners.id] }).onDelete('cascade')]);
export const operations = sqliteTable('operations', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  id: text('id').notNull(), userId: text('user_id').notNull().references(() => users.id),
  digest: text('digest').notNull(), createdAt: integer('created_at').notNull(),
}, t => [primaryKey({ columns: [t.workspaceId, t.id] })]);
export const recoveryResults = sqliteTable('recovery_results', {
  workspaceId: text('workspace_id').notNull(), userId: text('user_id').notNull(),
  id: text('id').notNull(), learnerId: text('learner_id').notNull(), payload: text('payload').notNull(),
  createdAt: integer('created_at').notNull(),
}, t => [primaryKey({ columns: [t.workspaceId, t.userId, t.id] }),
  foreignKey({ columns: [t.workspaceId, t.userId], foreignColumns: [memberships.workspaceId, memberships.userId] }).onDelete('cascade'),
  foreignKey({ columns: [t.workspaceId, t.learnerId], foreignColumns: [learners.workspaceId, learners.id] }).onDelete('cascade')]);
export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(), workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id), action: text('action').notNull(),
  detail: text('detail').notNull(), createdAt: integer('created_at').notNull(),
}, t => [index('idx_audit_workspace_time').on(t.workspaceId, t.createdAt)]);
