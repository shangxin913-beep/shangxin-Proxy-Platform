CREATE TABLE `checkRecords` (
	`id` int AUTO_INCREMENT NOT NULL,
	`exitId` varchar(32) NOT NULL,
	`status` varchar(24) NOT NULL,
	`observedIp` varchar(64),
	`country` varchar(80),
	`city` varchar(120),
	`latencyMs` int,
	`errorCode` varchar(80),
	`errorMessage` varchar(255),
	`checkedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `checkRecords_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `exits` (
	`id` varchar(32) NOT NULL,
	`type` varchar(24) NOT NULL,
	`displayName` varchar(160) NOT NULL,
	`providerName` varchar(120),
	`upstreamHost` varchar(255),
	`upstreamPort` int,
	`username` varchar(160),
	`passwordEncrypted` text,
	`expectedCountry` varchar(80),
	`expectedCity` varchar(120),
	`observedIp` varchar(64),
	`observedCountry` varchar(80),
	`observedCity` varchar(120),
	`status` varchar(24) NOT NULL DEFAULT 'unknown',
	`enabled` int NOT NULL DEFAULT 1,
	`subscribeEnabled` int NOT NULL DEFAULT 1,
	`entryHost` varchar(255) NOT NULL DEFAULT 'vps.example.com',
	`entryPort` int NOT NULL,
	`entryProtocol` varchar(24) NOT NULL DEFAULT 'VLESS',
	`entrySecurity` varchar(24) NOT NULL DEFAULT 'REALITY',
	`entryUuid` varchar(64) NOT NULL,
	`expiresAt` timestamp,
	`lastCheckedAt` timestamp,
	`latencyMs` int,
	`lastError` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `exits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `statusEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`exitId` varchar(32) NOT NULL,
	`fromStatus` varchar(24),
	`toStatus` varchar(24) NOT NULL,
	`message` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `statusEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` varchar(16) NOT NULL DEFAULT 'user';