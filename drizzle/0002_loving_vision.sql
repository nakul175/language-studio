CREATE TABLE `recovery_results` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`learner_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`, `id`),
	FOREIGN KEY (`workspace_id`,`user_id`) REFERENCES `memberships`(`workspace_id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`learner_id`) REFERENCES `learners`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
