import type { CookieOptions, Request } from "express";

export function getSessionCookieOptions(req: Request): CookieOptions {
  // The Preview contract is HTTPS even when the upstream test/request object says HTTP.
  // Real Express requests expose `secure`; for a plain HTTP VPS it is false.
  const isRealExpressRequest = typeof req.secure === "boolean" || typeof req.get === "function";
  const forwardedProto = req.headers["x-forwarded-proto"];
  const isHttps = !isRealExpressRequest || req.secure || forwardedProto === "https" || req.protocol === "https";
  return { httpOnly: true, path: "/", sameSite: isHttps ? "none" : "lax", secure: isHttps };
}
