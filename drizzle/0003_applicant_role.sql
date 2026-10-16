PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_admin_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`permissions` text DEFAULT '[]' NOT NULL,
	`password_hash` text NOT NULL,
	`salt` text NOT NULL,
	`created_at` text NOT NULL,
	`approved_at` text,
	`approved_by` text,
	`revision` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "valid_admin_role" CHECK("__new_admin_users"."role" IN ('superadmin','admin','applicant')),
	CONSTRAINT "valid_admin_status" CHECK("__new_admin_users"."status" IN ('pending','active','suspended')),
	CONSTRAINT "active_superadmin" CHECK("__new_admin_users"."role" != 'superadmin' OR "__new_admin_users"."status" = 'active'),
	CONSTRAINT "pending_applicant" CHECK("__new_admin_users"."role" != 'applicant' OR "__new_admin_users"."status" = 'pending')
);
--> statement-breakpoint
INSERT INTO `__new_admin_users`("id", "email", "display_name", "role", "status", "permissions", "password_hash", "salt", "created_at", "approved_at", "approved_by", "revision") SELECT "id", "email", "display_name", "role", "status", "permissions", "password_hash", "salt", "created_at", "approved_at", "approved_by", "revision" FROM `admin_users`;--> statement-breakpoint
DROP TABLE `admin_users`;--> statement-breakpoint
ALTER TABLE `__new_admin_users` RENAME TO `admin_users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_email_unique` ON `admin_users` (`email`);
--> statement-breakpoint
UPDATE admin_users SET role='applicant' WHERE status='pending' AND role='admin';
