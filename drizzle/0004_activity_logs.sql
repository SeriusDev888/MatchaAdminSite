CREATE TABLE `editor_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`actor_name` text NOT NULL,
	`actor_role` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`details` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `editor_audit_logs_time` ON `editor_audit_logs` (`created_at`,`id`);