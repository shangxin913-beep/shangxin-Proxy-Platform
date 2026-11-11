import crypto from "node:crypto";

const SCRYPT_KEY_LENGTH = 64;

export function hashLocalPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyLocalPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [algorithm, salt, expectedHex] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  try {
    const actual = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH);
    const expected = Buffer.from(expectedHex, "hex");
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
