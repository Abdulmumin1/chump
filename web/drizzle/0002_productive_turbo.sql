CREATE TABLE `sharedSession` (
	`slug` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`messages` text NOT NULL,
	`createdAt` integer NOT NULL
);
