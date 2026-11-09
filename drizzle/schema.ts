import { int, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: varchar("role", { length: 16 }).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const exits = mysqlTable("exits", {
  id: varchar("id", { length: 32 }).primaryKey(),
  type: varchar("type", { length: 24 }).notNull(),
  displayName: varchar("displayName", { length: 160 }).notNull(),
  providerName: varchar("providerName", { length: 120 }),
  upstreamHost: varchar("upstreamHost", { length: 255 }),
  upstreamPort: int("upstreamPort"),
  username: varchar("username", { length: 160 }),
  passwordEncrypted: text("passwordEncrypted"),
  expectedCountry: varchar("expectedCountry", { length: 80 }),
  expectedCity: varchar("expectedCity", { length: 120 }),
  observedIp: varchar("observedIp", { length: 64 }),
  observedCountry: varchar("observedCountry", { length: 80 }),
  observedCity: varchar("observedCity", { length: 120 }),
  status: varchar("status", { length: 24 }).default("unknown").notNull(),
  enabled: int("enabled").default(1).notNull(),
  subscribeEnabled: int("subscribeEnabled").default(1).notNull(),
  entryHost: varchar("entryHost", { length: 255 }).default("vps.example.com").notNull(),
  entryPort: int("entryPort").notNull(),
  entryProtocol: varchar("entryProtocol", { length: 24 }).default("VLESS").notNull(),
  entrySecurity: varchar("entrySecurity", { length: 24 }).default("REALITY").notNull(),
  entryUuid: varchar("entryUuid", { length: 64 }).notNull(),
  expiresAt: timestamp("expiresAt"),
  lastCheckedAt: timestamp("lastCheckedAt"),
  latencyMs: int("latencyMs"),
  lastError: varchar("lastError", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const checkRecords = mysqlTable("checkRecords", {
  id: int("id").autoincrement().primaryKey(),
  exitId: varchar("exitId", { length: 32 }).notNull(),
  status: varchar("status", { length: 24 }).notNull(),
  observedIp: varchar("observedIp", { length: 64 }),
  country: varchar("country", { length: 80 }),
  city: varchar("city", { length: 120 }),
  latencyMs: int("latencyMs"),
  errorCode: varchar("errorCode", { length: 80 }),
  errorMessage: varchar("errorMessage", { length: 255 }),
  checkedAt: timestamp("checkedAt").defaultNow().notNull(),
});

export const statusEvents = mysqlTable("statusEvents", {
  id: int("id").autoincrement().primaryKey(),
  exitId: varchar("exitId", { length: 32 }).notNull(),
  fromStatus: varchar("fromStatus", { length: 24 }),
  toStatus: varchar("toStatus", { length: 24 }).notNull(),
  message: varchar("message", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Exit = typeof exits.$inferSelect;
export type InsertExit = typeof exits.$inferInsert;
export type CheckRecord = typeof checkRecords.$inferSelect;
export type StatusEvent = typeof statusEvents.$inferSelect;
