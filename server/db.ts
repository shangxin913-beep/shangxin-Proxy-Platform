import crypto from "node:crypto";
import { and, desc, eq, isNotNull, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { nanoid } from "nanoid";
import { decryptSecret, encryptSecret } from "./crypto";
import { checkRecords, exits, InsertUser, statusEvents, users, type Exit } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    if (user[field] !== undefined) {
      const value = user[field] ?? null;
      values[field] = value;
      updateSet[field] = value;
    }
  }
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export type SafeExit = Omit<Exit, "passwordEncrypted"> & { hasPassword: boolean };

function safeExit(exit: Exit): SafeExit {
  const { passwordEncrypted, ...rest } = exit;
  return { ...rest, hasPassword: Boolean(passwordEncrypted) };
}

async function expirePastExits(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const now = new Date();
  const candidates = await db.select().from(exits).where(and(isNotNull(exits.expiresAt), lt(exits.expiresAt, now)));
  for (const exit of candidates) {
    if (exit.status !== "expired") {
      await db.update(exits).set({ status: "expired", enabled: 0, updatedAt: now }).where(eq(exits.id, exit.id));
      await db.insert(statusEvents).values({ exitId: exit.id, fromStatus: exit.status, toStatus: "expired", message: "出口已到期，已从新订阅移除" });
    }
  }
}

export async function listExits() {
  const db = await getDb();
  if (!db) return [] as SafeExit[];
  await expirePastExits(db);
  const rows = await db.select().from(exits).orderBy(desc(exits.updatedAt));
  return rows.map(safeExit);
}

export async function getExit(id: string) {
  const db = await getDb();
  if (!db) return undefined;
  await expirePastExits(db);
  const result = await db.select().from(exits).where(eq(exits.id, id)).limit(1);
  return result[0];
}

export type ExitInput = {
  type?: "direct" | "socks5";
  displayName: string;
  providerName?: string;
  upstreamHost?: string;
  upstreamPort?: number;
  username?: string;
  password?: string;
  expectedCountry?: string;
  expectedCity?: string;
  entryHost: string;
  entryPort: number;
  expiresAt?: Date | null;
  subscribeEnabled?: boolean;
};

export async function createExit(input: ExitInput) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const id = `exit_${nanoid(12)}`;
  const entryUuid = crypto.randomUUID();
  const now = new Date();
  await db.insert(exits).values({
    id,
    type: input.type ?? "socks5",
    displayName: input.displayName,
    providerName: input.providerName || null,
    upstreamHost: input.upstreamHost || null,
    upstreamPort: input.upstreamPort || null,
    username: input.username || null,
    passwordEncrypted: input.password ? encryptSecret(input.password) : null,
    expectedCountry: input.expectedCountry || null,
    expectedCity: input.expectedCity || null,
    status: "unknown",
    enabled: 1,
    subscribeEnabled: input.subscribeEnabled === false ? 0 : 1,
    entryHost: input.entryHost,
    entryPort: input.entryPort,
    entryUuid,
    expiresAt: input.expiresAt ?? null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(statusEvents).values({ exitId: id, toStatus: "unknown", message: "已创建，等待首次检测" });
  return getExit(id);
}

export async function updateExit(id: string, input: Partial<ExitInput> & { enabled?: boolean; subscribeEnabled?: boolean; status?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const old = await getExit(id);
  if (!old) return undefined;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const map: Record<string, string> = {
    type: "type", displayName: "displayName", providerName: "providerName", upstreamHost: "upstreamHost", upstreamPort: "upstreamPort",
    username: "username", expectedCountry: "expectedCountry", expectedCity: "expectedCity", entryHost: "entryHost", entryPort: "entryPort", expiresAt: "expiresAt",
  };
  for (const [inputKey, column] of Object.entries(map)) {
    if (inputKey in input) patch[column] = (input as Record<string, unknown>)[inputKey] || null;
  }
  if (input.password) patch.passwordEncrypted = encryptSecret(input.password);
  if (input.enabled !== undefined) patch.enabled = input.enabled ? 1 : 0;
  if (input.subscribeEnabled !== undefined) patch.subscribeEnabled = input.subscribeEnabled ? 1 : 0;
  if (input.status) patch.status = input.status;
  const nextExpiresAt = input.expiresAt === undefined ? old.expiresAt : input.expiresAt;
  if (nextExpiresAt && nextExpiresAt.getTime() <= Date.now()) {
    patch.status = "expired";
    patch.enabled = 0;
  } else if (input.enabled === true && old.status === "expired") {
    patch.status = "unknown";
  }
  await db.update(exits).set(patch).where(eq(exits.id, id));
  if (input.status && input.status !== old.status) {
    await db.insert(statusEvents).values({ exitId: id, fromStatus: old.status, toStatus: input.status, message: "管理员更新出口状态" });
  }
  return getExit(id);
}

export async function deleteExit(id: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.delete(statusEvents).where(eq(statusEvents.exitId, id));
  await db.delete(checkRecords).where(eq(checkRecords.exitId, id));
  await db.delete(exits).where(eq(exits.id, id));
}

export async function setExitCheck(id: string, result: { status: string; observedIp?: string; country?: string; city?: string; latencyMs?: number; errorCode?: string; errorMessage?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const old = await getExit(id);
  if (!old) return undefined;
  if (old.expiresAt && old.expiresAt.getTime() <= Date.now()) {
    await updateExit(id, { status: "expired", enabled: false });
    return getExit(id);
  }
  const now = new Date();
  await db.insert(checkRecords).values({ exitId: id, ...result, checkedAt: now });
  await db.update(exits).set({
    status: result.status,
    observedIp: result.observedIp || null,
    observedCountry: result.country || null,
    observedCity: result.city || null,
    latencyMs: result.latencyMs || null,
    lastError: result.errorMessage || null,
    lastCheckedAt: now,
    updatedAt: now,
  }).where(eq(exits.id, id));
  if (old.status !== result.status) {
    await db.insert(statusEvents).values({ exitId: id, fromStatus: old.status, toStatus: result.status, message: result.errorMessage || "检测状态已更新" });
  }
  return getExit(id);
}

export async function listChecks(exitId: string, limit = 8) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(checkRecords).where(eq(checkRecords.exitId, exitId)).orderBy(desc(checkRecords.checkedAt)).limit(limit);
}

export async function listEvents(exitId: string, limit = 8) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(statusEvents).where(eq(statusEvents.exitId, exitId)).orderBy(desc(statusEvents.createdAt)).limit(limit);
}

export async function getExitCredential(id: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select({ passwordEncrypted: exits.passwordEncrypted }).from(exits).where(eq(exits.id, id)).limit(1);
  const encrypted = result[0]?.passwordEncrypted;
  return encrypted ? decryptSecret(encrypted) : undefined;
}
