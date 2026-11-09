import crypto from "node:crypto";

export function signWorkerRequest(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const message = `${timestamp}\n${body}`;
  const signature = crypto.createHmac("sha256", secret).update(message).digest("hex");
  return { timestamp: String(timestamp), signature };
}

