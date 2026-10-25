DROP INDEX IF EXISTS `users_realm_username_lower_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_realm_username_ci_idx` ON `users` (`realm`,"username" COLLATE NOCASE);