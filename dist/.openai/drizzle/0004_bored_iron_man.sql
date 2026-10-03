CREATE TABLE `ai_learning_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`learner_id` text NOT NULL,
	`user_id` text NOT NULL,
	`lang` text NOT NULL,
	`level` integer NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`learner_id`) REFERENCES `learners`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ai_learning_context` ON `ai_learning_sessions` (`workspace_id`,`learner_id`,`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `ai_learning_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`digest` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "ai_learning_usage_status" CHECK("ai_learning_usage"."status" IN ('pending','complete','failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_ai_learning_usage_user` ON `ai_learning_usage` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ai_learning_usage_time` ON `ai_learning_usage` (`created_at`);