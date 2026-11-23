CREATE TABLE `element_rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`creator_key` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `element_rooms_creator_time` ON `element_rooms` (`creator_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `element_rooms_expiry` ON `element_rooms` (`expires_at`);