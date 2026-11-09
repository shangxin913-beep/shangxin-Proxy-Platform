import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import { getSessionCookieOptions } from "./_core/cookies";
import { createExit, deleteExit, getExit, listChecks, listEvents, listExits, setExitCheck, updateExit, type SafeExit } from "./db";
import { makeSubscription } from "./subscriptions";

const port = z.coerce.number().int().min(1).max(65535);
const dateInput = z.string().datetime().nullable().optional();

const exitInput = z.object({
  type: z.enum(["direct", "socks5"]).default("socks5"),
  displayName: z.string().trim().min(1).max(160),
  providerName: z.string().trim().max(120).optional(),
  upstreamHost: z.string().trim().max(255).optional(),
  upstreamPort: port.optional(),
  username: z.string().trim().max(160).optional(),
  password: z.string().max(300).optional(),
  expectedCountry: z.string().trim().max(80).optional(),
  expectedCity: z.string().trim().max(120).optional(),
  entryHost: z.string().trim().min(1).max(255),
  entryPort: port,
  expiresAt: dateInput,
  subscribeEnabled: z.boolean().default(true),
});

function toDate(value: string | null | undefined) {
  return value ? new Date(value) : null;
}

function asNumber(value: number | null | undefined) {
  return value ?? 0;
}

function summarize(exits: SafeExit[]) {
  const now = Date.now();
  const soon = now + 7 * 24 * 60 * 60 * 1000;
  return {
    total: exits.length,
    healthy: exits.filter((e) => e.status === "passed" && e.enabled).length,
    checking: exits.filter((e) => e.status === "checking").length,
    faulted: exits.filter((e) => e.status === "failed" || e.status === "unknown").length,
    expired: exits.filter((e) => e.status === "expired" || (e.expiresAt && e.expiresAt.getTime() < now)).length,
    soon: exits.filter((e) => e.expiresAt && e.expiresAt.getTime() >= now && e.expiresAt.getTime() <= soon).length,
    subscribed: exits.filter((e) => e.subscribeEnabled && e.enabled && e.status === "passed" && (!e.expiresAt || e.expiresAt.getTime() > now)).length,
    entries: exits.filter((e) => e.enabled).length,
  };
}

function simulatedResult(exit: Pick<SafeExit, "displayName" | "expectedCountry" | "expectedCity" | "observedIp">) {
  const country = exit.expectedCountry || (exit.displayName.toLowerCase().includes("泰") ? "泰国" : exit.displayName.toLowerCase().includes("墨") ? "墨西哥" : "美国");
  const ip = exit.observedIp || (country === "泰国" ? "23.157.108.7" : country === "墨西哥" ? "200.10.213.202" : "131.103.128.148");
  const latency = country === "泰国" ? 1590 : country === "墨西哥" ? 531 : 288;
  return { status: "passed", observedIp: ip, country, city: exit.expectedCity || (country === "泰国" ? "曼谷" : country === "墨西哥" ? "墨西哥城" : "VPS 直出"), latencyMs: latency, errorCode: undefined, errorMessage: undefined };
}

export const appRouter = router({
  system: router({
    health: publicProcedure.query(() => ({ ok: true, mode: "preview-mock" as const })),
  }),
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  exits: router({
    list: adminProcedure.query(async () => listExits()),
    summary: adminProcedure.query(async () => {
      const rows = await listExits();
      return summarize(rows);
    }),
    detail: adminProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
      const exit = await getExit(input.id);
      if (!exit) throw new TRPCError({ code: "NOT_FOUND", message: "出口不存在" });
      const [checks, events] = await Promise.all([listChecks(input.id), listEvents(input.id)]);
      const { passwordEncrypted: _password, ...safe } = exit;
      return { ...safe, hasPassword: Boolean(_password), checks, events };
    }),
    create: adminProcedure.input(exitInput).mutation(async ({ input }) => {
      if (input.type === "socks5" && (!input.upstreamHost || !input.upstreamPort)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "第三方 SOCKS5 需要填写上游地址和端口" });
      }
      const created = await createExit({ ...input, expiresAt: toDate(input.expiresAt) });
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "创建出口失败" });
      const { passwordEncrypted: _password, ...safe } = created;
      return { ...safe, hasPassword: Boolean(_password) };
    }),
    update: adminProcedure.input(z.object({ id: z.string(), data: exitInput.partial().extend({ enabled: z.boolean().optional() }) })).mutation(async ({ input }) => {
      const updated = await updateExit(input.id, { ...input.data, expiresAt: input.data.expiresAt === undefined ? undefined : toDate(input.data.expiresAt) });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "出口不存在" });
      const { passwordEncrypted: _password, ...safe } = updated;
      return { ...safe, hasPassword: Boolean(_password) };
    }),
    toggle: adminProcedure.input(z.object({ id: z.string(), enabled: z.boolean() })).mutation(async ({ input }) => {
      const updated = await updateExit(input.id, { enabled: input.enabled, status: input.enabled ? "unknown" : "disabled" });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "出口不存在" });
      return { ok: true };
    }),
    remove: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
      await deleteExit(input.id);
      return { ok: true };
    }),
    check: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
      const exit = await getExit(input.id);
      if (!exit) throw new TRPCError({ code: "NOT_FOUND", message: "出口不存在" });
      if (exit.expiresAt && exit.expiresAt.getTime() <= Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "已过期出口不能检测，请先续期" });
      }
      await updateExit(input.id, { status: "checking" });
      const result = simulatedResult(exit);
      const checked = await setExitCheck(input.id, result);
      return checked;
    }),
  }),
  subscriptions: router({
    preview: adminProcedure.query(async () => {
      const rows = await listExits();
      return makeSubscription(rows as SafeExit[] as any);
    }),
  }),
});

export type AppRouter = typeof appRouter;
