import crypto from "node:crypto";
import { and, desc, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { nanoid } from "nanoid";
import { decryptSecret, encryptSecret } from "./crypto";
import { checkRecords, exits, InsertUser, nodes, statusEvents, users, type Exit } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { hashLocalPassword, verifyLocalPassword } from "./localAuth";

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
  } else if (!ENV.ownerOpenId) {
    const existingAdmin = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
    if (existingAdmin.length === 0) {
      values.role = "admin";
      updateSet.role = "admin";
    }
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


const LOCAL_ADMIN_OPEN_ID = "local_admin";

export async function authenticateLocalAdmin(username: string, password: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  let result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (result.length === 0 && username === "admin") {
    await db.insert(users).values({
      openId: LOCAL_ADMIN_OPEN_ID, username: "admin", passwordHash: hashLocalPassword("admin"),
      passwordMustChange: 1, name: "管理员", loginMethod: "local", role: "admin", lastSignedIn: new Date(),
    });
    result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  }
  const user = result[0];
  if (!user || user.role !== "admin" || !verifyLocalPassword(password, user.passwordHash)) return null;
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));
  return user;
}

export async function changeLocalAdminPassword(userId: number, currentPassword: string, newPassword: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = result[0];
  if (!user || user.loginMethod !== "local" || !verifyLocalPassword(currentPassword, user.passwordHash)) return false;
  await db.update(users).set({ passwordHash: hashLocalPassword(newPassword), passwordMustChange: 0 }).where(eq(users.id, userId));
  return true;
}

export async function ensureSubscriptionToken(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const existing = await db.select({ subscriptionToken: users.subscriptionToken }).from(users).where(eq(users.id, userId)).limit(1);
  if (existing[0]?.subscriptionToken) return existing[0].subscriptionToken;
  const token = `sub_${nanoid(48)}`;
  await db.update(users).set({ subscriptionToken: token }).where(eq(users.id, userId));
  return token;
}

export async function getUserBySubscriptionToken(token: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select({ id: users.id }).from(users).where(eq(users.subscriptionToken, token)).limit(1);
  return result[0];
}

export async function listNodes() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ id: nodes.id, displayName: nodes.displayName, kind: nodes.kind, endpoint: nodes.endpoint, agentPort: nodes.agentPort, tunnelMode: nodes.tunnelMode, publicEntryHost: nodes.publicEntryHost, status: nodes.status, lastSeenAt: nodes.lastSeenAt, createdAt: nodes.createdAt, updatedAt: nodes.updatedAt, sharedSecretEncrypted: nodes.sharedSecretEncrypted }).from(nodes).orderBy(desc(nodes.updatedAt));
  return rows.map(({ sharedSecretEncrypted, ...node }) => ({ ...node, hasSecret: Boolean(sharedSecretEncrypted) }));
}

export async function getNode(id: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(nodes).where(eq(nodes.id, id)).limit(1);
  return result[0];
}

export async function listExitPlans(nodeId: string) {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  const rows = await db.select().from(exits).where(and(eq(exits.nodeId, nodeId), eq(exits.enabled, 1), or(isNull(exits.expiresAt), gt(exits.expiresAt, now))));
  return Promise.all(rows.map(async (exit) => ({
    id: exit.id,
    displayName: exit.displayName,
    entryPort: exit.entryPort,
    entryUuid: exit.entryUuid,
    expiresAt: exit.expiresAt ? exit.expiresAt.toISOString() : null,
    upstream: exit.type === "direct" ? { type: "direct" as const } : { type: "socks5" as const, host: exit.upstreamHost || "", port: exit.upstreamPort || 0, username: exit.username || "", password: exit.passwordEncrypted ? decryptSecret(exit.passwordEncrypted) : "" },
  })));
}

export type NodeInput = { displayName: string; endpoint: string; agentPort: number; tunnelMode?: "direct" | "reverse"; publicEntryHost?: string; sharedSecret?: string };

export async function createNode(input: NodeInput) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const id = `node_${nanoid(12)}`;
  const now = new Date();
  await db.insert(nodes).values({ id, displayName: input.displayName, endpoint: input.endpoint, agentPort: input.agentPort, tunnelMode: input.tunnelMode || "direct", publicEntryHost: input.publicEntryHost || null, sharedSecretEncrypted: input.sharedSecret ? encryptSecret(input.sharedSecret) : null, createdAt: now, updatedAt: now });
  return id;
}

export async function updateNode(id: string, input: Partial<NodeInput> & { status?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of ["displayName", "endpoint", "agentPort", "tunnelMode", "publicEntryHost", "status"] as const) {
    if (input[key] !== undefined) patch[key] = input[key] || null;
  }
  if (input.sharedSecret) patch.sharedSecretEncrypted = encryptSecret(input.sharedSecret);
  await db.update(nodes).set(patch).where(eq(nodes.id, id));
}

export async function deleteNode(id: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.delete(nodes).where(eq(nodes.id, id));
}

export async function getNodeSecret(id: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select({ sharedSecretEncrypted: nodes.sharedSecretEncrypted }).from(nodes).where(eq(nodes.id, id)).limit(1);
  const encrypted = result[0]?.sharedSecretEncrypted;
  return encrypted ? decryptSecret(encrypted) : undefined;
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
  nodeId?: string | null;
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
    nodeId: input.nodeId || null,
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
    nodeId: "nodeId", type: "type", displayName: "displayName", providerName: "providerName", upstreamHost: "upstreamHost", upstreamPort: "upstreamPort",
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
