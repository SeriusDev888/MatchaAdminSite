CREATE TABLE `admin_users` (
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
	CONSTRAINT "valid_admin_role" CHECK("admin_users"."role" IN ('superadmin','admin')),
	CONSTRAINT "valid_admin_status" CHECK("admin_users"."status" IN ('pending','active','suspended')),
	CONSTRAINT "active_superadmin" CHECK("admin_users"."role" != 'superadmin' OR "admin_users"."status" = 'active')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_email_unique` ON `admin_users` (`email`);--> statement-breakpoint
ALTER TABLE `admin_sessions` ADD `user_id` text DEFAULT 'superadmin' NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO admin_users (id,email,display_name,role,status,permissions,password_hash,salt,created_at,approved_at,approved_by,revision)
SELECT 'superadmin',lower(email),email,'superadmin','active','[]',password_hash,salt,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'superadmin',0 FROM admin_account WHERE id=1;
