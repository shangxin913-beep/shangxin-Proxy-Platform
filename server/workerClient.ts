import { signWorkerRequest } from "./workerAuth";

type WorkerConfig = { baseUrl: string; secret: string };

function envWorkerConfig(): WorkerConfig {
  const baseUrl = process.env.EXITPANEL_WORKER_URL;
  const secret = process.env.EXITPANEL_WORKER_SHARED_SECRET;
  if (!baseUrl || !secret) throw new Error("EXITPANEL_WORKER_URL and EXITPANEL_WORKER_SHARED_SECRET are required");
  return { baseUrl: baseUrl.replace(/\/$/, ""), secret };
}

async function workerPost<T>(config: WorkerConfig, path: string, payload: unknown): Promise<T> {
  const body = JSON.stringify(payload);
  const { timestamp, signature } = signWorkerRequest(config.secret, body);
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-exitpanel-timestamp": timestamp, "x-exitpanel-signature": signature },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { errorMessage?: string }).errorMessage || `worker_http_${response.status}`);
  return data as T;
}

export function checkWorker(payload: { host: string; port: number; username?: string; password?: string }) {
  return workerPost<{ status: string; observedIp?: string; country?: string; city?: string; latencyMs?: number }>(envWorkerConfig(), "/v1/check", payload);
}

export function applyWorkerXray(config: WorkerConfig, entries: unknown[]) {
  return workerPost<{ status: string; sha256?: string; errorMessage?: string }>(config, "/v1/config/apply", { entries });
}

export function applyConfiguredWorkerXray(entries: unknown[]) {
  return applyWorkerXray(envWorkerConfig(), entries);
}

export async function workerHealth() {
  const config = envWorkerConfig();
  const response = await fetch(`${config.baseUrl}/health`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`worker_http_${response.status}`);
  return response.json() as Promise<{ ok: boolean; service: string; capabilities?: string[] }>;
}
