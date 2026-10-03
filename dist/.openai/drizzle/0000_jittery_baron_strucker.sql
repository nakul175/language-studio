CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_audit_workspace_time` ON `audit_events` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `drafts` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`learner_id` text NOT NULL,
	`payload` text NOT NULL,
	`revision` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`,`user_id`) REFERENCES `memberships`(`workspace_id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`learner_id`) REFERENCES `learners`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`learner_ids` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_by` text,
	`accepted_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitation_role" CHECK("invitations"."role" IN ('admin','teacher','parent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_invitations_token` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_invitations_workspace` ON `invitations` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `learner_access` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`learner_id` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`, `learner_id`),
	FOREIGN KEY (`workspace_id`,`user_id`) REFERENCES `memberships`(`workspace_id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`learner_id`) REFERENCES `learners`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `learners` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`code` text NOT NULL,
	`code_key` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_learners_workspace_code` ON `learners` (`workspace_id`,`code_key`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "membership_role" CHECK("memberships"."role" IN ('admin','teacher','parent')),
	CONSTRAINT "membership_status" CHECK("memberships"."status" IN ('active','inactive'))
);
--> statement-breakpoint
CREATE INDEX `idx_memberships_user_status` ON `memberships` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `operations` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`digest` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`learner_id` text NOT NULL,
	`payload` text NOT NULL,
	`lang` text NOT NULL,
	`level` integer NOT NULL,
	`mode` text NOT NULL,
	`at` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`learner_id`) REFERENCES `learners`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_workspace_learner_at` ON `sessions` (`workspace_id`,`learner_id`,`at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`last_mutation` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
