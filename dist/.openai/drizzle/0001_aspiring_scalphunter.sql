ALTER TABLE `invitations` ADD `recipient_version` integer;--> statement-breakpoint
ALTER TABLE `memberships` ADD `access_version` integer DEFAULT 0 NOT NULL;