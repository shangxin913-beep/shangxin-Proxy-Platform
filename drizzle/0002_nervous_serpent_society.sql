CREATE TABLE `nodes` (
	`id` varchar(32) NOT NULL,
	`displayName` varchar(120) NOT NULL,
	`kind` varchar(24) NOT NULL DEFAULT 'vps',
	`endpoint` varchar(255) NOT NULL,
	`agentPort` int NOT NULL DEFAULT 18443,
	`tunnelMode` varchar(24) NOT NULL DEFAULT 'direct',
	`publicEntryHost` varchar(255),
	`status` varchar(24) NOT NULL DEFAULT 'unknown',
	`sharedSecretEncrypted` text,
	`lastSeenAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `nodes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `exits` ADD `nodeId` varchar(32);--> statement-breakpoint
ALTER TABLE `users` ADD `subscriptionToken` varchar(96);